import { identityDocumentKeys, type Identity, type IdentityKind } from "./types.js";
import { IdentityStore } from "./storage.js";
import { projectIdentityAsset, projectProfileImage, projectVoiceProfile } from "./core.js";
declare const PACKAGE_NAME = "@hasna/identities";
export interface IdentityStatusRef {
    refId: string;
    kind: IdentityKind;
    hasAgentProfile: boolean;
    hasSensitiveIdentifiers: boolean;
    contactRefs: {
        emails: number;
        phones: number;
    };
    documentRefs: {
        populated: number;
        total: number;
    };
}
export interface IdentityReferenceStatus {
    service: "identities";
    schemaVersion: "1.0";
    package: {
        name: typeof PACKAGE_NAME;
        version: string;
    };
    dataDir: string;
    store: {
        path: string;
        exists: boolean;
        records: number;
    };
    audit: {
        path: string;
        exists: boolean;
    };
    env: {
        store: {
            name: "OPEN_IDENTITIES_STORE";
            active: boolean;
            includesRawValue: false;
        };
        audit: {
            name: "OPEN_IDENTITIES_AUDIT";
            active: boolean;
            includesRawValue: false;
        };
    };
    counts: {
        identities: number;
        byKind: Record<IdentityKind, number>;
        identifiers: number;
        sensitiveIdentifiers: number;
        emails: number;
        phones: number;
        agentProfiles: number;
        agentRoles: number;
        uniqueAgentRoles: number;
        toolRefs: number;
        skillRefs: number;
        channelRefs: number;
        scheduleRefs: number;
        subagentRefs: number;
        machineAssignments: number;
        browserPlanProfiles: number;
        documentSlots: number;
        populatedDocuments: number;
        maileryRefs: number;
        telephonyRefs: number;
        roster: {
            builtInVersion: number;
            builtInAgents: number;
            seededCurrentVersion: number;
            seededOtherVersion: number;
            deprecatedRefsPresent: number;
        };
    };
    refs: {
        identities: IdentityStatusRef[];
        rawIdentityIdsIncluded: false;
        rawIdentifiersIncluded: false;
    };
    documentKeys: typeof identityDocumentKeys;
    safety: {
        includesNames: false;
        includesContactValues: false;
        includesCredentialValues: false;
        includesDocumentBodies: false;
        includesSensitiveIdentifiers: false;
        includesPrivateKeys: false;
        includesGitHubAppPrivateData: false;
        includesRawEnvValues: false;
        statusOutputIsMetadataOnly: true;
    };
}
export type IdentityStoreStatus = IdentityReferenceStatus;
export declare function getIdentityReferenceStatus(store?: IdentityStore): Promise<IdentityReferenceStatus>;
export declare const getIdentityStoreStatus: typeof getIdentityReferenceStatus;
export declare function projectIdentityMediaStatus(identity: Identity): {
    identityId: string;
    identifier: string;
    kind: IdentityKind;
    name: string;
    voice?: ReturnType<typeof projectVoiceProfile>;
    profileImage?: ReturnType<typeof projectProfileImage>;
    assets: {
        count: number;
        byKind: Record<"voice" | "profile-image", number>;
        items: ReturnType<typeof projectIdentityAsset>[];
    };
};
export declare function projectIdentityMediaSummary(identity: Identity): {
    identityId: string;
    identifier: string;
    kind: IdentityKind;
    name: string;
    assets: number;
    hasVoice: boolean;
    hasProfileImage: boolean;
};
export {};
