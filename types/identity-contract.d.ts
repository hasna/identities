import type { Identity } from "./types.js";
export declare const CANONICAL_AGENT_IDENTITY_CONTRACT_V1: "hasna.identities.agent-identity/v1";
export declare const IDENTITY_DIRECTORY_CONTRACT_V1: "hasna.identities.directory/v1";
export declare const IDENTITY_RUNTIME_CONTEXT_CONTRACT_V1: "hasna.identities.runtime-context/v1";
export declare const IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1: "hasna.identities.machine-assignments/v1";
export declare const IDENTITY_MIGRATION_REPORT_CONTRACT_V1: "hasna.identities.migration-report/v1";
export declare const IDENTITY_CONVERGENCE_CANDIDATE_CONTRACT_V1: "hasna.identities.convergence-candidate/v1";
export declare const EXTERNAL_RUNTIME_COORDINATION_AUTHORITY: "external Runtime Coordination";
export declare const AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_ID: "hasna.identities.agent-identity/v1/conformance/1";
export declare const AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_PATH: "docs/fixtures/agent-identity-v1.conformance.json";
export declare const AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_SHA256: "sha256:2d22e72b7315d0b06b3c67c71674cfd8c2dff552727eea00efb325f52c9420af";
export declare const IDENTITY_ALIAS_AMBIGUOUS: "IDENTITY_ALIAS_AMBIGUOUS";
/** @deprecated V1 exposes one fail-closed ambiguity code at every external boundary. */
export declare const IDENTITY_REFERENCE_AMBIGUOUS: "IDENTITY_ALIAS_AMBIGUOUS";
export declare const IDENTITY_NOT_FOUND: "IDENTITY_NOT_FOUND";
export declare const DEFAULT_IDENTITY_READ_PREFERENCE: "canonical_first";
export declare const CANARY_IDENTITY_READ_PREFERENCE: "canonical_first";
export declare const ROLLBACK_IDENTITY_READ_PREFERENCE: "legacy_first";
export interface IdentityNamespaceV1 {
    readonly tenant_id: string;
    readonly namespace: string;
}
export interface CanonicalIdentityHandleV1 extends IdentityNamespaceV1 {
    readonly handle: string;
}
export type IdentityAliasKindV1 = "legacy_handle" | "legacy_identifier";
export interface IdentityAliasV1 extends IdentityNamespaceV1 {
    readonly kind: IdentityAliasKindV1;
    readonly value: string;
}
export type IdentityLabelKindV1 = "full_name" | "display_name";
export interface IdentityLabelV1 {
    readonly kind: IdentityLabelKindV1;
    readonly value: string;
    readonly source: string;
}
export interface IdentitySourceLineageV1 {
    readonly source_authority: string;
    readonly source_tenant_id: string;
    readonly source_namespace: string;
    readonly source_entity_type: string;
    readonly source_record_id: string;
}
export type IdentitySourceMappingKindV1 = "authoritative" | "imported";
export type IdentitySourceMappingStatusV1 = "active" | "retired";
export type IdentitySourceMappingLifecycleActionV1 = "create" | "unchanged" | "promote" | "correct" | "retire";
export type IdentitySourceMappingRevisionActionV1 = Exclude<IdentitySourceMappingLifecycleActionV1, "unchanged">;
export interface IdentitySourceMappingV1 {
    readonly source: IdentitySourceLineageV1;
    readonly lineage_key: string;
    readonly identity_id: string;
    readonly mapping_kind: IdentitySourceMappingKindV1;
    readonly status: IdentitySourceMappingStatusV1;
    readonly revision: number;
    readonly lifecycle_action: IdentitySourceMappingRevisionActionV1;
    readonly evidence: Readonly<Record<string, unknown>>;
}
export interface IdentitySourceMappingInputV1 {
    readonly source: IdentitySourceLineageV1;
    readonly mapping_kind: IdentitySourceMappingKindV1;
    readonly status?: IdentitySourceMappingStatusV1;
    readonly evidence?: Readonly<Record<string, unknown>>;
}
export interface AppendIdentitySourceMappingRevisionInputV1 extends IdentitySourceMappingInputV1 {
    readonly identity_id: string;
}
export interface AppendIdentitySourceMappingRevisionResultV1 {
    readonly action: IdentitySourceMappingLifecycleActionV1;
    readonly identities: readonly CanonicalAgentIdentityV1[];
    readonly previous_revision: IdentitySourceMappingV1 | null;
    readonly current_revision: IdentitySourceMappingV1;
}
export interface IdentityMachineAssignmentProjectionItemV1 {
    readonly machine_id: string;
    readonly project_id?: string;
    readonly role_id?: string;
    readonly purpose?: string;
    readonly status?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface IdentityMachineAssignmentsProjectionV1 {
    readonly contract: typeof IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1;
    readonly version: 1;
    readonly authority: "machines+projects";
    readonly read_only: true;
    readonly assignments: readonly IdentityMachineAssignmentProjectionItemV1[];
}
export interface CanonicalAgentIdentityV1 {
    readonly contract: typeof CANONICAL_AGENT_IDENTITY_CONTRACT_V1;
    readonly version: 1;
    readonly identity_id: string;
    readonly kind: "agent";
    readonly canonical_handle: CanonicalIdentityHandleV1;
    readonly aliases: readonly IdentityAliasV1[];
    readonly labels: readonly IdentityLabelV1[];
    /** Append-only revisions owned by this identity; current source projection is computed across identities. */
    readonly source_mappings: readonly IdentitySourceMappingV1[];
    readonly machine_assignments?: IdentityMachineAssignmentsProjectionV1;
    readonly metadata: Readonly<Record<string, unknown>>;
}
export interface CreateCanonicalAgentIdentityInputV1 {
    readonly identity_id: string;
    readonly canonical_handle: CanonicalIdentityHandleV1;
    readonly aliases?: readonly IdentityAliasV1[];
    readonly labels?: readonly IdentityLabelV1[];
    readonly source_mappings?: readonly (IdentitySourceMappingInputV1 | IdentitySourceMappingV1)[];
    readonly machine_assignments?: IdentityMachineAssignmentsProjectionV1;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface CanonicalAgentIdentityUpdateV1 {
    readonly labels?: readonly IdentityLabelV1[];
    readonly aliases?: readonly IdentityAliasV1[];
    readonly source_mappings?: readonly IdentitySourceMappingInputV1[];
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface IdentityRuntimeContextRefV1 {
    readonly machine?: {
        readonly machine_id: string;
    };
    readonly project?: {
        readonly project_id: string;
    };
    readonly role?: {
        readonly role_id: string;
    };
    readonly session?: {
        readonly session_id: string;
    };
    readonly runtime?: {
        readonly runtime_instance_id: string;
    };
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export interface IdentityRuntimeContextV1 {
    readonly contract: typeof IDENTITY_RUNTIME_CONTEXT_CONTRACT_V1;
    readonly version: 1;
    readonly identity_id: string;
    readonly machine?: {
        readonly machine_id: string;
    };
    readonly project?: {
        readonly project_id: string;
    };
    readonly role?: {
        readonly role_id: string;
    };
    readonly session?: {
        readonly session_id: string;
    };
    readonly runtime?: {
        readonly runtime_instance_id: string;
    };
    /** A logical external authority label; this does not name or require a package. */
    readonly lease_fence_authority: typeof EXTERNAL_RUNTIME_COORDINATION_AUTHORITY;
    readonly metadata: Readonly<Record<string, unknown>>;
}
export interface CanonicalIdentityDirectoryV1 {
    readonly contract: typeof IDENTITY_DIRECTORY_CONTRACT_V1;
    readonly version: 1;
    readonly revision: number;
    readonly identities: readonly CanonicalAgentIdentityV1[];
}
export type CanonicalIdentityReferenceV1 = {
    readonly kind: "identity_id";
    readonly identity_id: string;
} | ({
    readonly kind: "canonical_handle";
    readonly handle: string;
} & IdentityNamespaceV1) | ({
    readonly kind: "alias";
    readonly value: string;
} & IdentityNamespaceV1) | {
    readonly kind: "display_name";
    readonly value: string;
} | {
    readonly kind: "source";
    readonly source: IdentitySourceLineageV1;
};
export type CanonicalIdentityResolutionV1 = {
    readonly status: "resolved";
    readonly identity_id: string;
    readonly identity: CanonicalAgentIdentityV1;
    readonly matched_by: CanonicalIdentityReferenceV1["kind"];
    /** Names, handles, aliases, imported mappings, and retired mappings are non-authoritative. */
    readonly trust: "authoritative" | "non_authoritative";
} | {
    readonly status: "ambiguous";
    readonly code: typeof IDENTITY_ALIAS_AMBIGUOUS;
    readonly matched_by: CanonicalIdentityReferenceV1["kind"];
    readonly candidate_identity_ids: readonly string[];
    readonly trust: "denied";
} | {
    readonly status: "not_found";
    readonly code: typeof IDENTITY_NOT_FOUND;
    readonly matched_by: CanonicalIdentityReferenceV1["kind"];
    readonly candidate_identity_ids: readonly [];
    readonly trust: "denied";
};
export type IdentityConvergenceSignalV1 = "handle_similarity" | "contact_similarity" | "name_similarity";
export interface IdentityConvergenceCandidateV1 {
    readonly contract: typeof IDENTITY_CONVERGENCE_CANDIDATE_CONTRACT_V1;
    readonly version: 1;
    readonly source: IdentitySourceLineageV1;
    readonly lineage_key: string;
    readonly candidate_identity_ids: readonly string[];
    readonly signals: readonly IdentityConvergenceSignalV1[];
    readonly status: "quarantined";
    readonly authoritative_mapping: false;
}
export interface IdentityConvergenceCandidateInputV1 {
    readonly source: IdentitySourceLineageV1;
    readonly candidate_identity_ids: readonly string[];
    readonly signals: readonly IdentityConvergenceSignalV1[];
}
export interface CanonicalIdentityMigrationBindingV1 {
    readonly identity_id: string;
    readonly canonical_handle: CanonicalIdentityHandleV1;
    readonly aliases?: readonly IdentityAliasV1[];
    readonly source_mappings?: readonly IdentitySourceMappingInputV1[];
    readonly machine_assignments?: IdentityMachineAssignmentsProjectionV1;
    readonly metadata?: Readonly<Record<string, unknown>>;
}
export type IdentityMigrationChangeActionV1 = "create" | "update" | "unchanged" | "blocked";
export interface IdentitySourceMappingTransitionV1 {
    readonly lineage_key: string;
    readonly action: IdentitySourceMappingLifecycleActionV1;
    readonly identity_id: string;
    readonly previous_revision: number | null;
    readonly current_revision: number;
}
export interface IdentityMigrationChangeV1 {
    readonly identity_id: string;
    readonly action: IdentityMigrationChangeActionV1;
    readonly record?: CanonicalAgentIdentityV1;
    readonly reasons: readonly string[];
    readonly mapping_transitions: readonly IdentitySourceMappingTransitionV1[];
}
export interface IdentityMigrationIssueV1 {
    readonly severity: "error" | "warning";
    readonly code: string;
    readonly message: string;
    readonly identity_id?: string;
    readonly lineage_key?: string;
}
export interface IdentityMigrationReportV1 {
    readonly contract: typeof IDENTITY_MIGRATION_REPORT_CONTRACT_V1;
    readonly version: 1;
    readonly mode: "dry_run";
    readonly generated_at: string;
    readonly read_preference: IdentityReadPreferenceV1;
    readonly rollback_read_preference: typeof ROLLBACK_IDENTITY_READ_PREFERENCE;
    readonly writes_applied: 0;
    readonly ready_to_apply: boolean;
    readonly changes: readonly IdentityMigrationChangeV1[];
    readonly issues: readonly IdentityMigrationIssueV1[];
    readonly quarantined_candidates: readonly IdentityConvergenceCandidateV1[];
    readonly summary: {
        readonly total: number;
        readonly creates: number;
        readonly updates: number;
        readonly unchanged: number;
        readonly blocked: number;
        readonly quarantined: number;
    };
}
export interface PlanCanonicalIdentityMigrationInputV1 {
    readonly legacy_identities: readonly Identity[];
    readonly existing_identities?: readonly CanonicalAgentIdentityV1[];
    readonly bindings: readonly CanonicalIdentityMigrationBindingV1[];
    readonly convergence_candidates?: readonly IdentityConvergenceCandidateInputV1[];
    readonly generated_at?: string;
    readonly read_preference?: IdentityReadPreferenceV1;
}
export type IdentityReadPreferenceV1 = "canonical_first" | "legacy_first" | "canonical_only" | "legacy_only";
export type CompatibleIdentityReadV1 = {
    readonly source: "canonical";
    readonly identity_id: string;
    readonly value: CanonicalAgentIdentityV1;
} | {
    readonly source: "legacy";
    readonly identity_id: string;
    readonly value: Identity;
} | {
    readonly source: "none";
};
export declare class IdentityContractError extends Error {
    constructor(message: string);
}
export declare class IdentityDirectoryConflictError extends IdentityContractError {
    readonly expected_revision: number;
    readonly actual_revision: number;
    constructor(expectedRevision: number, actualRevision: number);
}
export declare class IdentityAliasCollisionError extends IdentityContractError {
    readonly alias_key: string;
    readonly existing_identity_id: string;
    constructor(aliasKey: string, existingIdentityId: string);
}
export declare class IdentityAliasAmbiguousError extends IdentityContractError {
    readonly code: "IDENTITY_ALIAS_AMBIGUOUS";
    readonly candidate_identity_ids: readonly string[];
    constructor(subject: string, candidateIdentityIds: readonly string[]);
}
export declare function createCanonicalAgentIdentity(input: CreateCanonicalAgentIdentityInputV1): CanonicalAgentIdentityV1;
export declare function updateCanonicalAgentIdentity(identity: CanonicalAgentIdentityV1, update: CanonicalAgentIdentityUpdateV1): CanonicalAgentIdentityV1;
export declare function appendIdentitySourceMappingRevision(identities: readonly CanonicalAgentIdentityV1[], input: AppendIdentitySourceMappingRevisionInputV1): AppendIdentitySourceMappingRevisionResultV1;
export declare function createIdentityRuntimeContext(identityId: string, input: IdentityRuntimeContextRefV1): IdentityRuntimeContextV1;
export declare function createIdentityDirectory(identities: readonly CanonicalAgentIdentityV1[], options?: {
    readonly revision?: number;
}): CanonicalIdentityDirectoryV1;
export declare function addIdentityAlias(directory: CanonicalIdentityDirectoryV1, input: {
    readonly identity_id: string;
    readonly alias: IdentityAliasV1;
}, options: {
    readonly expected_revision: number;
}): CanonicalIdentityDirectoryV1;
export declare function resolveCanonicalIdentity(identities: readonly CanonicalAgentIdentityV1[], reference: CanonicalIdentityReferenceV1): CanonicalIdentityResolutionV1;
export declare function sourceLineageKey(source: IdentitySourceLineageV1): string;
export declare function createIdentityConvergenceCandidate(input: IdentityConvergenceCandidateInputV1): IdentityConvergenceCandidateV1;
export declare function planCanonicalIdentityMigration(input: PlanCanonicalIdentityMigrationInputV1): IdentityMigrationReportV1;
export declare function selectIdentityRead(input: {
    readonly canonical?: CanonicalAgentIdentityV1;
    readonly legacy?: Identity;
    readonly preference?: IdentityReadPreferenceV1;
}): CompatibleIdentityReadV1;
export declare function canonicalHandleKey(handle: CanonicalIdentityHandleV1): string;
