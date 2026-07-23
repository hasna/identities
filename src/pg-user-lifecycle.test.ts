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

  function service() {
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
        registrationPolicy: "open",
        bootstrapTenant: { slug: "infinity-pg", name: "Infinity PG" },
        passwordHasher: new Argon2idIdentityPasswordHasher({
          memoryCost: 32_768,
          timeCost: 2,
        }),
        tokenIssuer,
        tokenVerifier: verifier,
        defaultScopes: ["runs:read", "runs:write"],
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
});
