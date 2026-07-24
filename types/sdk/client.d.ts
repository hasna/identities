export interface Identity {
    "id": string;
    "kind": "human" | "agent" | "organization" | "service";
    "fullName": string;
    "displayName"?: string;
    "createdAt"?: string;
    "updatedAt"?: string;
}
export interface IdentityContactCard {
    "id": string;
    "kind": string;
    "fullName": string;
    "displayName"?: string;
    "identifier": string;
    "primaryEmail"?: string;
    "primaryPhone"?: string;
}
export interface CreateIdentityInput {
    "id"?: string;
    "kind": "human" | "agent" | "organization" | "service";
    "fullName": string;
    "displayName"?: string;
    "uniqueIdentifier"?: string | {
        "scheme": string;
        "value": string;
        "issuer"?: string;
        "country"?: string;
    };
    "identifiers"?: Array<string | {
        "scheme": string;
        "value": string;
        "issuer"?: string;
        "country"?: string;
    }>;
    "emails"?: Array<string>;
    "phones"?: Array<string>;
}
export interface UpdateIdentityInput {
    "kind"?: "human" | "agent" | "organization" | "service";
    "fullName"?: string;
    "displayName"?: string;
    "uniqueIdentifier"?: string | {
        "scheme": string;
        "value": string;
        "issuer"?: string;
        "country"?: string;
    };
}
export interface LinkEmailInput {
    "address": string;
    "label"?: string;
    "primary"?: boolean;
}
export interface LinkPhoneInput {
    "number": string;
    "label"?: string;
    "primary"?: boolean;
}
export interface IdentityListResponse {
    "identities": Array<Identity>;
    "count": number;
}
export interface CardListResponse {
    "cards": Array<IdentityContactCard>;
    "count": number;
}
export interface DeleteResponse {
    "deleted": boolean;
    "target": string;
}
export interface ErrorResponse {
    "error": string;
    "reason"?: string;
}
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
export declare class ApiError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, message: string, body: unknown);
}
export declare class IdentitiesClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly fetchImpl;
    private readonly baseHeaders;
    constructor(options: IdentitiesClientOptions);
    private request;
    /** List identity contact cards */
    listCards(init?: RequestInit): Promise<CardListResponse>;
    /** List all identities */
    listIdentities(init?: RequestInit): Promise<IdentityListResponse>;
    /** Create an identity */
    createIdentity(body: CreateIdentityInput, init?: RequestInit): Promise<Identity>;
    /** Get an identity by id, identifier, email, or phone */
    getIdentity(target: string, init?: RequestInit): Promise<Identity>;
    /** Delete an identity */
    deleteIdentity(target: string, init?: RequestInit): Promise<DeleteResponse>;
    /** Update an identity */
    updateIdentity(target: string, body: UpdateIdentityInput, init?: RequestInit): Promise<Identity>;
    /** Link an email address to an identity */
    linkEmail(target: string, body: LinkEmailInput, init?: RequestInit): Promise<Identity>;
    /** Link a phone number to an identity */
    linkPhone(target: string, body: LinkPhoneInput, init?: RequestInit): Promise<Identity>;
}
