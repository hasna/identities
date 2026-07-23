import { createHash } from "node:crypto";
import {
  SignJWT,
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from "jose";

export const IDENTITY_JWKS_SCHEMA_VERSION = "hasna.identity-jwks/v1" as const;
export const IDENTITY_ACCESS_TOKEN_TYPE = "at+jwt" as const;

export const IDENTITY_PUBLIC_KEY_ALGORITHMS = [
  "EdDSA",
  "ES256",
  "ES384",
  "ES512",
  "PS256",
  "PS384",
  "PS512",
  "RS256",
  "RS384",
  "RS512",
] as const;

export type IdentityPublicKeyAlgorithm = (typeof IDENTITY_PUBLIC_KEY_ALGORITHMS)[number];
export type IdentityJwksKeyStatus = "active" | "retiring" | "revoked";
export type IdentitySessionFamilyStatus = "active" | "disabled" | "deleted" | "unknown";

export interface IdentityJwksKeyInput {
  kid: string;
  alg: IdentityPublicKeyAlgorithm;
  status: IdentityJwksKeyStatus;
  publicJwk: JWK;
  notBefore?: string;
  notAfter?: string;
}

export type IdentityPublishedJwk = JWK & {
  kid: string;
  alg: IdentityPublicKeyAlgorithm;
  use: "sig";
  identity_status: Exclude<IdentityJwksKeyStatus, "revoked">;
  not_before?: string;
  not_after?: string;
};

export interface IdentityJwksDocument {
  schema_version: typeof IDENTITY_JWKS_SCHEMA_VERSION;
  issuer: string;
  revision: number;
  generated_at: string;
  keys: IdentityPublishedJwk[];
  revoked_kids: string[];
}

export interface IdentityAccessTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  tenant: string;
  session: string;
  scopes: string[];
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
}

export interface IdentityTokenVerificationRequirements {
  tenant?: string;
  scopes?: readonly string[];
}

export interface IdentityTokenStateStore {
  isJtiRevoked(jtiSha256: string): boolean | Promise<boolean>;
  getSessionFamilyStatus(sessionSha256: string): IdentitySessionFamilyStatus | Promise<IdentitySessionFamilyStatus>;
}

export interface IdentityAccessTokenVerifierOptions {
  issuer: string;
  audience: string | readonly string[];
  algorithms: readonly IdentityPublicKeyAlgorithm[];
  jwks: IdentityJwksRegistry;
  tokenState: IdentityTokenStateStore;
  clockToleranceSeconds?: number;
  maxTokenLifetimeSeconds?: number;
  minimumJwksRevision?: number;
}

export interface IssueIdentityAccessTokenOptions {
  privateKey: CryptoKey | KeyObject | JWK | Uint8Array;
  kid: string;
  alg: IdentityPublicKeyAlgorithm;
  issuer: string;
  audience: string | readonly string[];
  subject: string;
  tenant: string;
  session: string;
  scopes: readonly string[];
  jti: string;
  issuedAt: number;
  notBefore: number;
  expiresAt: number;
}

export class IdentityAuthError extends Error {
  constructor(
    readonly reason:
      | "invalid_configuration"
      | "invalid_token"
      | "unknown_key"
      | "key_revoked"
      | "key_unavailable"
      | "tenant_mismatch"
      | "insufficient_scope"
      | "token_revoked"
      | "session_inactive",
    message: string,
    readonly status: 401 | 403 | 500 = 401,
  ) {
    super(message);
    this.name = "IdentityAuthError";
  }
}

export class IdentityJwksRegistry {
  readonly issuer: string;
  readonly revision: number;
  private readonly keys: ReadonlyMap<string, NormalizedKey>;
  private readonly revokedKidTombstones: ReadonlySet<string>;

  constructor(input: {
    issuer: string;
    revision: number;
    keys: readonly IdentityJwksKeyInput[];
    revokedKids?: readonly string[];
  }) {
    this.issuer = requiredText(input.issuer, "issuer");
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
      throw configurationError("JWKS revision must be a positive integer");
    }
    this.revision = input.revision;
    if (input.keys.length === 0) throw configurationError("JWKS must contain at least one key");

    const normalized = new Map<string, NormalizedKey>();
    for (const key of input.keys) {
      const item = normalizeKey(key);
      if (normalized.has(item.kid)) throw configurationError(`duplicate JWKS kid: ${item.kid}`);
      normalized.set(item.kid, item);
    }
    const revokedKidTombstones = new Set(
      (input.revokedKids ?? []).map((kid) => requiredText(kid, "revoked kid")),
    );
    for (const key of normalized.values()) {
      if (key.status === "revoked") revokedKidTombstones.add(key.kid);
      if (key.status !== "revoked" && revokedKidTombstones.has(key.kid)) {
        throw configurationError(`JWKS kid ${key.kid} cannot be both published and revoked`);
      }
    }
    if (![...normalized.values()].some((key) => key.status === "active")) {
      throw configurationError("JWKS must contain at least one active key");
    }
    this.keys = normalized;
    this.revokedKidTombstones = revokedKidTombstones;
  }

  static fromDocument(document: IdentityJwksDocument): IdentityJwksRegistry {
    if (document.schema_version !== IDENTITY_JWKS_SCHEMA_VERSION) {
      throw configurationError("unsupported identity JWKS schema_version");
    }
    return new IdentityJwksRegistry({
      issuer: document.issuer,
      revision: document.revision,
      revokedKids: document.revoked_kids,
      keys: document.keys.map((published) => {
        const {
          identity_status,
          not_before,
          not_after,
          kid,
          alg,
          ...publicJwk
        } = published;
        return {
          kid,
          alg,
          status: identity_status,
          publicJwk,
          ...(not_before === undefined ? {} : { notBefore: not_before }),
          ...(not_after === undefined ? {} : { notAfter: not_after }),
        };
      }),
    });
  }

  publicDocument(now = new Date()): IdentityJwksDocument {
    const keys = [...this.keys.values()]
      .filter((key) => key.status !== "revoked" && isWithinPublicationWindow(key, now))
      .sort((a, b) => a.kid.localeCompare(b.kid))
      .map(toPublishedJwk);
    return {
      schema_version: IDENTITY_JWKS_SCHEMA_VERSION,
      issuer: this.issuer,
      revision: this.revision,
      generated_at: now.toISOString(),
      keys,
      revoked_kids: [...this.revokedKidTombstones].sort(),
    };
  }

  verificationDocument(kid: string, now = new Date()): { keys: JWK[] } {
    const normalizedKid = requiredText(kid, "kid");
    const key = this.keys.get(normalizedKid);
    if (key === undefined) {
      if (this.revokedKidTombstones.has(normalizedKid)) {
        throw new IdentityAuthError("key_revoked", "access token signing key is revoked");
      }
      throw new IdentityAuthError("unknown_key", "access token signing key is unknown");
    }
    if (key.status === "revoked") throw new IdentityAuthError("key_revoked", "access token signing key is revoked");
    if (!isWithinPublicationWindow(key, now)) {
      throw new IdentityAuthError("key_unavailable", "access token signing key is outside its verification window");
    }
    return { keys: [toVerificationJwk(key)] };
  }
}

export class IdentityAccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string | string[];
  private readonly algorithms: IdentityPublicKeyAlgorithm[];
  private readonly jwks: IdentityJwksRegistry;
  private readonly tokenState: IdentityTokenStateStore;
  private readonly clockToleranceSeconds: number;
  private readonly maxTokenLifetimeSeconds: number;

  constructor(options: IdentityAccessTokenVerifierOptions) {
    this.issuer = requiredText(options.issuer, "issuer");
    if (this.issuer !== options.jwks.issuer) {
      throw configurationError("verifier issuer must match JWKS issuer");
    }
    this.audience = normalizeAudience(options.audience);
    this.algorithms = normalizeAlgorithms(options.algorithms);
    this.jwks = options.jwks;
    this.tokenState = options.tokenState;
    this.clockToleranceSeconds = boundedNonnegativeInteger(
      options.clockToleranceSeconds ?? 5,
      "clockToleranceSeconds",
      300,
    );
    this.maxTokenLifetimeSeconds = boundedPositiveInteger(
      options.maxTokenLifetimeSeconds ?? 3600,
      "maxTokenLifetimeSeconds",
      86_400,
    );
    const minimumJwksRevision = boundedPositiveInteger(
      options.minimumJwksRevision ?? options.jwks.revision,
      "minimumJwksRevision",
      Number.MAX_SAFE_INTEGER,
    );
    if (options.jwks.revision < minimumJwksRevision) {
      throw configurationError("JWKS revision is below the configured minimum");
    }
  }

  async verify(
    token: string,
    requirements: IdentityTokenVerificationRequirements = {},
  ): Promise<IdentityAccessTokenClaims> {
    if (
      typeof token !== "string" ||
      token.length < 32 ||
      token.length > 16_384 ||
      /\s/.test(token)
    ) {
      throw new IdentityAuthError("invalid_token", "access token is malformed");
    }

    let header: ReturnType<typeof decodeProtectedHeader>;
    try {
      header = decodeProtectedHeader(token);
    } catch {
      throw new IdentityAuthError("invalid_token", "access token header is malformed");
    }
    if (header.typ !== IDENTITY_ACCESS_TOKEN_TYPE) {
      throw new IdentityAuthError("invalid_token", "access token typ is invalid");
    }
    if (typeof header.kid !== "string" || header.kid.length === 0) {
      throw new IdentityAuthError("invalid_token", "access token kid is required");
    }
    if (!isPublicKeyAlgorithm(header.alg) || !this.algorithms.includes(header.alg)) {
      throw new IdentityAuthError("invalid_token", "access token algorithm is not allowed");
    }

    const jwks = createLocalJWKSet(this.jwks.verificationDocument(header.kid));
    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: this.algorithms,
        clockTolerance: this.clockToleranceSeconds,
        requiredClaims: ["sub", "tenant", "session", "scopes", "iat", "nbf", "exp", "jti"],
      });
      payload = verified.payload;
    } catch (error) {
      if (error instanceof IdentityAuthError) throw error;
      throw new IdentityAuthError("invalid_token", "access token verification failed");
    }

    const claims = normalizeClaims(payload);
    if (claims.exp - claims.iat > this.maxTokenLifetimeSeconds) {
      throw new IdentityAuthError("invalid_token", "access token lifetime exceeds policy");
    }
    if (claims.nbf < claims.iat || claims.exp <= claims.nbf) {
      throw new IdentityAuthError("invalid_token", "access token time claims are inconsistent");
    }

    if (requirements.tenant !== undefined && claims.tenant !== requirements.tenant) {
      throw new IdentityAuthError("tenant_mismatch", "access token tenant does not match", 403);
    }
    const requiredScopes = normalizeScopes(requirements.scopes ?? []);
    const grantedScopes = new Set(claims.scopes);
    if (requiredScopes.some((scope) => !grantedScopes.has(scope))) {
      throw new IdentityAuthError("insufficient_scope", "access token lacks a required scope", 403);
    }

    if (await this.tokenState.isJtiRevoked(hashOpaqueClaim(claims.jti))) {
      throw new IdentityAuthError("token_revoked", "access token is revoked");
    }
    const familyStatus = await this.tokenState.getSessionFamilyStatus(hashOpaqueClaim(claims.session));
    if (familyStatus !== "active") {
      throw new IdentityAuthError("session_inactive", "access token session family is not active");
    }
    return claims;
  }
}

export class InMemoryHashedTokenStateStore implements IdentityTokenStateStore {
  private readonly revokedJtiHashes = new Set<string>();
  private readonly sessionFamilyStatuses = new Map<string, IdentitySessionFamilyStatus>();

  registerSessionFamily(session: string): void {
    this.sessionFamilyStatuses.set(hashOpaqueClaim(session), "active");
  }

  setSessionFamilyStatus(session: string, status: Exclude<IdentitySessionFamilyStatus, "unknown">): void {
    this.sessionFamilyStatuses.set(hashOpaqueClaim(session), status);
  }

  revokeJti(jti: string): void {
    this.revokedJtiHashes.add(hashOpaqueClaim(jti));
  }

  isJtiRevoked(jtiSha256: string): boolean {
    return this.revokedJtiHashes.has(requireSha256(jtiSha256, "jtiSha256"));
  }

  getSessionFamilyStatus(sessionSha256: string): IdentitySessionFamilyStatus {
    return this.sessionFamilyStatuses.get(requireSha256(sessionSha256, "sessionSha256")) ?? "unknown";
  }
}

export class StaticHashedTokenStateStore implements IdentityTokenStateStore {
  private readonly revokedJtiHashes: ReadonlySet<string>;
  private readonly sessionFamilyStatuses: ReadonlyMap<string, IdentitySessionFamilyStatus>;

  constructor(input: {
    revoked_jti_sha256?: readonly string[];
    session_family_status_by_sha256: Readonly<Record<string, IdentitySessionFamilyStatus>>;
  }) {
    this.revokedJtiHashes = new Set(
      (input.revoked_jti_sha256 ?? []).map((hash) => requireSha256(hash, "revoked_jti_sha256")),
    );
    this.sessionFamilyStatuses = new Map(
      Object.entries(input.session_family_status_by_sha256).map(([hash, status]) => {
        if (!["active", "disabled", "deleted", "unknown"].includes(status)) {
          throw configurationError("invalid session family status");
        }
        return [requireSha256(hash, "session family hash"), status] as const;
      }),
    );
  }

  isJtiRevoked(jtiSha256: string): boolean {
    return this.revokedJtiHashes.has(requireSha256(jtiSha256, "jtiSha256"));
  }

  getSessionFamilyStatus(sessionSha256: string): IdentitySessionFamilyStatus {
    return this.sessionFamilyStatuses.get(requireSha256(sessionSha256, "sessionSha256")) ?? "unknown";
  }
}

export async function issueIdentityAccessToken(options: IssueIdentityAccessTokenOptions): Promise<string> {
  const alg = requirePublicKeyAlgorithm(options.alg);
  const scopes = normalizeScopes(options.scopes);
  if (scopes.length === 0) throw configurationError("access tokens require at least one scope");
  const issuedAt = integerTime(options.issuedAt, "issuedAt");
  const notBefore = integerTime(options.notBefore, "notBefore");
  const expiresAt = integerTime(options.expiresAt, "expiresAt");
  if (notBefore < issuedAt || expiresAt <= notBefore) {
    throw configurationError("token time claims are inconsistent");
  }

  return new SignJWT({
    tenant: requiredText(options.tenant, "tenant"),
    session: requiredText(options.session, "session"),
    scopes,
  })
    .setProtectedHeader({
      alg,
      kid: requiredText(options.kid, "kid"),
      typ: IDENTITY_ACCESS_TOKEN_TYPE,
    })
    .setIssuer(requiredText(options.issuer, "issuer"))
    .setAudience(normalizeAudience(options.audience))
    .setSubject(requiredText(options.subject, "subject"))
    .setJti(requiredText(options.jti, "jti"))
    .setIssuedAt(issuedAt)
    .setNotBefore(notBefore)
    .setExpirationTime(expiresAt)
    .sign(options.privateKey);
}

export function hashOpaqueClaim(value: string): string {
  return createHash("sha256").update(requiredText(value, "opaque claim"), "utf8").digest("hex");
}

interface NormalizedKey {
  kid: string;
  alg: IdentityPublicKeyAlgorithm;
  status: IdentityJwksKeyStatus;
  publicJwk: JWK;
  notBefore?: Date;
  notAfter?: Date;
}

function normalizeKey(input: IdentityJwksKeyInput): NormalizedKey {
  const kid = requiredText(input.kid, "kid");
  const alg = requirePublicKeyAlgorithm(input.alg);
  if (!["active", "retiring", "revoked"].includes(input.status)) {
    throw configurationError(`invalid JWKS status for ${kid}`);
  }
  if (input.status === "retiring" && input.notAfter === undefined) {
    throw configurationError(`retiring JWKS key ${kid} requires notAfter`);
  }
  const publicJwk = { ...input.publicJwk };
  for (const privateField of ["d", "p", "q", "dp", "dq", "qi", "oth", "k"]) {
    if (privateField in publicJwk) {
      throw configurationError(`JWKS key ${kid} contains private key material`);
    }
  }
  if (publicJwk.kid !== undefined && publicJwk.kid !== kid) {
    throw configurationError(`JWKS key ${kid} has a mismatched embedded kid`);
  }
  if (publicJwk.alg !== undefined && publicJwk.alg !== alg) {
    throw configurationError(`JWKS key ${kid} has a mismatched embedded alg`);
  }
  if (publicJwk.use !== undefined && publicJwk.use !== "sig") {
    throw configurationError(`JWKS key ${kid} must use sig`);
  }
  const notBefore = optionalDate(input.notBefore, `${kid}.notBefore`);
  const notAfter = optionalDate(input.notAfter, `${kid}.notAfter`);
  if (notBefore !== undefined && notAfter !== undefined && notAfter <= notBefore) {
    throw configurationError(`JWKS key ${kid} has an invalid publication window`);
  }
  return {
    kid,
    alg,
    status: input.status,
    publicJwk,
    ...(notBefore === undefined ? {} : { notBefore }),
    ...(notAfter === undefined ? {} : { notAfter }),
  };
}

function toVerificationJwk(key: NormalizedKey): JWK {
  return { ...key.publicJwk, kid: key.kid, alg: key.alg, use: "sig" };
}

function toPublishedJwk(key: NormalizedKey): IdentityPublishedJwk {
  if (key.status === "revoked") throw configurationError("revoked keys cannot be published");
  return {
    ...toVerificationJwk(key),
    kid: key.kid,
    alg: key.alg,
    use: "sig",
    identity_status: key.status,
    ...(key.notBefore === undefined ? {} : { not_before: key.notBefore.toISOString() }),
    ...(key.notAfter === undefined ? {} : { not_after: key.notAfter.toISOString() }),
  };
}

function isWithinPublicationWindow(key: NormalizedKey, now: Date): boolean {
  if (key.notBefore !== undefined && now < key.notBefore) return false;
  if (key.notAfter !== undefined && now >= key.notAfter) return false;
  return true;
}

function normalizeClaims(payload: Awaited<ReturnType<typeof jwtVerify>>["payload"]): IdentityAccessTokenClaims {
  const iss = requiredText(payload.iss, "iss");
  const sub = requiredText(payload.sub, "sub");
  const tenant = requiredText(payload["tenant"], "tenant");
  const session = requiredText(payload["session"], "session");
  const jti = requiredText(payload.jti, "jti");
  const aud = normalizeAudience(payload.aud ?? []);
  const iat = integerTime(payload.iat, "iat");
  const nbf = integerTime(payload.nbf, "nbf");
  const exp = integerTime(payload.exp, "exp");
  if (!Array.isArray(payload["scopes"])) {
    throw new IdentityAuthError("invalid_token", "access token scopes must be an array");
  }
  const scopes = normalizeScopes(payload["scopes"] as unknown[]);
  if (scopes.length === 0) {
    throw new IdentityAuthError("invalid_token", "access token requires at least one scope");
  }
  return { iss, aud, sub, tenant, session, scopes, iat, nbf, exp, jti };
}

function normalizeAudience(value: string | readonly string[]): string | string[] {
  if (typeof value === "string") return requiredText(value, "audience");
  if (!Array.isArray(value) || value.length === 0) throw configurationError("audience is required");
  const normalized = [...new Set(value.map((item) => requiredText(item, "audience")))];
  return normalized.length === 1 ? normalized[0]! : normalized;
}

function normalizeAlgorithms(values: readonly IdentityPublicKeyAlgorithm[]): IdentityPublicKeyAlgorithm[] {
  if (values.length === 0) throw configurationError("at least one public-key algorithm is required");
  return [...new Set(values.map(requirePublicKeyAlgorithm))];
}

function normalizeScopes(values: readonly unknown[]): string[] {
  const normalized = [...new Set(values.map((value) => requiredText(value, "scope")))];
  normalized.sort();
  return normalized;
}

function requirePublicKeyAlgorithm(value: string): IdentityPublicKeyAlgorithm {
  if (!isPublicKeyAlgorithm(value)) {
    throw configurationError(`unsupported public-key algorithm: ${value}`);
  }
  return value;
}

function isPublicKeyAlgorithm(value: unknown): value is IdentityPublicKeyAlgorithm {
  return typeof value === "string" && (IDENTITY_PUBLIC_KEY_ALGORITHMS as readonly string[]).includes(value);
}

function requiredText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new IdentityAuthError("invalid_token", `${label} is invalid`);
  }
  return value;
}

function optionalDate(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw configurationError(`${label} must be a canonical ISO timestamp`);
  }
  return date;
}

function integerTime(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new IdentityAuthError("invalid_token", `${label} must be a nonnegative integer`);
  }
  return value as number;
}

function boundedNonnegativeInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw configurationError(`${label} must be an integer between 0 and ${max}`);
  }
  return value;
}

function boundedPositiveInteger(value: number, label: string, max: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw configurationError(`${label} must be an integer between 1 and ${max}`);
  }
  return value;
}

function requireSha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw configurationError(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function configurationError(message: string): IdentityAuthError {
  return new IdentityAuthError("invalid_configuration", message, 500);
}
