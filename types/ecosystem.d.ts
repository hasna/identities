import type { AgentRegistrationManifest, Identity } from "./types.js";
export type EcosystemTarget = "todos" | "mementos" | "conversations" | "mailery" | "telephony" | "eve";
export interface AgentIdentityRef {
    identityId: string;
    identifier: string;
    localAgentId?: string;
    sessionId?: string;
    source: EcosystemTarget | string;
    role?: string;
    metadata: Record<string, unknown>;
}
export interface EcosystemRegistrationManifest {
    identity: AgentRegistrationManifest;
    refs: AgentIdentityRef[];
}
export declare function createAgentIdentityRef(identity: Identity, input: {
    source: EcosystemTarget | string;
    localAgentId?: string;
    sessionId?: string;
    role?: string;
    metadata?: Record<string, unknown>;
}): AgentIdentityRef;
export declare function createEcosystemRegistrationManifest(identity: Identity, refs?: AgentIdentityRef[]): EcosystemRegistrationManifest;
