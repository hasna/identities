import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
  DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE,
  IdentityLifecycleError,
  IdentityLifecycleService,
  identityLifecycleMigrations,
  type IdentityInviteRecord,
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

    const admissionKeyHash = "f".repeat(64);
    const attemptKeys = Array.from({ length: 8 }, (_, index) => ({
      failureKeyHash: (index + 1).toString(16).padStart(64, "0"),
      admissionKeyHash,
    }));
    const admitted = await Promise.all(
      attemptKeys.map((keys) =>
        live.store.reserveAuthAttempt(keys, new Date(), {
          maxFailures: 3,
          windowSeconds: 300,
          lockSeconds: 300,
          maxConcurrent: 2,
        }),
      ),
    );
    expect(admitted.filter(Boolean)).toHaveLength(2);
    await Promise.all(
      admitted.map((accepted, index) =>
        accepted
          ? live.store.completeAuthAttempt(attemptKeys[index]!, new Date(), "failure", {
              maxFailures: 3,
              windowSeconds: 300,
              lockSeconds: 300,
              maxConcurrent: 2,
            })
          : Promise.resolve(),
      ),
    );
    const staleKeys = {
      failureKeyHash: "c".repeat(64),
      admissionKeyHash: "d".repeat(64),
    };
    expect(
      await live.store.reserveAuthAttempt(staleKeys, new Date(), {
        maxFailures: 3,
        windowSeconds: 300,
        lockSeconds: 300,
        maxConcurrent: 2,
      }),
    ).toBe(true);
    await client.execute(
      `UPDATE identity_login_throttle
       SET tokens = 2, in_flight = 2, updated_at = now() - interval '301 seconds'
       WHERE key_hash = ANY($1::text[])`,
      [[staleKeys.failureKeyHash, staleKeys.admissionKeyHash]],
    );
    expect(
      await live.store.reserveAuthAttempt(staleKeys, new Date(), {
        maxFailures: 3,
        windowSeconds: 300,
        lockSeconds: 300,
        maxConcurrent: 2,
      }),
    ).toBe(true);
    await live.store.completeAuthAttempt(staleKeys, new Date(), "failure", {
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

  test("serializes invite scope changes with registration and rolls back the whole initial session", async () => {
    const live = service("invite");
    const ownerTenant = await client.one<{ id: string }>(
      "SELECT id FROM identity_tenants WHERE slug = 'infinity-pg'",
    );
    await client.execute(
      `UPDATE identity_memberships
       SET scopes = scopes || $2::jsonb
       WHERE tenant_id = $1 AND role = 'owner'`,
      [
        ownerTenant.id,
        JSON.stringify([DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE]),
      ],
    );
    const owner = await live.service.login({
      identifier: { kind: "email", value: "owner@pg.example.test" },
      password: "correct horse battery staple",
      tenantId: ownerTenant.id,
      throttleKey: "review-b-interleave-owner",
    });
    const invite = await live.service.createInvite({
      actorAccessToken: owner.accessToken,
      tenantId: ownerTenant.id,
      identifier: { kind: "email", value: "pg-interleaved-scope@example.test" },
      role: "member",
      scopes: ["runs:read"],
    });

    const blocker = await client.pool.connect();
    let transactionOpen = false;
    let signup:
      | ReturnType<IdentityLifecycleService["signup"]>
      | undefined;
    let observedLockWait = false;
    try {
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query(
        "SELECT id FROM identity_tenants WHERE id = $1 FOR UPDATE",
        [ownerTenant.id],
      );
      signup = live.service.signup({
        identifier: { kind: "email", value: "pg-interleaved-scope@example.test" },
        password: "a sufficiently strong password",
        displayName: "PG Interleaved Scope",
        inviteToken: invite.token,
      });
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = await client.one<{ waiting: boolean; partial_user: boolean }>(
          `SELECT
             EXISTS (
               SELECT 1
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND pid <> pg_backend_pid()
                 AND wait_event_type = 'Lock'
             ) AS waiting,
             EXISTS (
               SELECT 1
               FROM identity_login_identifiers
               WHERE normalized_value = 'pg-interleaved-scope@example.test'
             ) AS partial_user`,
        );
        if (state.waiting || state.partial_user) {
          observedLockWait = true;
          break;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      await blocker.query(
        "UPDATE identity_tenants SET allowed_scopes = allowed_scopes - 'runs:read' WHERE id = $1",
        [ownerTenant.id],
      );
      await blocker.query("COMMIT");
      transactionOpen = false;
    } finally {
      if (transactionOpen) await blocker.query("ROLLBACK");
      blocker.release();
    }

    const signupOutcome = await signup!.catch((error) => error);
    const persisted = await client.one<{
      users: string;
      memberships: string;
      sessions: string;
      consumed_at: Date | string | null;
    }>(
      `SELECT
         (SELECT count(*)::text
          FROM identity_users identity_user
          JOIN identity_login_identifiers identifier ON identifier.user_id = identity_user.id
          WHERE identifier.normalized_value = 'pg-interleaved-scope@example.test') AS users,
         (SELECT count(*)::text
          FROM identity_memberships membership
          JOIN identity_login_identifiers identifier ON identifier.user_id = membership.user_id
          WHERE identifier.normalized_value = 'pg-interleaved-scope@example.test') AS memberships,
         (SELECT count(*)::text
          FROM identity_session_families family
          JOIN identity_login_identifiers identifier ON identifier.user_id = family.user_id
          WHERE identifier.normalized_value = 'pg-interleaved-scope@example.test') AS sessions,
         consumed_at
       FROM identity_invites
       WHERE id = $1`,
      [invite.id],
    );
    await client.transaction(async (tx) => {
      const partialUser = await tx.get<{ user_id: string }>(
        `SELECT user_id FROM identity_login_identifiers
         WHERE normalized_value = 'pg-interleaved-scope@example.test'`,
      );
      await tx.execute("DELETE FROM identity_invites WHERE id = $1", [invite.id]);
      if (partialUser !== null) {
        await tx.execute("DELETE FROM identity_issued_access_tokens WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute(
          `DELETE FROM identity_refresh_tokens
           WHERE family_id IN (SELECT id FROM identity_session_families WHERE user_id = $1)`,
          [partialUser.user_id],
        );
        await tx.execute("DELETE FROM identity_session_families WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute("DELETE FROM identity_one_time_tokens WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute("DELETE FROM identity_password_credentials WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute("DELETE FROM identity_memberships WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute("DELETE FROM identity_login_identifiers WHERE user_id = $1", [partialUser.user_id]);
        await tx.execute("DELETE FROM identity_users WHERE id = $1", [partialUser.user_id]);
      }
      await tx.execute(
        "UPDATE identity_tenants SET allowed_scopes = allowed_scopes || '[\"runs:read\"]'::jsonb WHERE id = $1",
        [ownerTenant.id],
      );
    });
    expect(persisted).toMatchObject({
      users: "0",
      memberships: "0",
      sessions: "0",
      consumed_at: null,
    });
    expect(observedLockWait).toBe(true);
    expect(signupOutcome).toMatchObject({ reason: "invite_invalid" });
  }, 15_000);

  test("persists the store authorization scope and rejects use after creator scope loss", async () => {
    const live = service("invite");
    const ownerTenant = await client.one<{ id: string }>(
      "SELECT id FROM identity_tenants WHERE slug = 'infinity-pg'",
    );
    await client.execute(
      `UPDATE identity_memberships
       SET scopes = scopes || $2::jsonb
       WHERE tenant_id = $1 AND role = 'owner'`,
      [ownerTenant.id, JSON.stringify([DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE])],
    );
    const owner = await live.service.login({
      identifier: { kind: "email", value: "owner@pg.example.test" },
      password: "correct horse battery staple",
      tenantId: ownerTenant.id,
      throttleKey: "review-b-authoritative-owner",
    });
    const token = "review-b-pg-authoritative-invite-token";
    const inviteId = "inv_review_b_pg_authoritative_scope";
    const now = new Date();
    const forgedInvite: IdentityInviteRecord = {
      id: inviteId,
      tenantId: ownerTenant.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      identifierKind: "email",
      normalizedIdentifier: "pg-authoritative-scope@example.test",
      managementScope: "runs:read",
      role: "member",
      scopes: ["runs:read"],
      expiresAt: new Date(now.getTime() + 300_000).toISOString(),
      createdByUserId: owner.user.id,
      createdAt: now.toISOString(),
    };
    await live.store.createInvite(forgedInvite, {
      actorTokenScopes: owner.scopes,
      inviteManagementScope: DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE,
    });
    const persisted = await client.one<{ management_scope: string }>(
      "SELECT management_scope FROM identity_invites WHERE id = $1",
      [inviteId],
    );
    expect(persisted.management_scope).toBe(DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE);

    await client.execute(
      `UPDATE identity_memberships
       SET scopes = scopes - $3
       WHERE tenant_id = $1 AND user_id = $2`,
      [ownerTenant.id, owner.user.id, DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE],
    );
    await expect(live.service.signup({
      identifier: { kind: "email", value: "pg-authoritative-scope@example.test" },
      password: "a sufficiently strong password",
      displayName: "PG Authoritative Scope",
      inviteToken: token,
    })).rejects.toMatchObject({ reason: "invite_invalid" });
    const inviteAfter = await client.one<{ consumed_at: Date | string | null }>(
      "SELECT consumed_at FROM identity_invites WHERE id = $1",
      [inviteId],
    );
    expect(inviteAfter.consumed_at).toBeNull();
    await client.execute("DELETE FROM identity_invites WHERE id = $1", [inviteId]);
    await client.execute(
      `UPDATE identity_memberships
       SET scopes = scopes || $3::jsonb
       WHERE tenant_id = $1 AND user_id = $2`,
      [
        ownerTenant.id,
        owner.user.id,
        JSON.stringify([DEFAULT_IDENTITY_INVITE_MANAGEMENT_SCOPE]),
      ],
    );
  });
});
