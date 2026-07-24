import { IdentityStore } from "./storage.js";
import { type CreateIdentityInput, type Identity } from "./types.js";
export declare const HASNA_COMPANY_AGENT_ROSTER_VERSION = 3;
export declare const deprecatedHasnaCompanyAgentIdentifiers: readonly ["agent:hermes", "agent:artemis", "agent:apollo", "agent:athena", "agent:daedalus", "agent:nova", "agent:atlas", "agent:orion", "agent:iris", "agent:vulcan", "agent:email-marketing", "agent:accountant", "agent:bookkeeper", "agent:finance-analyst", "agent:social-media", "agent:content", "agent:brand", "agent:growth", "agent:sales", "agent:revops", "agent:support", "agent:customer-success", "agent:partnerships", "agent:communications", "agent:legal-ops", "agent:people-ops", "agent:talent", "agent:operations", "agent:procurement", "agent:analytics", "agent:research", "agent:product", "agent:design", "agent:security", "agent:qa", "agent:engineering-manager", "agent:executive-assistant", "agent:community", "agent:crm", "agent:lifecycle", "agent:docs", "agent:compliance"];
export interface HasnaCompanyAgentSpec {
    slug: string;
    fullName: string;
    role: string;
    department: string;
    vertical: string;
    summary: string;
    capabilities: string[];
    tools: string[];
    skills: string[];
    channels: string[];
    schedules: string[];
    goals: string[];
    boundaries?: string[];
    collaboratesWith?: string[];
    reportsTo?: string;
}
export interface SeedHasnaCompanyAgentsOptions {
    docsDir?: string;
    pruneDeprecated?: boolean;
}
export interface SeedHasnaCompanyAgentsResult {
    rosterVersion: number;
    created: string[];
    updated: string[];
    deleted: string[];
    documents: string[];
}
export declare const hasnaCompanyAgentSpecs: HasnaCompanyAgentSpec[];
export declare function createHasnaCompanyAgentInputs(): CreateIdentityInput[];
export declare function seedHasnaCompanyAgents(store: IdentityStore, options?: SeedHasnaCompanyAgentsOptions): Promise<SeedHasnaCompanyAgentsResult>;
export declare function writeIdentityDocumentFiles(identity: Identity, dir: string): Promise<string[]>;
