// @generated from the serve OpenAPI document by scripts/generate-sdk.ts — DO NOT EDIT.
// Regenerate: bun run generate:sdk

// @generated from OpenAPI by @hasna/contracts SDK generator — DO NOT EDIT.
// Source: Identities API 0.3.5

export interface Identity { "id": string; "kind": "human" | "agent" | "organization" | "service"; "fullName": string; "displayName"?: string; "createdAt"?: string; "updatedAt"?: string }

export interface IdentityContactCard { "id": string; "kind": string; "fullName": string; "displayName"?: string; "identifier": string; "primaryEmail"?: string; "primaryPhone"?: string }

export interface CreateIdentityInput { "id"?: string; "kind": "human" | "agent" | "organization" | "service"; "fullName": string; "displayName"?: string; "uniqueIdentifier"?: string | { "scheme": string; "value": string; "issuer"?: string; "country"?: string }; "identifiers"?: Array<string | { "scheme": string; "value": string; "issuer"?: string; "country"?: string }>; "emails"?: Array<string>; "phones"?: Array<string> }

export interface UpdateIdentityInput { "kind"?: "human" | "agent" | "organization" | "service"; "fullName"?: string; "displayName"?: string; "uniqueIdentifier"?: string | { "scheme": string; "value": string; "issuer"?: string; "country"?: string } }

export interface LinkEmailInput { "address": string; "label"?: string; "primary"?: boolean }

export interface LinkPhoneInput { "number": string; "label"?: string; "primary"?: boolean }

export interface IdentityListResponse { "identities": Array<Identity>; "count": number }

export interface CardListResponse { "cards": Array<IdentityContactCard>; "count": number }

export interface DeleteResponse { "deleted": boolean; "target": string }

export interface ErrorResponse { "error": string; "reason"?: string }

export interface LoginIdentifierInput { "kind": "email" | "username"; "value": string }

export interface SignupInput { "identifier": LoginIdentifierInput; "password": string; "displayName": string; "inviteToken"?: string }

export interface LoginInput { "identifier": LoginIdentifierInput; "password": string; "tenantId"?: string; "scopes"?: Array<string> }

export interface RefreshInput { "refreshToken": string }

export interface AuthSession { "schemaVersion": string; "user": Record<string, unknown>; "tenant": Record<string, unknown>; "membership": Record<string, unknown>; "scopes": Array<string>; "accessToken": string; "accessTokenExpiresAt": string; "refreshToken": string; "refreshTokenExpiresAt": string }

export interface VerificationInput { "token": string }

export interface RecoveryStartInput { "identifier": LoginIdentifierInput }

export interface RecoveryCompleteInput { "token": string; "newPassword": string }

export interface ActionAccepted { "accepted"?: boolean; "verified"?: boolean; "recovered"?: boolean; "loggedOut"?: boolean; "loggedOutAll"?: boolean }

export interface IdentitiesClientOptions {
  /** Base URL, e.g. process.env.APP_API_URL. */
  baseUrl: string;
  /** API key, e.g. process.env.APP_API_KEY. Sent as the 'x-api-key' header. */
  apiKey?: string;
  /** Custom fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

export class IdentitiesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseHeaders: Record<string, string>;

  constructor(options: IdentitiesClientOptions) {
    if (!options.baseUrl) throw new Error("IdentitiesClient requires a baseUrl.");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseHeaders = options.headers ?? {};
  }

  private async request<T>(method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown>; init?: RequestInit }): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { Accept: "application/json", ...this.baseHeaders, ...(opts.init?.headers as Record<string, string> | undefined) };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;
    let payload: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    const response = await this.fetchImpl(url.toString(), { ...opts.init, method, headers, body: payload });
    const text = await response.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
    if (!response.ok) {
      throw new ApiError(response.status, `${method} ${path} failed: ${response.status}`, data);
    }
    return data as T;
  }

    /** Authenticate an end user with timing-safe errors and tenant-bound scopes */
    async loginIdentityUser(body: LoginInput, init?: RequestInit): Promise<AuthSession> {
      return this.request("POST", `/v1/auth/login`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Revoke the current JTI and session family */
    async logoutIdentitySession(init?: RequestInit): Promise<ActionAccepted> {
      return this.request("POST", `/v1/auth/logout`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Revoke every session family for the current user */
    async logoutAllIdentitySessions(init?: RequestInit): Promise<ActionAccepted> {
      return this.request("POST", `/v1/auth/logout-all`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Consume a one-time recovery token, replace the credential, and revoke sessions */
    async completeIdentityRecovery(body: RecoveryCompleteInput, init?: RequestInit): Promise<ActionAccepted> {
      return this.request("POST", `/v1/auth/recovery/complete`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Start recovery with an enumeration-safe accepted response */
    async startIdentityRecovery(body: RecoveryStartInput, init?: RequestInit): Promise<ActionAccepted> {
      return this.request("POST", `/v1/auth/recovery/start`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Rotate a hashed refresh token; replay revokes the entire session family */
    async refreshIdentitySession(body: RefreshInput, init?: RequestInit): Promise<AuthSession> {
      return this.request("POST", `/v1/auth/refresh`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Register an end user under the configured disabled, invite, or open policy */
    async signupIdentityUser(body: SignupInput, init?: RequestInit): Promise<AuthSession> {
      return this.request("POST", `/v1/auth/signup`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Consume a one-time login-identifier verification token */
    async verifyIdentityLoginIdentifier(body: VerificationInput, init?: RequestInit): Promise<ActionAccepted> {
      return this.request("POST", `/v1/auth/verification/complete`, {
        body,
        query: undefined,
        init,
      });
    }

    /** List identity contact cards */
    async listCards(init?: RequestInit): Promise<CardListResponse> {
      return this.request("GET", `/v1/cards`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** List all identities */
    async listIdentities(init?: RequestInit): Promise<IdentityListResponse> {
      return this.request("GET", `/v1/identities`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Create an identity */
    async createIdentity(body: CreateIdentityInput, init?: RequestInit): Promise<Identity> {
      return this.request("POST", `/v1/identities`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Get an identity by id, identifier, email, or phone */
    async getIdentity(target: string, init?: RequestInit): Promise<Identity> {
      return this.request("GET", `/v1/identities/${encodeURIComponent(String(target))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Delete an identity */
    async deleteIdentity(target: string, init?: RequestInit): Promise<DeleteResponse> {
      return this.request("DELETE", `/v1/identities/${encodeURIComponent(String(target))}`, {
        body: undefined,
        query: undefined,
        init,
      });
    }

    /** Update an identity */
    async updateIdentity(target: string, body: UpdateIdentityInput, init?: RequestInit): Promise<Identity> {
      return this.request("PATCH", `/v1/identities/${encodeURIComponent(String(target))}`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Link an email address to an identity */
    async linkEmail(target: string, body: LinkEmailInput, init?: RequestInit): Promise<Identity> {
      return this.request("POST", `/v1/identities/${encodeURIComponent(String(target))}/emails`, {
        body,
        query: undefined,
        init,
      });
    }

    /** Link a phone number to an identity */
    async linkPhone(target: string, body: LinkPhoneInput, init?: RequestInit): Promise<Identity> {
      return this.request("POST", `/v1/identities/${encodeURIComponent(String(target))}/phones`, {
        body,
        query: undefined,
        init,
      });
    }
}
