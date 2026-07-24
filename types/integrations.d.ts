import type { EmailAddress, Identity, IdentityIdentifier, PhoneNumber } from "./types.js";
import type { IdentityStore } from "./storage.js";
export interface MaileryIdentitySyncInput {
    identityId: string;
    kind: Identity["kind"];
    fullName: string;
    displayName?: string;
    uniqueIdentifier: IdentityIdentifier;
    publicIdentifier: IdentityIdentifier;
    email: EmailAddress;
}
export interface TelephonyIdentitySyncInput {
    identityId: string;
    kind: Identity["kind"];
    fullName: string;
    displayName?: string;
    uniqueIdentifier: IdentityIdentifier;
    publicIdentifier: IdentityIdentifier;
    phone: PhoneNumber;
}
export interface ContactPointSyncResult {
    provider: "mailery" | "telephony";
    value: string;
    externalId?: string;
    status: "synced" | "failed" | "skipped";
    syncedAt?: string;
    error?: string;
}
export interface MaileryIdentityAdapter {
    upsertIdentityEmail(input: MaileryIdentitySyncInput): Promise<{
        externalId?: string;
    } | void>;
}
export interface TelephonyIdentityAdapter {
    upsertIdentityPhone(input: TelephonyIdentitySyncInput): Promise<{
        externalId?: string;
    } | void>;
}
export interface IdentitySyncAdapters {
    mailery?: MaileryIdentityAdapter;
    telephony?: TelephonyIdentityAdapter;
}
export declare function syncIdentityContactPoints(identity: Identity, adapters: IdentitySyncAdapters): Promise<ContactPointSyncResult[]>;
export declare function syncIdentityContactPointsAndUpdate(store: IdentityStore, target: string, adapters: IdentitySyncAdapters): Promise<{
    identity: Identity;
    results: ContactPointSyncResult[];
}>;
export declare function applyContactPointSyncResults(identity: Identity, results: ContactPointSyncResult[]): Pick<Identity, "emails" | "phones">;
