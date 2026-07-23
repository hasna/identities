import { beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, type CryptoKey, type JWK, type KeyObject } from "jose";
import {
  IDENTITY_JWKS_SCHEMA_VERSION,
  IdentityAccessTokenVerifier,
  IdentityAuthError,
  IdentityJwksRegistry,
  InMemoryHashedTokenStateStore,
  StaticHashedTokenStateStore,
  hashOpaqueClaim,
  issueIdentityAccessToken,
} from "./identity-auth.js";
import { runCli } from "./cli.js";

const ISSUER = "https://identity.example.test";
const AUDIENCE = "infinity-local";
const SUBJECT = "identity:user-01";
const TENANT = "tenant-acme";
const SESSION = "session-family-01";
const JTI = "token-01";

type TestSigningKey = CryptoKey | KeyObject;

let activePrivateKey: TestSigningKey;
let activePublicJwk: JWK;
let retiringPrivateKey: TestSigningKey;
let retiringPublicJwk: JWK;
let revokedPrivateKey: TestSigningKey;
let revokedPublicJwk: JWK;

beforeAll(async () => {
  const active = await generateKeyPair("EdDSA");
  activePrivateKey = active.privateKey;
  activePublicJwk = await exportJWK(active.publicKey);
  const retiring = await generateKeyPair("EdDSA");
  retiringPrivateKey = retiring.privateKey;
  retiringPublicJwk = await exportJWK(retiring.publicKey);
  const revoked = await generateKeyPair("EdDSA");
  revokedPrivateKey = revoked.privateKey;
  revokedPublicJwk = await exportJWK(revoked.publicKey);
});

function registry(): IdentityJwksRegistry {
  return new IdentityJwksRegistry({
    issuer: ISSUER,
    revision: 7,
    keys: [
      { kid: "active-2026-07", alg: "EdDSA", status: "active", publicJwk: activePublicJwk },
      {
        kid: "retiring-2026-06",
        alg: "EdDSA",
        status: "retiring",
        publicJwk: retiringPublicJwk,
        notAfter: new Date(Date.now() + 60_000).toISOString(),
      },
      { kid: "revoked-2026-05", alg: "EdDSA", status: "revoked", publicJwk: revokedPublicJwk },
    ],
  });
}

function state(): InMemoryHashedTokenStateStore {
  const result = new InMemoryHashedTokenStateStore();
  result.registerSessionFamily(SESSION);
  return result;
}

function verifier(
  tokenState: InMemoryHashedTokenStateStore = state(),
  jwks: IdentityJwksRegistry = registry(),
): IdentityAccessTokenVerifier {
  return new IdentityAccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ["EdDSA"],
    jwks,
    tokenState,
    clockToleranceSeconds: 0,
    maxTokenLifetimeSeconds: 600,
  });
}

async function token(overrides: Partial<Parameters<typeof issueIdentityAccessToken>[0]> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return issueIdentityAccessToken({
    privateKey: activePrivateKey,
    kid: "active-2026-07",
    alg: "EdDSA",
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: SUBJECT,
    tenant: TENANT,
    session: SESSION,
    scopes: ["runs:read", "runs:write"],
    jti: JTI,
    issuedAt: now - 1,
    notBefore: now - 1,
    expiresAt: now + 300,
    ...overrides,
  });
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    expect(error).toBeInstanceOf(IdentityAuthError);
    return (error as IdentityAuthError).reason;
  }
}

describe("identity access token contract", () => {
  test("verifies a scoped token and returns the canonical claims", async () => {
    const claims = await verifier().verify(await token(), {
      tenant: TENANT,
      scopes: ["runs:write"],
    });
    expect(claims).toMatchObject({
      iss: ISSUER,
      aud: AUDIENCE,
      sub: SUBJECT,
      tenant: TENANT,
      session: SESSION,
      scopes: ["runs:read", "runs:write"],
      jti: JTI,
    });
  });

  test("rejects wrong issuer, audience, tenant, and scope", async () => {
    expect(await reason(verifier().verify(await token({ issuer: "https://wrong.example.test" })))).toBe("invalid_token");
    expect(await reason(verifier().verify(await token({ audience: "wrong-audience" })))).toBe("invalid_token");
    expect(await reason(verifier().verify(await token(), { tenant: "tenant-other" }))).toBe("tenant_mismatch");
    expect(await reason(verifier().verify(await token(), { scopes: ["admin:write"] }))).toBe("insufficient_scope");
  });

  test("rejects expired and not-yet-valid tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await reason(verifier().verify(await token({
      issuedAt: now - 20,
      notBefore: now - 20,
      expiresAt: now - 1,
    })))).toBe("invalid_token");
    expect(await reason(verifier().verify(await token({
      issuedAt: now,
      notBefore: now + 20,
      expiresAt: now + 40,
    })))).toBe("invalid_token");
  });

  test("checks hashed JTI revocation and session-family state fail closed", async () => {
    const revoked = state();
    revoked.revokeJti(JTI);
    expect(await reason(verifier(revoked).verify(await token()))).toBe("token_revoked");

    const disabled = state();
    disabled.setSessionFamilyStatus(SESSION, "disabled");
    expect(await reason(verifier(disabled).verify(await token()))).toBe("session_inactive");

    const unknown = new InMemoryHashedTokenStateStore();
    expect(await reason(verifier(unknown).verify(await token()))).toBe("session_inactive");
  });

  test("rejects unknown and revoked signing keys while accepting a retiring key", async () => {
    expect(await reason(verifier().verify(await token({ kid: "unknown-key" })))).toBe("unknown_key");

    const revokedToken = await token({
      privateKey: revokedPrivateKey,
      kid: "revoked-2026-05",
    });
    expect(await reason(verifier().verify(revokedToken))).toBe("key_revoked");

    const retiringToken = await token({
      privateKey: retiringPrivateKey,
      kid: "retiring-2026-06",
    });
    expect((await verifier().verify(retiringToken)).sub).toBe(SUBJECT);
  });

  test("publishes active and retiring public keys, omits revoked keys and private material", () => {
    const document = registry().publicDocument();
    expect(document.schema_version).toBe(IDENTITY_JWKS_SCHEMA_VERSION);
    expect(document.keys.map((key) => key.kid)).toEqual(["active-2026-07", "retiring-2026-06"]);
    expect(document.keys.map((key) => key.identity_status)).toEqual(["active", "retiring"]);
    expect(document.revoked_kids).toEqual(["revoked-2026-05"]);
    expect(JSON.stringify(document)).not.toContain('"d":');
    const restored = IdentityJwksRegistry.fromDocument(document);
    expect(restored.publicDocument().keys).toHaveLength(2);
    expect(() => restored.verificationDocument("revoked-2026-05")).toThrow(/revoked/);
  });

  test("requires public asymmetric key material and a valid rotation set", () => {
    expect(() => new IdentityJwksRegistry({
      issuer: ISSUER,
      revision: 1,
      keys: [{
        kid: "private",
        alg: "EdDSA",
        status: "active",
        publicJwk: { ...activePublicJwk, d: "private-material-must-not-pass" },
      }],
    })).toThrow(/private key material/);
    expect(() => new IdentityJwksRegistry({
      issuer: ISSUER,
      revision: 1,
      keys: [{
        kid: "retiring",
        alg: "EdDSA",
        status: "retiring",
        publicJwk: retiringPublicJwk,
        notAfter: new Date(Date.now() + 60_000).toISOString(),
      }],
    })).toThrow(/active key/);
    expect(() => new IdentityAccessTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256" as never],
      jwks: registry(),
      tokenState: state(),
    })).toThrow(/unsupported public-key algorithm/);
    expect(() => new IdentityAccessTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["EdDSA"],
      jwks: registry(),
      tokenState: state(),
      minimumJwksRevision: 8,
    })).toThrow(/below the configured minimum/);
  });

  test("stops publishing and verifying a retiring key after its window", async () => {
    const expiredRegistry = new IdentityJwksRegistry({
      issuer: ISSUER,
      revision: 8,
      keys: [
        { kid: "active-2026-07", alg: "EdDSA", status: "active", publicJwk: activePublicJwk },
        {
          kid: "retiring-expired",
          alg: "EdDSA",
          status: "retiring",
          publicJwk: retiringPublicJwk,
          notAfter: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
    });
    expect(expiredRegistry.publicDocument().keys.map((key) => key.kid)).toEqual(["active-2026-07"]);
    const expiredKeyToken = await token({
      privateKey: retiringPrivateKey,
      kid: "retiring-expired",
    });
    expect(await reason(verifier(state(), expiredRegistry).verify(expiredKeyToken))).toBe("key_unavailable");
  });

  test("static state accepts hashes only and never needs raw token identifiers", () => {
    const store = new StaticHashedTokenStateStore({
      revoked_jti_sha256: [hashOpaqueClaim(JTI)],
      session_family_status_by_sha256: {
        [hashOpaqueClaim(SESSION)]: "active",
      },
    });
    expect(store.isJtiRevoked(hashOpaqueClaim(JTI))).toBe(true);
    expect(store.getSessionFamilyStatus(hashOpaqueClaim(SESSION))).toBe("active");
    expect(() => store.isJtiRevoked(JTI)).toThrow(/SHA-256/);
  });

  test("CLI verifies from an owner-only token file and emits no token material", async () => {
    const directory = await mkdtemp(join(tmpdir(), "identities-auth-"));
    const tokenPath = join(directory, "access-token");
    const jwksPath = join(directory, "jwks.json");
    const statePath = join(directory, "state.json");
    const storePath = join(directory, "identities.json");
    const accessToken = await token();
    await writeFile(tokenPath, accessToken, { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    await writeFile(jwksPath, JSON.stringify(registry().publicDocument()));
    await writeFile(statePath, JSON.stringify({
      revoked_jti_sha256: [],
      session_family_status_by_sha256: {
        [hashOpaqueClaim(SESSION)]: "active",
      },
    }));
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((value?: unknown) => {
      output.push(String(value));
    });
    try {
      await runCli([
        "auth",
        "verify",
        "--json",
        "--store",
        storePath,
        "--token-file",
        tokenPath,
        "--jwks-file",
        jwksPath,
        "--token-state-file",
        statePath,
        "--issuer",
        ISSUER,
        "--audience",
        AUDIENCE,
        "--algorithm",
        "EdDSA",
        "--tenant",
        TENANT,
        "--scope",
        "runs:write",
      ]);
    } finally {
      log.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
    expect(output.join("\n")).toContain('"active": true');
    expect(output.join("\n")).not.toContain(accessToken);
  });

  test("CLI rejects a token file readable by other users before parsing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "identities-auth-mode-"));
    const tokenPath = join(directory, "access-token");
    const jwksPath = join(directory, "jwks.json");
    await writeFile(tokenPath, "not-a-real-token-but-long-enough-to-reach-permission-check", { mode: 0o644 });
    await chmod(tokenPath, 0o644);
    await writeFile(jwksPath, JSON.stringify(registry().publicDocument()));
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((value?: unknown) => {
      output.push(String(value));
    });
    const originalExitCode = process.exitCode;
    try {
      await runCli([
        "auth",
        "verify",
        "--json",
        "--store",
        join(directory, "identities.json"),
        "--token-file",
        tokenPath,
        "--jwks-file",
        jwksPath,
      ]);
    } finally {
      process.exitCode = originalExitCode;
      log.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
    expect(output.join("\n")).toContain("owner-owned, owner-only regular file");
  });
});
