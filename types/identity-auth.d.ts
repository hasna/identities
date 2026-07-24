import { type CryptoKey, type JWK, type KeyObject } from "jose";
export declare const IDENTITY_JWKS_SCHEMA_VERSION: "hasna.identity-jwks/v1";
export declare const IDENTITY_ACCESS_TOKEN_TYPE: "at+jwt";
export declare const IDENTITY_PUBLIC_KEY_ALGORITHMS: readonly ["EdDSA", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512", "RS256", "RS384", "RS512"];
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
export declare class IdentityAuthError extends Error {
    readonly reason: "invalid_configuration" | "invalid_token" | "unknown_key" | "key_revoked" | "key_unavailable" | "tenant_mismatch" | "insufficient_scope" | "token_revoked" | "session_inactive";
    readonly status: 401 | 403 | 500;
    constructor(reason: "invalid_configuration" | "invalid_token" | "unknown_key" | "key_revoked" | "key_unavailable" | "tenant_mismatch" | "insufficient_scope" | "token_revoked" | "session_inactive", message: string, status?: 401 | 403 | 500);
}
export declare class IdentityJwksRegistry {
    readonly issuer: string;
    readonly revision: number;
    private readonly keys;
    private readonly revokedKidTombstones;
    constructor(input: {
        issuer: string;
        revision: number;
        keys: readonly IdentityJwksKeyInput[];
        revokedKids?: readonly string[];
    });
    static fromDocument(document: IdentityJwksDocument): IdentityJwksRegistry;
    publicDocument(now?: Date): IdentityJwksDocument;
    verificationDocument(kid: string, now?: Date): {
        keys: JWK[];
    };
}
export declare class IdentityAccessTokenVerifier {
    private readonly issuer;
    private readonly audience;
    private readonly algorithms;
    private readonly jwks;
    private readonly tokenState;
    private readonly clockToleranceSeconds;
    private readonly maxTokenLifetimeSeconds;
    constructor(options: IdentityAccessTokenVerifierOptions);
    isBoundToJwksRegistry(registry: IdentityJwksRegistry): boolean;
    verify(token: string, requirements?: IdentityTokenVerificationRequirements): Promise<IdentityAccessTokenClaims>;
}
export declare class InMemoryHashedTokenStateStore implements IdentityTokenStateStore {
    private readonly revokedJtiHashes;
    private readonly sessionFamilyStatuses;
    registerSessionFamily(session: string): void;
    setSessionFamilyStatus(session: string, status: Exclude<IdentitySessionFamilyStatus, "unknown">): void;
    revokeJti(jti: string): void;
    isJtiRevoked(jtiSha256: string): boolean;
    getSessionFamilyStatus(sessionSha256: string): IdentitySessionFamilyStatus;
}
export declare class StaticHashedTokenStateStore implements IdentityTokenStateStore {
    private readonly revokedJtiHashes;
    private readonly sessionFamilyStatuses;
    constructor(input: {
        revoked_jti_sha256?: readonly string[];
        session_family_status_by_sha256: Readonly<Record<string, IdentitySessionFamilyStatus>>;
    });
    isJtiRevoked(jtiSha256: string): boolean;
    getSessionFamilyStatus(sessionSha256: string): IdentitySessionFamilyStatus;
}
export declare function issueIdentityAccessToken(options: IssueIdentityAccessTokenOptions): Promise<string>;
export declare function hashOpaqueClaim(value: string): string;
