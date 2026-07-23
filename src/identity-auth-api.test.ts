import { beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, type CryptoKey, type JWK, type KeyObject } from "jose";
import {
  IdentityAccessTokenVerifier,
  IdentityJwksRegistry,
  InMemoryHashedTokenStateStore,
  issueIdentityAccessToken,
} from "./identity-auth.js";
import { createIdentityAuthApi } from "./identity-auth-api.js";

let privateKey: CryptoKey | KeyObject;
let publicJwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA");
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
});

async function fixture() {
  const issuer = "https://identity.example.test";
  const registry = new IdentityJwksRegistry({
    issuer,
    revision: 1,
    keys: [{ kid: "current", alg: "EdDSA", status: "active", publicJwk }],
  });
  const state = new InMemoryHashedTokenStateStore();
  state.registerSessionFamily("session-1");
  const verifier = new IdentityAccessTokenVerifier({
    issuer,
    audience: "infinity",
    algorithms: ["EdDSA"],
    jwks: registry,
    tokenState: state,
  });
  const now = Math.floor(Date.now() / 1000);
  const token = await issueIdentityAccessToken({
    privateKey,
    kid: "current",
    alg: "EdDSA",
    issuer,
    audience: "infinity",
    subject: "identity:user-1",
    tenant: "tenant-1",
    session: "session-1",
    scopes: ["runs:read"],
    jti: "token-1",
    issuedAt: now - 1,
    notBefore: now - 1,
    expiresAt: now + 300,
  });
  const api = createIdentityAuthApi({
    jwks: registry,
    verifier,
    requirements: { tenant: "tenant-1", scopes: ["runs:read"] },
  });
  return { api, token };
}

describe("identity auth API library", () => {
  test("publishes a cacheable public JWKS document", async () => {
    const { api } = await fixture();
    const response = await api.handle(new Request("http://local/.well-known/jwks.json"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("must-revalidate");
    const body = await response.json();
    expect(body.keys[0].kid).toBe("current");
    expect(JSON.stringify(body)).not.toContain('"d":');
  });

  test("verifies bearer tokens without returning or logging token material", async () => {
    const { api, token } = await fixture();
    const response = await api.handle(new Request("http://local/v1/auth/verify", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.active).toBe(true);
    expect(body.claims.tenant).toBe("tenant-1");
    expect(JSON.stringify(body)).not.toContain(token);
  });

  test("fails closed for missing and invalid authorization", async () => {
    const { api } = await fixture();
    const missing = await api.handle(new Request("http://local/v1/auth/verify", { method: "POST" }));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ active: false, reason: "invalid_token" });
    const unknown = await api.handle(new Request("http://local/not-found"));
    expect(unknown.status).toBe(404);
  });
});
