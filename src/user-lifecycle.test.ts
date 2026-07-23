import { beforeAll, describe, expect, spyOn, test } from "bun:test";
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
  IdentityLifecycleError,
  IdentityLifecycleService,
  InMemoryIdentityLifecycleStore,
  createIdentityLifecycleApi,
  identityLifecycleMigrations,
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

  async hash(password: string): Promise<string> {
    return `test$${password}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    this.verifyCalls += 1;
    return encoded === `test$${password}`;
  }

  async dummyHash(): Promise<string> {
    return "test$dummy-password-that-never-matches";
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
    hooks: {
      deliverRecovery: options.recovery,
      deliverVerification: options.verification,
    },
    defaultScopes: ["runs:read", "runs:write", "identity:read"],
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
    const { service } = fixture("open");
    const admin = await firstAdmin(service);
    await service.disableUser({
      actorAccessToken: admin.accessToken,
      userId: admin.user.id,
    });
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "correct horse battery staple",
    }))).toBe("invalid_credentials");
    await service.restoreUser({ userId: admin.user.id });
    const restored = await service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "correct horse battery staple",
    });
    await service.softDeleteUser({
      actorAccessToken: restored.accessToken,
      userId: admin.user.id,
    });
    expect(await errorReason(service.login({
      identifier: { kind: "email", value: "owner@example.test" },
      password: "correct horse battery staple",
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
      reason: "session_inactive",
    });
    expect((await verifier.verify(secondSignup.accessToken)).sub).toBe(secondSignup.user.id);
  });
});

describe("verification and recovery", () => {
  test("consumes verification and recovery tokens once and revokes sessions after recovery", async () => {
    const verificationTokens: string[] = [];
    const recoveryTokens: string[] = [];
    const { service, verifier } = fixture("open", {
      verification: ({ token }) => {
        verificationTokens.push(token);
      },
      recovery: ({ token }) => {
        recoveryTokens.push(token);
      },
    });
    const session = await firstAdmin(service);
    expect(verificationTokens).toHaveLength(1);
    await service.verifyIdentifier({ token: verificationTokens[0]! });
    expect(await errorReason(service.verifyIdentifier({ token: verificationTokens[0]! }))).toBe("verification_invalid");

    await service.beginRecovery({
      identifier: { kind: "email", value: "owner@example.test" },
    });
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
      reason: "session_inactive",
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
      "identities_0008_user_login_throttle",
      "identities_0007_user_verification_recovery",
      "identities_0006_user_sessions",
      "identities_0005_user_credentials",
      "identities_0004_user_tenancy",
    ]);
  });
});
