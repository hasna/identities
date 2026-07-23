import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, type CryptoKey, type JWK, type KeyObject } from "jose";
import { Pool } from "pg";
import { createQueryClient, type PoolQueryClient } from "./generated/storage-kit/query.js";
import {
  IdentityAccessTokenIssuer,
  IdentityAccessTokenVerifier,
  IdentityJwksRegistry,
} from "./identity-auth.js";
import { rollbackIdentityLifecycleMigrations } from "./migrations.js";
import { PgIdentityLifecycleStore } from "./pg-user-lifecycle.js";
import { runIdentitiesMigrations } from "./pg-store.js";
import {
  Argon2idIdentityPasswordHasher,
  IdentityLifecycleError,
  IdentityLifecycleService,
  identityLifecycleMigrations,
} from "./user-lifecycle.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];
const describeLive = databaseUrl === undefined ? describe.skip : describe;
const ISSUER = "https://identity-pg.example.test";

type SigningKey = CryptoKey | KeyObject;

describeLive("PgIdentityLifecycleStore live Postgres", () => {
  let client: PoolQueryClient;
  let privateKey: SigningKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 6 });
    client = createQueryClient(pool);
    const pair = await generateKeyPair("EdDSA");
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    await runIdentitiesMigrations(client);
  });

  afterAll(async () => {
    await client.close();
  });

  function service(registrationPolicy: "open" | "invite" = "open") {
    const registry = new IdentityJwksRegistry({
      issuer: ISSUER,
      revision: 1,
      keys: [{ kid: "live", alg: "EdDSA", status: "active", publicJwk }],
    });
    const store = new PgIdentityLifecycleStore(client);
    const tokenIssuer = new IdentityAccessTokenIssuer({
      registry,
      privateKey,
      kid: "live",
      alg: "EdDSA",
      issuer: ISSUER,
      audience: "infinity-pg",
      accessTokenTtlSeconds: 300,
    });
    const verifier = new IdentityAccessTokenVerifier({
      issuer: ISSUER,
      audience: "infinity-pg",
      algorithms: ["EdDSA"],
      jwks: registry,
      tokenState: store,
      clockToleranceSeconds: 0,
      maxTokenLifetimeSeconds: 300,
    });
    return {
      store,
      verifier,
      service: new IdentityLifecycleService({
        store,
        registrationPolicy,
        bootstrapTenant: { slug: "infinity-pg", name: "Infinity PG" },
        passwordHasher: new Argon2idIdentityPasswordHasher({
          memoryCost: 32_768,
          timeCost: 2,
        }),
        tokenIssuer,
        tokenVerifier: verifier,
        defaultScopes: [
          "runs:read",
          "runs:write",
          "identities:invites:manage",
          "identities:platform:admin",
        ],
        loginThrottle: {
          maxFailures: 3,
          windowSeconds: 300,
          lockSeconds: 300,
          maxConcurrent: 2,
        },
      }),
    };
  }

  test("migrations reapply without drift, roll back in reverse, and reapply cleanly", async () => {
    const reapplied = await runIdentitiesMigrations(client);
    expect(reapplied.plan.every((item) => item.state === "already_applied")).toBe(true);

    const rolledBack = await rollbackIdentityLifecycleMigrations(client, {
      allowDestructive: true,
    });
    expect(rolledBack.rolledBack).toEqual([
      "identities_0009_user_lifecycle_security",
      "identities_0008_user_login_throttle",
      "identities_0007_user_verification_recovery",
      "identities_0006_user_sessions",
      "identities_0005_user_credentials",
      "identities_0004_user_tenancy",
    ]);
    const missing = await client.one<{ table_name: string | null }>(
      "SELECT to_regclass('public.identity_users')::text AS table_name",
    );
    expect(missing.table_name).toBeNull();

    const restored = await runIdentitiesMigrations(client);
    const lifecycleIds = new Set(identityLifecycleMigrations().map((migration) => migration.id));
    expect(
      restored.plan
        .filter((item) => lifecycleIds.has(item.migration.id))
        .every((item) => item.state === "pending"),
    ).toBe(true);
    const present = await client.one<{ table_name: string | null }>(
      "SELECT to_regclass('public.identity_users')::text AS table_name",
    );
    expect(present.table_name).toBe("identity_users");
  });

  test("persists atomic signup, tenant-bound sessions, rotation, replay, and revocation", async () => {
    const live = service();
    const admin = await live.service.bootstrapFirstAdmin({
      identifier: { kind: "email", value: "owner@pg.example.test" },
      password: "correct horse battery staple",
      displayName: "PG Owner",
    });
    expect((await live.verifier.verify(admin.accessToken)).tenant).toBe(admin.tenant.id);
    const narrow = await live.service.login({
      identifier: { kind: "email", value: "owner@pg.example.test" },
      password: "correct horse battery staple",
      tenantId: admin.tenant.id,
      scopes: ["runs:read"],
    });
    const narrowRotated = await live.service.refresh({ refreshToken: narrow.refreshToken });
    expect(narrowRotated.scopes).toEqual(["runs:read"]);

    const concurrent = await Promise.allSettled([
      live.service.signup({
        identifier: { kind: "email", value: "race@pg.example.test" },
        password: "a secure concurrent password",
        displayName: "Race One",
      }),
      live.service.signup({
        identifier: { kind: "email", value: " RACE@PG.EXAMPLE.TEST " },
        password: "a secure concurrent password",
        displayName: "Race Two",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(IdentityLifecycleError);
    expect((rejected.reason as IdentityLifecycleError).reason).toBe("duplicate_identifier");

    const rotated = await live.service.refresh({ refreshToken: admin.refreshToken });
    expect(rotated.refreshToken).not.toBe(admin.refreshToken);
    await expect(live.service.refresh({ refreshToken: admin.refreshToken })).rejects.toMatchObject({
      reason: "refresh_replay",
    });
    await expect(live.verifier.verify(rotated.accessToken)).rejects.toMatchObject({
      reason: "session_inactive",
    });

    const familyRows = await client.many<{ status: string; session_hash: string }>(
      "SELECT status, session_hash FROM identity_session_families WHERE user_id = $1",
      [admin.user.id],
    );
    expect(familyRows.some((row) => row.status === "revoked")).toBe(true);
    expect(familyRows.every((row) => /^[a-f0-9]{64}$/.test(row.session_hash))).toBe(true);
    const refreshRows = await client.many<{ token_hash: string }>(
      "SELECT token_hash FROM identity_refresh_tokens",
    );
    expect(refreshRows.every((row) => /^[a-f0-9]{64}$/.test(row.token_hash))).toBe(true);
    expect(JSON.stringify(refreshRows)).not.toContain(admin.refreshToken);
  });

  test("enforces review-A authorization, current scope, atomic state, throttle, and IDN invariants", async () => {
    const live = service("invite");
    await live.service.ready();
    const ownerTenant = await client.one<{ id: string }>(
      "SELECT id FROM identity_tenants WHERE slug = 'infinity-pg'",
    );
    const owner = await live.service.login({
      identifier: { kind: "email", value: "owner@pg.example.test" },
      password: "correct horse battery staple",
      tenantId: ownerTenant.id,
    });

    await expect(live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      role: "member",
      scopes: ["root:arbitrary"],
    })).rejects.toMatchObject({ reason: "invalid_scope" });

    const adminInvite = await live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      identifier: { kind: "email", value: "pg-admin@example.test" },
      role: "admin",
      scopes: ["runs:read", "identities:invites:manage"],
    });
    const admin = await live.service.signup({
      identifier: { kind: "email", value: "pg-admin@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Admin",
      inviteToken: adminInvite.token,
    });
    await expect(live.service.createInvite({
      actorAccessToken: admin.accessToken,
      tenantId: ownerTenant.id,
      role: "owner",
      scopes: ["runs:read"],
    })).rejects.toMatchObject({ reason: "forbidden" });
    await expect(live.service.disableUser({
      actorAccessToken: admin.accessToken,
      userId: owner.user.id,
    })).rejects.toMatchObject({ reason: "forbidden" });
    expect((await live.verifier.verify(owner.accessToken)).sub).toBe(owner.user.id);

    const memberInvite = await live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      identifier: { kind: "email", value: "pg-scope-member@example.test" },
      role: "member",
      scopes: ["runs:read", "runs:write"],
    });
    const member = await live.service.signup({
      identifier: { kind: "email", value: "pg-scope-member@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Scope Member",
      inviteToken: memberInvite.token,
    });
    await client.execute(
      "UPDATE identity_memberships SET scopes = $3::jsonb WHERE tenant_id = $1 AND user_id = $2",
      [ownerTenant.id, member.user.id, JSON.stringify(["runs:read"])],
    );
    const directNow = new Date();
    const directFamily = {
      id: "ses_pg_scope_intersection",
      userId: member.user.id,
      tenantId: ownerTenant.id,
      scopes: ["runs:read", "runs:write"],
      status: "active" as const,
      expiresAt: new Date(directNow.getTime() + 300_000).toISOString(),
      createdAt: directNow.toISOString(),
      updatedAt: directNow.toISOString(),
    };
    await live.store.createSession({
      family: directFamily,
      refresh: {
        id: "rft_pg_scope_intersection",
        familyId: directFamily.id,
        tokenHash: "b".repeat(64),
        generation: 0,
        expiresAt: directFamily.expiresAt,
        createdAt: directNow.toISOString(),
      },
    });
    expect(directFamily.scopes).toEqual(["runs:read"]);
    const narrowed = await live.service.refresh({ refreshToken: member.refreshToken });
    expect(narrowed.scopes).toEqual(["runs:read"]);
    await client.execute(
      "UPDATE identity_memberships SET scopes = '[]'::jsonb WHERE tenant_id = $1 AND user_id = $2",
      [ownerTenant.id, member.user.id],
    );
    await expect(live.service.refresh({ refreshToken: narrowed.refreshToken })).rejects.toMatchObject({
      reason: "refresh_invalid",
    });
    await expect(live.verifier.verify(narrowed.accessToken)).rejects.toMatchObject({
      reason: "session_inactive",
    });

    const disableInvite = await live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      identifier: { kind: "email", value: "pg-disable-member@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    const disabled = await live.service.signup({
      identifier: { kind: "email", value: "pg-disable-member@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Disabled Member",
      inviteToken: disableInvite.token,
    });
    await live.service.disableUser({
      actorAccessToken: owner.accessToken,
      userId: disabled.user.id,
    });
    const atomicState = await client.one<{
      status: string;
      active_families: string;
      revoked_jtis: string;
    }>(
      `SELECT
         identity_user.status,
         (
           SELECT count(*)::text
           FROM identity_session_families family
           WHERE family.user_id = identity_user.id AND family.status = 'active'
         ) AS active_families,
         (
           SELECT count(*)::text
           FROM identity_jti_revocations revocation
           WHERE revocation.user_id = identity_user.id
         ) AS revoked_jtis
       FROM identity_users identity_user
       WHERE identity_user.id = $1`,
      [disabled.user.id],
    );
    expect(atomicState).toMatchObject({
      status: "disabled",
      active_families: "0",
    });
    expect(Number(atomicState.revoked_jtis)).toBeGreaterThan(0);
    await expect(live.verifier.verify(disabled.accessToken)).rejects.toMatchObject({
      reason: "token_revoked",
    });

    const throttleKey = "a".repeat(64);
    const admitted = await Promise.all(
      Array.from({ length: 6 }, () =>
        live.store.reserveAuthAttempt(throttleKey, new Date(), {
          maxFailures: 3,
          windowSeconds: 300,
          lockSeconds: 300,
          maxConcurrent: 2,
        }),
      ),
    );
    expect(admitted.filter(Boolean)).toHaveLength(2);
    await Promise.all(
      admitted.filter(Boolean).map(() =>
        live.store.completeAuthAttempt(throttleKey, new Date(), "failure", {
          maxFailures: 3,
          windowSeconds: 300,
          lockSeconds: 300,
          maxConcurrent: 2,
        }),
      ),
    );
    await client.execute(
      `UPDATE identity_login_throttle
       SET tokens = 2, in_flight = 2, updated_at = now() - interval '301 seconds'
       WHERE key_hash = $1`,
      [throttleKey],
    );
    expect(
      await live.store.reserveAuthAttempt(throttleKey, new Date(), {
        maxFailures: 3,
        windowSeconds: 300,
        lockSeconds: 300,
        maxConcurrent: 2,
      }),
    ).toBe(true);
    await live.store.completeAuthAttempt(throttleKey, new Date(), "failure", {
      maxFailures: 3,
      windowSeconds: 300,
      lockSeconds: 300,
      maxConcurrent: 2,
    });

    const openLive = service("open");
    const multiTenant = await openLive.service.signup({
      identifier: { kind: "email", value: "pg-multi-tenant@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Multi Tenant",
    });
    await client.execute(
      `INSERT INTO identity_memberships
         (id, tenant_id, user_id, role, scopes, status, created_at)
       VALUES ('mem_pg_multi_tenant', $1, $2, 'member', '["runs:read"]'::jsonb, 'active', now())`,
      [ownerTenant.id, multiTenant.user.id],
    );
    const suspended = await live.service.suspendMembership({
      actorAccessToken: admin.accessToken,
      tenantId: ownerTenant.id,
      userId: multiTenant.user.id,
    });
    expect(suspended.status).toBe("suspended");
    const multiTenantState = await client.one<{ status: string }>(
      "SELECT status FROM identity_users WHERE id = $1",
      [multiTenant.user.id],
    );
    expect(multiTenantState.status).toBe("active");
    expect((await openLive.verifier.verify(multiTenant.accessToken)).sub).toBe(multiTenant.user.id);

    const personalOwner = await openLive.service.signup({
      identifier: { kind: "email", value: "pg-personal-owner@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Personal Owner",
    });
    const lowerTarget = await openLive.service.signup({
      identifier: { kind: "email", value: "pg-lower-target@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Lower Target",
    });
    await client.execute(
      "UPDATE identity_memberships SET role = 'member' WHERE tenant_id = $1 AND user_id = $2",
      [lowerTarget.tenant.id, lowerTarget.user.id],
    );
    await expect(openLive.service.disableUser({
      actorAccessToken: personalOwner.accessToken,
      userId: lowerTarget.user.id,
    })).rejects.toMatchObject({ reason: "forbidden" });

    const unicode = await openLive.service.signup({
      identifier: { kind: "email", value: "idn@bücher.pg-example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Unicode",
    });
    await expect(openLive.service.signup({
      identifier: { kind: "email", value: "idn@xn--bcher-kva.pg-example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Punycode",
    })).rejects.toMatchObject({ reason: "duplicate_identifier" });
    expect(unicode.user.status).toBe("active");

    await client.execute(
      `INSERT INTO identity_login_identifiers (id, user_id, kind, normalized_value, created_at)
       VALUES
         ('lid_audit_unicode', $1, 'email', 'audit@bücher.pg-example.test', now()),
         ('lid_audit_ascii', $1, 'email', 'audit@xn--bcher-kva.pg-example.test', now())`,
      [owner.user.id],
    );
    await expect(live.store.prepare()).rejects.toMatchObject({
      reason: "invalid_configuration",
    });
    const collisionAudit = await client.many<{ collision: boolean }>(
      `SELECT collision
       FROM identity_login_identifier_canonicalization_audit
       WHERE identifier_id IN ('lid_audit_unicode', 'lid_audit_ascii')`,
    );
    expect(collisionAudit).toHaveLength(2);
    expect(collisionAudit.every((row) => row.collision)).toBe(true);
    await client.execute(
      `DELETE FROM identity_login_identifier_canonicalization_audit
       WHERE identifier_id IN ('lid_audit_unicode', 'lid_audit_ascii')`,
    );
    await client.execute(
      `DELETE FROM identity_login_identifiers
       WHERE id IN ('lid_audit_unicode', 'lid_audit_ascii')`,
    );

    const staleInvite = await live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      identifier: { kind: "email", value: "pg-stale-invite@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });
    await client.execute(
      `UPDATE identity_memberships
       SET scopes = scopes - 'identities:invites:manage'
       WHERE tenant_id = $1 AND user_id = $2`,
      [ownerTenant.id, owner.user.id],
    );
    await expect(live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      role: "member",
      scopes: ["runs:read"],
    })).rejects.toMatchObject({ reason: "forbidden" });
    await expect(live.service.signup({
      identifier: { kind: "email", value: "pg-stale-invite@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Stale Invite",
      inviteToken: staleInvite.token,
    })).rejects.toMatchObject({ reason: "invite_invalid" });
  });
});
