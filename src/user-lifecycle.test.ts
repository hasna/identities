import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, type CryptoKey, type JWK, type KeyObject } from "jose";
import {
  IdentityAccessTokenIssuer,
  IdentityAccessTokenVerifier,
  IdentityJwksRegistry,
} from "./identity-auth.js";
import {
  Argon2idIdentityPasswordHasher,
  DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE,
  IdentityLifecycleError,
  IdentityLifecycleService,
  InMemoryIdentityLifecycleStore,
  createIdentityLifecycleApi,
  identityLifecycleMigrations,
  normalizeLoginIdentifier,
  type IdentityInviteRecord,
  type IdentityPasswordHasher,
  type RegistrationPolicy,
} from "./user-lifecycle.js";
import { runCli } from "./cli.js";

const ISSUER = "https://identity.example.test";
const AUDIENCE = "infinity-local";
const BOOTSTRAP_TENANT = {
  slug: "infinity",
  name: "Infinity",
};

type SigningKey = CryptoKey | KeyObject;

let privateKey: SigningKey;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA");
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
});

class FastPasswordHasher implements IdentityPasswordHasher {
  readonly algorithm = "test-only" as const;
  verifyCalls = 0;
  dummyHashCalls = 0;

  async hash(password: string): Promise<string> {
    return `test$${password}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    this.verifyCalls += 1;
    return encoded === `test$${password}`;
  }

  async dummyHash(): Promise<string> {
    this.dummyHashCalls += 1;
    return "test$dummy-password-that-never-matches";
  }
}

class GatedPasswordHasher extends FastPasswordHasher {
  active = 0;
  maxActive = 0;
  private releaseGate!: () => void;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  override async verify(password: string, encoded: string): Promise<boolean> {
    this.verifyCalls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await this.gate;
    this.active -= 1;
    return encoded === `test$${password}`;
  }

  release(): void {
    this.releaseGate();
  }
}

function authFixture() {
  const registry = new IdentityJwksRegistry({
    issuer: ISSUER,
    revision: 1,
    keys: [{ kid: "current", alg: "EdDSA", status: "active", publicJwk }],
  });
  const store = new InMemoryIdentityLifecycleStore();
  const issuer = new IdentityAccessTokenIssuer({
    registry,
    privateKey,
    kid: "current",
    alg: "EdDSA",
    issuer: ISSUER,
    audience: AUDIENCE,
    accessTokenTtlSeconds: 300,
  });
  const verifier = new IdentityAccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["EdDSA"],
    jwks: registry,
    tokenState: store,
    clockToleranceSeconds: 0,
    maxTokenLifetimeSeconds: 300,
  });
  return { registry, store, issuer, verifier };
}

function fixture(
  policy: RegistrationPolicy = "open",
  options: {
    now?: () => Date;
    hasher?: IdentityPasswordHasher;
    recovery?: (input: { userId: string; token: string }) => void | Promise<void>;
    verification?: (input: { userId: string; token: string }) => void | Promise<void>;
    recoveryMinimumResponseMs?: number;
  } = {},
) {
  const auth = authFixture();
  const hasher = options.hasher ?? new FastPasswordHasher();
  const service = new IdentityLifecycleService({
    store: auth.store,
    registrationPolicy: policy,
    bootstrapTenant: BOOTSTRAP_TENANT,
    passwordHasher: hasher,
    tokenIssuer: auth.issuer,
    tokenVerifier: auth.verifier,
    now: options.now,
    recoveryMinimumResponseMs: options.recoveryMinimumResponseMs,
    hooks: {
      deliverRecovery: options.recovery,
      deliverVerification: options.verification,
    },
    defaultScopes: [
      "runs:read",
      "runs:write",
      "identity:read",
      "identities:invites:manage",
      "identities:platform:admin",
    ],
    loginThrottle: {
      maxFailures: 3,
      windowSeconds: 300,
      lockSeconds: 300,
    },
  });
  return { ...auth, hasher, service };
}

async function errorReason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityLifecycleError);
    return (error as IdentityLifecycleError).reason;
  }
}

async function firstAdmin(service: IdentityLifecycleService, email = "owner@example.test") {
  return service.bootstrapFirstAdmin({
    identifier: { kind: "email", value: email },
    password: "correct horse battery staple",
    displayName: "Owner",
  });
}

describe("Argon2id password credentials", () => {
  test("hashes with Argon2id and verifies without exposing the password", async () => {
    const hasher = new Argon2idIdentityPasswordHasher({
      memoryCost: 65_536,
      timeCost: 2,
    });
    const encoded = await hasher.hash("correct horse battery staple");
    expect(encoded).toStartWith("$argon2id$");
    expect(encoded).not.toContain("correct horse battery staple");
    expect(await hasher.verify("correct horse battery staple", encoded)).toBe(true);
    expect(await hasher.verify("wrong password", encoded)).toBe(false);
  });
});

describe("registration and first-admin bootstrap", () => {
  test("atomically bootstraps exactly one first administrator", async () => {
    const { service, store } = fixture("open");
    const [one, two] = await Promise.allSettled([
      service.bootstrapFirstAdmin({
        identifier: { kind: "email", value: "first@example.test" },
        password: "a secure first password",
        displayName: "First",
      }),
      service.bootstrapFirstAdmin({
        identifier: { kind: "email", value: "second@example.test" },
        password: "a secure second password",
        displayName: "Second",
      }),
    ]);
    expect([one.status, two.status].sort()).toEqual(["fulfilled", "rejected"]);
    const snapshot = store.snapshot();
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.tenants).toHaveLength(1);
    expect(snapshot.memberships).toHaveLength(1);
    expect(snapshot.memberships[0]?.role).toBe("owner");
    expect(snapshot.sessionFamilies).toHaveLength(1);
    expect(snapshot.refreshTokens).toHaveLength(1);
  });

  test("rejects duplicate and concurrent signup without partial rows", async () => {
    const { service, store } = fixture("open");
    const request = {
      identifier: { kind: "email" as const, value: "Duplicate@Example.Test" },
      password: "a sufficiently strong password",
      displayName: "Duplicate",
    };
    const results = await Promise.allSettled([
      service.signup(request),
      service.signup({ ...request, identifier: { ...request.identifier, value: " duplicate@example.test " } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.snapshot().users).toHaveLength(1);
    expect(store.snapshot().loginIdentifiers).toHaveLength(1);
    expect(store.snapshot().credentials).toHaveLength(1);
    expect(store.snapshot().sessionFamilies).toHaveLength(1);
    expect(store.snapshot().refreshTokens).toHaveLength(1);
  });

  test("enforces disabled, invite, expired-invite, and used-invite policies", async () => {
    const disabled = fixture("disabled");
    expect(await errorReason(disabled.service.signup({
      identifier: { kind: "email", value: "disabled@example.test" },
      password: "a sufficiently strong password",
      displayName: "Disabled",
    }))).toBe("registration_disabled");

    let current = new Date();
    const invited = fixture("invite", { now: () => current });
    const admin = await firstAdmin(invited.service);
    const invite = await invited.service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: admin.tenant.id,
      identifier: { kind: "email", value: "member@example.test" },
      role: "member",
      scopes: ["runs:read"],
      expiresInSeconds: 60,
    });
    current = new Date(current.getTime() + 120_000);
    expect(await errorReason(invited.service.signup({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Member",
      inviteToken: invite.token,
    }))).toBe("invite_invalid");

    current = new Date(current.getTime() + 60_000);
    const fresh = await invited.service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: admin.tenant.id,
      identifier: { kind: "email", value: "member@example.test" },
      role: "member",
      scopes: ["runs:read"],
      expiresInSeconds: 300,
    });
    await invited.service.signup({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Member",
      inviteToken: fresh.token,
    });
    expect(await errorReason(invited.service.signup({
      identifier: { kind: "email", value: "other@example.test" },
      password: "a sufficiently strong password",
      displayName: "Other",
      inviteToken: fresh.token,
    }))).toBe("invite_invalid");
  });
});

describe("login, tenancy, and account state", () => {
  test("uses the same password verification path and error for unknown and wrong users", async () => {
    const hasher = new FastPasswordHasher();
    const { service } = fixture("open", { hasher });
    await firstAdmin(service);
    hasher.verifyCalls = 0;
    const unknown = service.login({
      identifier: { kind: "email", value: "unknown@example.test" },
      password: "wrong",
    });
    expect(await errorReason(unknown)).toBe("invalid_credentials");
    expect(hasher.verifyCalls).toBe(1);
    const wrong = service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "wrong",
    });
    expect(await errorReason(wrong)).toBe("invalid_credentials");
    expect(hasher.verifyCalls).toBe(2);
  });

  test("throttles repeated failures without changing the generic login error", async () => {
    const { service } = fixture("open");
    await firstAdmin(service);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await errorReason(service.login({
        identifier: { kind: "email", value: "owner@example.test" },
        password: "wrong",
        throttleKey: "test-client",
      }))).toBe("invalid_credentials");
    }
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "correct horse battery staple",
      throttleKey: "test-client",
    }))).toBe("rate_limited");
  });

  test("fails closed for disabled and soft-deleted users", async () => {
    const { service } = fixture("invite");
    const admin = await firstAdmin(service);
    const invite = await service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: admin.tenant.id,
      identifier: { kind: "email", value: "member-state@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    const member = await service.signup({
      identifier: { kind: "email", value: "member-state@example.test" },
      password: "a sufficiently strong password",
      displayName: "Member State",
      inviteToken: invite.token,
    });
    await service.disableUser({
      actorAccessToken: admin.accessToken,
      userId: member.user.id,
    });
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "member-state@example.test" },
      password: "a sufficiently strong password",
    }))).toBe("invalid_credentials");
    await service.restoreUser({
      actorAccessToken: admin.accessToken,
      userId: member.user.id,
    });
    const restored = await service.login({
      identifier: { kind: "email", value: "member-state@example.test" },
      password: "a sufficiently strong password",
    });
    await service.softDeleteUser({
      actorAccessToken: admin.accessToken,
      userId: restored.user.id,
    });
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "member-state@example.test" },
      password: "a sufficiently strong password",
    }))).toBe("invalid_credentials");
  });

  test("binds login and granted scopes to one tenant membership", async () => {
    const { service } = fixture("invite");
    const admin = await firstAdmin(service);
    const invite = await service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: admin.tenant.id,
      identifier: { kind: "email", value: "member@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    const member = await service.signup({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Member",
      inviteToken: invite.token,
    });
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      tenantId: "tenant-other",
    }))).toBe("invalid_credentials");
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      tenantId: member.tenant.id,
      scopes: ["runs:write"],
    }))).toBe("invalid_scope");
    const session = await service.login({
      identifier: { kind: "email", value: "member@example.test" },
      password: "a sufficiently strong password",
      tenantId: member.tenant.id,
      scopes: ["runs:read"],
    });
    expect(session.scopes).toEqual(["runs:read"]);
    const refreshed = await service.refresh({ refreshToken: session.refreshToken });
    expect(refreshed.scopes).toEqual(["runs:read"]);
  });

  test("prevents a user in another tenant from administering the target user", async () => {
    const { service, verifier } = fixture("open");
    const first = await firstAdmin(service);
    const second = await service.signup({
      identifier: { kind: "email", value: "second-admin@example.test" },
      password: "a sufficiently strong password",
      displayName: "Second",
    });
    expect(await errorReason(service.disableUser({
      actorAccessToken: second.accessToken,
      userId: first.user.id,
    }))).toBe("forbidden");
    expect((await verifier.verify(first.accessToken)).sub).toBe(first.user.id);
  });
});

describe("session rotation and revocation", () => {
  test("rotates refresh tokens and treats replay as a family compromise", async () => {
    const { service, verifier } = fixture("open");
    const session = await firstAdmin(service);
    const rotated = await service.refresh({ refreshToken: session.refreshToken });
    expect(rotated.refreshToken).not.toBe(session.refreshToken);
    expect(await errorReason(service.refresh({ refreshToken: session.refreshToken }))).toBe("refresh_replay");
    await expect(verifier.verify(rotated.accessToken)).rejects.toMatchObject({
      reason: "session_inactive",
    });
  });

  test("logout revokes the family and current JTI; logout-all is cross-user isolated", async () => {
    const { service, verifier } = fixture("open");
    const first = await firstAdmin(service);
    const secondSignup = await service.signup({
      identifier: { kind: "email", value: "second@example.test" },
      password: "a sufficiently strong password",
      displayName: "Second",
    });
    const firstAgain = await service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "correct horse battery staple",
    });
    await service.logout({
      accessToken: first.accessToken,
      refreshToken: first.refreshToken,
    });
    await expect(verifier.verify(first.accessToken)).rejects.toMatchObject({
      reason: "token_revoked",
    });
    await service.logoutAll({ accessToken: firstAgain.accessToken });
    await expect(verifier.verify(firstAgain.accessToken)).rejects.toMatchObject({
      reason: "token_revoked",
    });
    expect((await verifier.verify(secondSignup.accessToken)).sub).toBe(secondSignup.user.id);
  });
});

describe("verification and recovery", () => {
  test("consumes verification and recovery tokens once and revokes sessions after recovery", async () => {
    const verificationTokens: string[] = [];
    const recoveryTokens: string[] = [];
    let markRecoveryDelivered!: () => void;
    const recoveryDelivered = new Promise<void>((resolve) => {
      markRecoveryDelivered = resolve;
    });
    const { service, verifier } = fixture("open", {
      verification: ({ token }) => {
        verificationTokens.push(token);
      },
      recovery: ({ token }) => {
        recoveryTokens.push(token);
        markRecoveryDelivered();
      },
    });
    const session = await firstAdmin(service);
    expect(verificationTokens).toHaveLength(1);
    await service.verifyIdentifier({ token: verificationTokens[0]! });
    expect(await errorReason(service.verifyIdentifier({ token: verificationTokens[0]! }))).toBe("verification_invalid");

    await service.beginRecovery({
      identifier: { kind: "email", value: "owner@example.test" },
    });
    await recoveryDelivered;
    expect(recoveryTokens).toHaveLength(1);
    await service.completeRecovery({
      token: recoveryTokens[0]!,
      newPassword: "a different secure password",
    });
    expect(await errorReason(service.completeRecovery({
      token: recoveryTokens[0]!,
      newPassword: "another secure password",
    }))).toBe("recovery_invalid");
    await expect(verifier.verify(session.accessToken)).rejects.toMatchObject({
      reason: "token_revoked",
    });
    const recovered = await service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "a different secure password",
    });
    expect(recovered.user.id).toBe(session.user.id);
  });

  test("unknown recovery requests are indistinguishable and do not call delivery hooks", async () => {
    const delivered: string[] = [];
    const { service } = fixture("open", {
      recovery: ({ token }) => {
        delivered.push(token);
      },
    });
    await firstAdmin(service);
    expect(await service.beginRecovery({
      identifier: { kind: "email", value: "unknown@example.test" },
    })).toEqual({ accepted: true });
    expect(delivered).toHaveLength(0);
  });
});

describe("mountable lifecycle API and schemas", () => {
  test("supports signup/login/refresh/logout without echoing credentials", async () => {
    const { service } = fixture("open");
    const api = createIdentityLifecycleApi({ service });
    const signup = await api.handle(new Request("http://local/v1/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: { kind: "email", value: "api@example.test" },
        password: "a sufficiently strong password",
        displayName: "API User",
      }),
    }));
    expect(signup.status).toBe(201);
    const signupBody = await signup.json();
    expect(signupBody.refreshToken).toBeString();
    expect(JSON.stringify(signupBody)).not.toContain("a sufficiently strong password");

    const login = await api.handle(new Request("http://local/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identifier: { kind: "email", value: "api@example.test" },
        password: "wrong",
      }),
    }));
    expect(login.status).toBe(401);
    expect(await login.json()).toEqual({
      error: "authentication_failed",
      reason: "invalid_credentials",
    });

    const refresh = await api.handle(new Request("http://local/v1/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: signupBody.refreshToken }),
    }));
    expect(refresh.status).toBe(200);
    const refreshBody = await refresh.json();
    expect(refreshBody.refreshToken).not.toBe(signupBody.refreshToken);
  });

  test("CLI bootstrap reads and writes owner-only secret files without printing tokens", async () => {
    const directory = await mkdtemp(join(tmpdir(), "identities-lifecycle-cli-"));
    const passwordPath = join(directory, "password");
    const sessionPath = join(directory, "session.json");
    const storePath = join(directory, "identities.json");
    await writeFile(passwordPath, "a secure bootstrap password\n", { mode: 0o600 });
    await chmod(passwordPath, 0o600);
    const { service } = fixture("open");
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCli([
        "--json",
        "--store",
        storePath,
        "auth",
        "bootstrap",
        "--identifier-kind",
        "email",
        "--identifier",
        "cli@example.test",
        "--password-file",
        passwordPath,
        "--display-name",
        "CLI Owner",
        "--session-file",
        sessionPath,
      ], { lifecycleService: service });
      expect(process.exitCode).not.toBe(1);
      const output = log.mock.calls.map((call) => String(call[0])).join("\n");
      const session = await readFile(sessionPath, "utf8");
      expect(output).not.toContain("a secure bootstrap password");
      expect(output).not.toContain(JSON.parse(session).refreshToken);
      expect(JSON.parse(output)).toMatchObject({
        bootstrapped: true,
        sessionFileCreated: true,
      });
      expect((await stat(sessionPath)).mode & 0o077).toBe(0);
    } finally {
      log.mockRestore();
      process.exitCode = 0;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("lifecycle migrations", () => {
  test("are versioned, idempotent on reapply, and define reverse-order rollback", () => {
    const migrations = identityLifecycleMigrations();
    expect(migrations.map((migration) => migration.id)).toEqual([
      "identities_0004_user_tenancy",
      "identities_0005_user_credentials",
      "identities_0006_user_sessions",
      "identities_0007_user_verification_recovery",
      "identities_0008_user_login_throttle",
      "identities_0009_user_lifecycle_security",
    ]);
    for (const migration of migrations) {
      expect(migration.up).toContain("IF NOT EXISTS");
      expect(migration.down).toContain("IF EXISTS");
      expect(migration.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    const rollbackOrder = migrations
      .slice()
      .reverse()
      .map((migration) => migration.id);
    expect(rollbackOrder).toEqual([
      "identities_0009_user_lifecycle_security",
      "identities_0008_user_login_throttle",
      "identities_0007_user_verification_recovery",
      "identities_0006_user_sessions",
      "identities_0005_user_credentials",
      "identities_0004_user_tenancy",
    ]);
  });
});

describe("review-A lifecycle security regressions", () => {
  test("enforces invite role order, management scope, actor scope subset, and tenant allowlist", async () => {
    const { service, store } = fixture("invite");
    const owner = await firstAdmin(service);

    expect(await errorReason(service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      role: "member",
      scopes: ["root:arbitrary"],
    }))).toBe("invalid_scope");

    const adminInvite = await service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      identifier: { kind: "email", value: "limited-admin@example.test" },
      role: "admin",
      scopes: ["runs:read"],
    });
    const admin = await service.signup({
      identifier: { kind: "email", value: "limited-admin@example.test" },
      password: "a sufficiently strong password",
      displayName: "Limited Admin",
      inviteToken: adminInvite.token,
    });

    expect(await errorReason(service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: owner.tenant.id,
      role: "owner",
      scopes: ["runs:read"],
    }))).toBe("forbidden");
    expect(await errorReason(service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: owner.tenant.id,
      role: "member",
      scopes: ["runs:read"],
    }))).toBe("forbidden");

    const pendingInvite = await service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      identifier: { kind: "email", value: "stale-invite@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    const mutable = store as unknown as {
      state: { memberships: Array<{ userId: string; tenantId: string; scopes: string[] }> };
    };
    const currentOwner = mutable.state.memberships.find(
      (membership) => membership.userId === owner.user.id && membership.tenantId === owner.tenant.id,
    )!;
    currentOwner.scopes = currentOwner.scopes.filter((scope) => scope !== "identities:invites:manage");
    expect(await errorReason(service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      role: "member",
      scopes: ["runs:read"],
    }))).toBe("forbidden");
    expect(await errorReason(service.signup({
      identifier: { kind: "email", value: "stale-invite@example.test" },
      password: "a sufficiently strong password",
      displayName: "Stale Invite",
      inviteToken: pendingInvite.token,
    }))).toBe("invite_invalid");
  });

  test("intersects current membership scopes at session creation and refresh and revokes an incompatible family", async () => {
    const gatedHasher = new GatedPasswordHasher();
    const creationFixture = fixture("open", { hasher: gatedHasher });
    const creationAdmin = await firstAdmin(creationFixture.service, "creation-owner@example.test");
    const creationLogin = creationFixture.service.login({
      identifier: { kind: "email", value: "creation-owner@example.test" },
      password: "correct horse battery staple",
    });
    for (let turn = 0; turn < 20 && gatedHasher.active === 0; turn += 1) await Promise.resolve();
    const creationMutable = creationFixture.store as unknown as {
      state: { memberships: Array<{ userId: string; tenantId: string; scopes: string[] }> };
    };
    creationMutable.state.memberships.find(
      (membership) =>
        membership.userId === creationAdmin.user.id && membership.tenantId === creationAdmin.tenant.id,
    )!.scopes = ["runs:read"];
    gatedHasher.release();
    expect((await creationLogin).scopes).toEqual(["runs:read"]);

    const { service, store, verifier } = fixture("open");
    const initial = await firstAdmin(service);
    const mutable = store as unknown as {
      state: {
        memberships: Array<{ userId: string; tenantId: string; scopes: string[] }>;
      };
    };
    const membership = mutable.state.memberships.find(
      (candidate) => candidate.userId === initial.user.id && candidate.tenantId === initial.tenant.id,
    )!;
    membership.scopes = ["runs:read"];

    const narrowed = await service.refresh({ refreshToken: initial.refreshToken });
    expect(narrowed.scopes).toEqual(["runs:read"]);

    membership.scopes = [];
    expect(await errorReason(service.refresh({ refreshToken: narrowed.refreshToken }))).toBe("refresh_invalid");
    await expect(verifier.verify(narrowed.accessToken)).rejects.toMatchObject({
      reason: "session_inactive",
    });
  });

  test("does not let a tenant admin globally disable a multi-tenant owner", async () => {
    const { service, store, verifier } = fixture("open");
    const target = await firstAdmin(service);
    const actorPersonal = await service.signup({
      identifier: { kind: "email", value: "tenant-admin@example.test" },
      password: "a sufficiently strong password",
      displayName: "Tenant Admin",
    });
    const mutable = store as unknown as {
      state: {
        tenants: Array<{ id: string; slug: string; name: string; createdAt: string; allowedScopes?: string[] }>;
        memberships: Array<{
          id: string;
          userId: string;
          tenantId: string;
          role: "owner" | "admin" | "member";
          scopes: string[];
          createdAt: string;
          status?: "active" | "suspended";
        }>;
      };
    };
    mutable.state.memberships.push({
      id: "mem_tenant_admin",
      userId: actorPersonal.user.id,
      tenantId: target.tenant.id,
      role: "admin",
      scopes: ["runs:read", "identities:invites:manage"],
      status: "active",
      createdAt: new Date().toISOString(),
    });
    mutable.state.tenants.push({
      id: "ten_second_owner",
      slug: "second-owner",
      name: "Second Owner Tenant",
      allowedScopes: ["runs:read"],
      createdAt: new Date().toISOString(),
    });
    mutable.state.memberships.push({
      id: "mem_second_owner",
      userId: target.user.id,
      tenantId: "ten_second_owner",
      role: "owner",
      scopes: ["runs:read"],
      status: "active",
      createdAt: new Date().toISOString(),
    });
    const actor = await service.login({
      identifier: { kind: "email", value: "tenant-admin@example.test" },
      password: "a sufficiently strong password",
      tenantId: target.tenant.id,
    });

    expect(await errorReason(service.disableUser({
      actorAccessToken: actor.accessToken,
      userId: target.user.id,
    }))).toBe("forbidden");
    expect((await verifier.verify(target.accessToken)).sub).toBe(target.user.id);

    const multiTenantMember = await service.signup({
      identifier: { kind: "email", value: "multi-tenant-member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Multi Tenant Member",
    });
    mutable.state.memberships.push({
      id: "mem_multi_tenant_member",
      userId: multiTenantMember.user.id,
      tenantId: target.tenant.id,
      role: "member",
      scopes: ["runs:read"],
      status: "active",
      createdAt: new Date().toISOString(),
    });
    const suspended = await service.suspendMembership({
      actorAccessToken: actor.accessToken,
      tenantId: target.tenant.id,
      userId: multiTenantMember.user.id,
    });
    expect(suspended.status).toBe("suspended");
    expect(
      store.snapshot().users.find((user) => user.id === multiTenantMember.user.id)?.status,
    ).toBe("active");
    expect((await verifier.verify(multiTenantMember.accessToken)).sub).toBe(multiTenantMember.user.id);

    const tenantBoundary = fixture("open");
    await firstAdmin(tenantBoundary.service, "platform-owner@example.test");
    const personalOwner = await tenantBoundary.service.signup({
      identifier: { kind: "email", value: "personal-owner@example.test" },
      password: "a sufficiently strong password",
      displayName: "Personal Owner",
    });
    const lowerTarget = await tenantBoundary.service.signup({
      identifier: { kind: "email", value: "lower-target@example.test" },
      password: "a sufficiently strong password",
      displayName: "Lower Target",
    });
    const tenantBoundaryMutable = tenantBoundary.store as unknown as {
      state: { memberships: Array<{ userId: string; role: "owner" | "admin" | "member" }> };
    };
    tenantBoundaryMutable.state.memberships.find(
      (membership) => membership.userId === lowerTarget.user.id,
    )!.role = "member";
    expect(await errorReason(tenantBoundary.service.disableUser({
      actorAccessToken: personalOwner.accessToken,
      userId: lowerTarget.user.id,
    }))).toBe("forbidden");
  });

  test("atomically revokes issued JTIs and sessions while verification observes current user state", async () => {
    const { service, store, verifier } = fixture("invite");
    const owner = await firstAdmin(service);
    const invite = await service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      identifier: { kind: "email", value: "atomic-member@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    const member = await service.signup({
      identifier: { kind: "email", value: "atomic-member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Atomic Member",
      inviteToken: invite.token,
    });

    await service.disableUser({
      actorAccessToken: owner.accessToken,
      userId: member.user.id,
    });
    const snapshot = store.snapshot();
    expect(snapshot.users.find((user) => user.id === member.user.id)?.status).toBe("disabled");
    expect(
      snapshot.sessionFamilies
        .filter((family) => family.userId === member.user.id)
        .every((family) => family.status !== "active"),
    ).toBe(true);
    expect(snapshot.jtiRevocations.some((revocation) => revocation.userId === member.user.id)).toBe(true);
    await expect(verifier.verify(member.accessToken)).rejects.toMatchObject({
      reason: "token_revoked",
    });

    const stateFixture = fixture("open");
    const stateSession = await firstAdmin(stateFixture.service, "state-check@example.test");
    const mutable = stateFixture.store as unknown as {
      state: { users: Array<{ id: string; status: "active" | "disabled" | "deleted" }> };
    };
    mutable.state.users.find((user) => user.id === stateSession.user.id)!.status = "disabled";
    await expect(stateFixture.verifier.verify(stateSession.accessToken)).rejects.toMatchObject({
      reason: "session_inactive",
    });
  });

  test("atomically reserves bounded login work before password verification", async () => {
    const hasher = new GatedPasswordHasher();
    const { service } = fixture("open", { hasher });
    await firstAdmin(service);
    hasher.verifyCalls = 0;
    const attempts = Array.from({ length: 6 }, () =>
      service.login({
        identifier: { kind: "email", value: "owner@example.test" },
        password: "wrong",
        throttleKey: "one-client",
      }).catch((error) => error),
    );
    for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
    hasher.release();
    const results = await Promise.all(attempts);
    expect(hasher.maxActive).toBeLessThanOrEqual(2);
    expect(results.some((result) => result instanceof IdentityLifecycleError && result.reason === "rate_limited")).toBe(
      true,
    );

    const staleStore = new InMemoryIdentityLifecycleStore({
      loginThrottles: [{
        keyHash: "a".repeat(64),
        failures: 0,
        windowStartedAt: "2026-01-01T00:00:00.000Z",
        tokens: 2,
        lastRefilledAt: "2026-01-01T00:00:00.000Z",
        inFlight: 2,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    expect(
      await staleStore.reserveAuthAttempt({
        failureKeyHash: "a".repeat(64),
        admissionKeyHash: "b".repeat(64),
      }, new Date("2026-01-01T00:06:00.000Z"), {
        maxFailures: 3,
        windowSeconds: 300,
        lockSeconds: 300,
        maxConcurrent: 2,
      }),
    ).toBe(true);
  });

  test("prewarms the dummy hash, equalizes recovery work, throttles by identifier and client, and delivers async", async () => {
    const hasher = new FastPasswordHasher();
    let releaseDelivery!: () => void;
    let deliveryStarted!: () => void;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const started = new Promise<void>((resolve) => {
      deliveryStarted = resolve;
    });
    const delivered: string[] = [];
    const { service } = fixture("open", {
      hasher,
      recovery: async ({ token }) => {
        delivered.push(token);
        deliveryStarted();
        await deliveryGate;
      },
    });
    expect(hasher.dummyHashCalls).toBe(1);
    await firstAdmin(service);
    hasher.verifyCalls = 0;

    await service.beginRecovery({
      identifier: { kind: "email", value: "unknown@example.test" },
      throttleKey: "recovery-client",
    });
    expect(hasher.verifyCalls).toBe(1);

    const known = service.beginRecovery({
      identifier: { kind: "email", value: "OWNER@EXAMPLE.TEST" },
      throttleKey: "recovery-client",
    });
    let responseResolved = false;
    void known.then(() => {
      responseResolved = true;
    });
    await started;
    const resolvedBeforeDelivery = responseResolved;
    releaseDelivery();
    await known;
    expect(resolvedBeforeDelivery).toBe(true);
    expect(hasher.verifyCalls).toBe(2);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await service.beginRecovery({
        identifier: {
          kind: "email",
          value: attempt % 2 === 0 ? "owner@example.test" : " OWNER@EXAMPLE.TEST ",
        },
        throttleKey: "bounded-recovery-client",
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(delivered.length).toBeLessThanOrEqual(4);
  });

  test("canonicalizes UTS-46 IDN domains and exposes migration collision audit", async () => {
    const unicode = normalizeLoginIdentifier({ kind: "email", value: "User@bücher.example" });
    const ascii = normalizeLoginIdentifier({ kind: "email", value: "user@xn--bcher-kva.example" });
    expect(unicode).toEqual(ascii);

    const { service, store } = fixture("open");
    await service.signup({
      identifier: { kind: "email", value: "User@bücher.example" },
      password: "a sufficiently strong password",
      displayName: "Unicode",
    });
    expect(await errorReason(service.signup({
      identifier: { kind: "email", value: "user@xn--bcher-kva.example" },
      password: "a sufficiently strong password",
      displayName: "Punycode",
    }))).toBe("duplicate_identifier");
    expect(store.snapshot().users).toHaveLength(1);

    const lifecycleModule = await import("./user-lifecycle.js");
    expect(typeof (lifecycleModule as Record<string, unknown>)["auditLoginIdentifierCanonicalization"]).toBe(
      "function",
    );
  });
});

describe("review-B lifecycle security regressions", () => {
  test("persists only the authoritative invite management scope and rechecks creator scope", async () => {
    const { service, store } = fixture("invite");
    const owner = await firstAdmin(service);
    const token = "review-b-authoritative-invite-token";
    const now = new Date();

    const forgedInvite: IdentityInviteRecord = {
      id: "inv_review_b_authoritative_scope",
      tenantId: owner.tenant.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      identifierKind: "email",
      normalizedIdentifier: "review-b-scope@example.test",
      managementScope: "runs:read",
      role: "member",
      scopes: ["runs:read"],
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      createdByUserId: owner.user.id,
      createdAt: now.toISOString(),
    };
    await store.createInvite(forgedInvite, {
      actorTokenScopes: owner.scopes,
      inviteManagementScope: DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE,
    });

    expect(
      store.snapshot().invites.find((invite) => invite.id === "inv_review_b_authoritative_scope")
        ?.managementScope,
    ).toBe(DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE);

    const mutable = store as unknown as {
      state: { memberships: Array<{ userId: string; tenantId: string; scopes: string[] }> };
    };
    const creatorMembership = mutable.state.memberships.find(
      (membership) => membership.userId === owner.user.id && membership.tenantId === owner.tenant.id,
    )!;
    creatorMembership.scopes = creatorMembership.scopes.filter(
      (scope) => scope !== DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE,
    );

    expect(await errorReason(service.signup({
      identifier: { kind: "email", value: "review-b-scope@example.test" },
      password: "a sufficiently strong password",
      displayName: "Review B Scope",
      inviteToken: token,
    }))).toBe("invite_invalid");
    expect(store.snapshot().users).toHaveLength(1);
    expect(
      store.snapshot().invites.find((invite) => invite.id === "inv_review_b_authoritative_scope")
        ?.consumedAt,
    ).toBeUndefined();
  });

  test("bounds one client's Argon2 work across distinct unknown identifiers", async () => {
    const hasher = new GatedPasswordHasher();
    const { service, store } = fixture("open", { hasher });
    await firstAdmin(service);
    hasher.verifyCalls = 0;

    const attempts = Array.from({ length: 8 }, (_, index) =>
      service.login({
        identifier: { kind: "email", value: `unknown-${index}@example.test` },
        password: "wrong",
        throttleKey: "one-fanout-client",
      }).catch((error) => error),
    );
    for (let turn = 0; turn < 50 && hasher.active < 2; turn += 1) await Promise.resolve();
    hasher.release();
    const results = await Promise.all(attempts);

    expect(hasher.maxActive).toBeLessThanOrEqual(2);
    expect(
      results.filter(
        (result) => result instanceof IdentityLifecycleError && result.reason === "rate_limited",
      ),
    ).toHaveLength(6);
    expect(store.snapshot().loginThrottles.every((throttle) => (throttle.inFlight ?? 0) === 0)).toBe(
      true,
    );
  });
});

describe("review-C2 lifecycle security regressions", () => {
  test("requires an owner or admin role even when a member holds the invite-management scope", async () => {
    const { service } = fixture("invite");
    const owner = await firstAdmin(service);
    const memberInvite = await service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: owner.tenant.id,
      identifier: { kind: "email", value: "review-c2-member@example.test" },
      role: "member",
      scopes: ["runs:read", DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE],
    });
    const member = await service.signup({
      identifier: { kind: "email", value: "review-c2-member@example.test" },
      password: "a sufficiently strong password",
      displayName: "Review C2 Member",
      inviteToken: memberInvite.token,
    });

    expect(await errorReason(service.createInvite({
      actorAccessToken: member.accessToken,
      tenantId: owner.tenant.id,
      role: "member",
      scopes: ["runs:read"],
    }))).toBe("forbidden");
  });

  test("keeps known and unknown recovery response distributions behind the same bounded floor", async () => {
    expect(() => fixture("open", { recoveryMinimumResponseMs: 99 })).toThrow(
      "recoveryMinimumResponseMs must be an integer between 100 and 5000",
    );
    expect(() => fixture("open", { recoveryMinimumResponseMs: 5_001 })).toThrow(
      "recoveryMinimumResponseMs must be an integer between 100 and 5000",
    );
    const { service, store } = fixture("open");
    await firstAdmin(service);
    const createOneTimeToken = store.createOneTimeToken.bind(store);
    store.createOneTimeToken = async (token) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      await createOneTimeToken(token);
    };

    const knownDurations: number[] = [];
    const unknownDurations: number[] = [];
    for (let sample = 0; sample < 4; sample += 1) {
      let startedAt = performance.now();
      await service.beginRecovery({
        identifier: { kind: "email", value: `unknown-c2-${sample}@example.test` },
        throttleKey: `review-c2-unknown-${sample}`,
      });
      unknownDurations.push(performance.now() - startedAt);

      startedAt = performance.now();
      await service.beginRecovery({
        identifier: { kind: "email", value: "owner@example.test" },
        throttleKey: `review-c2-known-${sample}`,
      });
      knownDurations.push(performance.now() - startedAt);
    }

    const median = (samples: readonly number[]): number => {
      const ordered = [...samples].sort((left, right) => left - right);
      return ordered[Math.floor(ordered.length / 2)]!;
    };
    const knownMedian = median(knownDurations);
    const unknownMedian = median(unknownDurations);

    expect(knownMedian).toBeGreaterThanOrEqual(225);
    expect(unknownMedian).toBeGreaterThanOrEqual(225);
    expect(Math.abs(knownMedian - unknownMedian)).toBeLessThan(40);
  }, 10_000);
});
