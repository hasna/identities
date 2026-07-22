import type { Identity } from "./types.js";

export const CANONICAL_AGENT_IDENTITY_CONTRACT_V1 = "hasna.identities.agent-identity/v1" as const;
export const IDENTITY_DIRECTORY_CONTRACT_V1 = "hasna.identities.directory/v1" as const;
export const IDENTITY_RUNTIME_CONTEXT_CONTRACT_V1 = "hasna.identities.runtime-context/v1" as const;
export const IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1 = "hasna.identities.machine-assignments/v1" as const;
export const IDENTITY_MIGRATION_REPORT_CONTRACT_V1 = "hasna.identities.migration-report/v1" as const;
export const IDENTITY_CONVERGENCE_CANDIDATE_CONTRACT_V1 = "hasna.identities.convergence-candidate/v1" as const;
export const EXTERNAL_RUNTIME_COORDINATION_AUTHORITY = "external Runtime Coordination" as const;

export const IDENTITY_ALIAS_AMBIGUOUS = "IDENTITY_ALIAS_AMBIGUOUS" as const;
export const IDENTITY_REFERENCE_AMBIGUOUS = "IDENTITY_REFERENCE_AMBIGUOUS" as const;
export const IDENTITY_NOT_FOUND = "IDENTITY_NOT_FOUND" as const;

export const DEFAULT_IDENTITY_READ_PREFERENCE = "canonical_first" as const;
export const ROLLBACK_IDENTITY_READ_PREFERENCE = "legacy_first" as const;

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

export interface IdentitySourceLineageV1 extends IdentityNamespaceV1 {
  readonly system: string;
  readonly record_id: string;
}

export type IdentitySourceMappingKindV1 = "authoritative" | "imported";
export type IdentitySourceMappingStatusV1 = "active" | "retired";

export interface IdentitySourceMappingV1 {
  readonly source: IdentitySourceLineageV1;
  readonly lineage_key: string;
  readonly mapping_kind: IdentitySourceMappingKindV1;
  readonly status: IdentitySourceMappingStatusV1;
}

export interface IdentitySourceMappingInputV1 {
  readonly source: IdentitySourceLineageV1;
  readonly mapping_kind: IdentitySourceMappingKindV1;
  readonly status?: IdentitySourceMappingStatusV1;
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
  readonly source_mappings: readonly IdentitySourceMappingV1[];
  readonly machine_assignments?: IdentityMachineAssignmentsProjectionV1;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface CreateCanonicalAgentIdentityInputV1 {
  readonly identity_id: string;
  readonly canonical_handle: CanonicalIdentityHandleV1;
  readonly aliases?: readonly IdentityAliasV1[];
  readonly labels?: readonly IdentityLabelV1[];
  readonly source_mappings?: readonly IdentitySourceMappingInputV1[];
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
  readonly machine?: { readonly machine_id: string };
  readonly project?: { readonly project_id: string };
  readonly role?: { readonly role_id: string };
  readonly session?: { readonly session_id: string };
  readonly runtime?: { readonly runtime_instance_id: string };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IdentityRuntimeContextV1 {
  readonly contract: typeof IDENTITY_RUNTIME_CONTEXT_CONTRACT_V1;
  readonly version: 1;
  readonly identity_id: string;
  readonly machine?: { readonly machine_id: string };
  readonly project?: { readonly project_id: string };
  readonly role?: { readonly role_id: string };
  readonly session?: { readonly session_id: string };
  readonly runtime?: { readonly runtime_instance_id: string };
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

export type CanonicalIdentityReferenceV1 =
  | { readonly kind: "identity_id"; readonly identity_id: string }
  | ({ readonly kind: "canonical_handle"; readonly handle: string } & IdentityNamespaceV1)
  | ({ readonly kind: "alias"; readonly value: string } & IdentityNamespaceV1)
  | { readonly kind: "display_name"; readonly value: string }
  | { readonly kind: "source"; readonly source: IdentitySourceLineageV1 };

export type CanonicalIdentityResolutionV1 =
  | {
      readonly status: "resolved";
      readonly identity_id: string;
      readonly identity: CanonicalAgentIdentityV1;
      readonly matched_by: CanonicalIdentityReferenceV1["kind"];
      /** Names, handles, aliases, imported mappings, and retired mappings are non-authoritative. */
      readonly trust: "authoritative" | "non_authoritative";
    }
  | {
      readonly status: "ambiguous";
      readonly code: typeof IDENTITY_ALIAS_AMBIGUOUS | typeof IDENTITY_REFERENCE_AMBIGUOUS;
      readonly matched_by: CanonicalIdentityReferenceV1["kind"];
      readonly candidate_identity_ids: readonly string[];
      readonly trust: "denied";
    }
  | {
      readonly status: "not_found";
      readonly code: typeof IDENTITY_NOT_FOUND;
      readonly matched_by: CanonicalIdentityReferenceV1["kind"];
      readonly candidate_identity_ids: readonly [];
      readonly trust: "denied";
    };

export type IdentityConvergenceSignalV1 =
  | "handle_similarity"
  | "contact_similarity"
  | "name_similarity";

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

export interface IdentityMigrationChangeV1 {
  readonly identity_id: string;
  readonly action: IdentityMigrationChangeActionV1;
  readonly record?: CanonicalAgentIdentityV1;
  readonly reasons: readonly string[];
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

export type IdentityReadPreferenceV1 =
  | "canonical_first"
  | "legacy_first"
  | "canonical_only"
  | "legacy_only";

export type CompatibleIdentityReadV1 =
  | {
      readonly source: "canonical";
      readonly identity_id: string;
      readonly value: CanonicalAgentIdentityV1;
    }
  | {
      readonly source: "legacy";
      readonly identity_id: string;
      readonly value: Identity;
    }
  | {
      readonly source: "none";
    };

export class IdentityContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityContractError";
  }
}

export class IdentityDirectoryConflictError extends IdentityContractError {
  readonly expected_revision: number;
  readonly actual_revision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Identity directory revision conflict: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = "IdentityDirectoryConflictError";
    this.expected_revision = expectedRevision;
    this.actual_revision = actualRevision;
  }
}

export class IdentityAliasCollisionError extends IdentityContractError {
  readonly alias_key: string;
  readonly existing_identity_id: string;

  constructor(aliasKey: string, existingIdentityId: string) {
    super(`Identity alias collision: ${aliasKey} is already bound to ${existingIdentityId}`);
    this.name = "IdentityAliasCollisionError";
    this.alias_key = aliasKey;
    this.existing_identity_id = existingIdentityId;
  }
}

export function createCanonicalAgentIdentity(
  input: CreateCanonicalAgentIdentityInputV1,
): CanonicalAgentIdentityV1 {
  return {
    contract: CANONICAL_AGENT_IDENTITY_CONTRACT_V1,
    version: 1,
    identity_id: required(input.identity_id, "identity_id"),
    kind: "agent",
    canonical_handle: normalizeCanonicalHandle(input.canonical_handle),
    aliases: dedupeAliases(input.aliases ?? []),
    labels: dedupeLabels(input.labels ?? []),
    source_mappings: dedupeSourceMappings(input.source_mappings ?? []),
    machine_assignments: input.machine_assignments
      ? normalizeMachineAssignmentsProjection(input.machine_assignments)
      : undefined,
    metadata: { ...(input.metadata ?? {}) },
  };
}

export function updateCanonicalAgentIdentity(
  identity: CanonicalAgentIdentityV1,
  update: CanonicalAgentIdentityUpdateV1,
): CanonicalAgentIdentityV1 {
  const unsafe = update as CanonicalAgentIdentityUpdateV1 & Record<string, unknown>;
  if (Object.hasOwn(unsafe, "identity_id")) {
    throw new IdentityContractError("identity_id is immutable");
  }
  if (Object.hasOwn(unsafe, "canonical_handle")) {
    throw new IdentityContractError("canonical_handle is stable; preserve the old value as an alias instead");
  }
  if (Object.hasOwn(unsafe, "contract") || Object.hasOwn(unsafe, "version")) {
    throw new IdentityContractError("identity contract and version are immutable");
  }
  if (Object.hasOwn(unsafe, "machine_assignments")) {
    throw new IdentityContractError("machine_assignments is a read-only Machines+Projects projection");
  }

  return createCanonicalAgentIdentity({
    identity_id: identity.identity_id,
    canonical_handle: identity.canonical_handle,
    labels: [...identity.labels, ...(update.labels ?? [])],
    aliases: [...identity.aliases, ...(update.aliases ?? [])],
    source_mappings: [
      ...identity.source_mappings.map(({ source, mapping_kind, status }) => ({ source, mapping_kind, status })),
      ...(update.source_mappings ?? []),
    ],
    machine_assignments: identity.machine_assignments,
    metadata: { ...identity.metadata, ...(update.metadata ?? {}) },
  });
}

export function createIdentityRuntimeContext(
  identityId: string,
  input: IdentityRuntimeContextRefV1,
): IdentityRuntimeContextV1 {
  const raw = input as IdentityRuntimeContextRefV1 & Record<string, unknown>;
  const forbidden = ["lease", "lease_id", "lease_owner", "fence", "fencing_token"];
  if (forbidden.some((key) => Object.hasOwn(raw, key))) {
    throw new IdentityContractError("runtime lease and fence authority remain owned by external Runtime Coordination");
  }
  return {
    contract: IDENTITY_RUNTIME_CONTEXT_CONTRACT_V1,
    version: 1,
    identity_id: required(identityId, "identity_id"),
    machine: input.machine ? { machine_id: required(input.machine.machine_id, "machine_id") } : undefined,
    project: input.project ? { project_id: required(input.project.project_id, "project_id") } : undefined,
    role: input.role ? { role_id: required(input.role.role_id, "role_id") } : undefined,
    session: input.session ? { session_id: required(input.session.session_id, "session_id") } : undefined,
    runtime: input.runtime
      ? { runtime_instance_id: required(input.runtime.runtime_instance_id, "runtime_instance_id") }
      : undefined,
    lease_fence_authority: EXTERNAL_RUNTIME_COORDINATION_AUTHORITY,
    metadata: { ...(input.metadata ?? {}) },
  };
}

export function createIdentityDirectory(
  identities: readonly CanonicalAgentIdentityV1[],
  options: { readonly revision?: number } = {},
): CanonicalIdentityDirectoryV1 {
  const revision = options.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new IdentityContractError("identity directory revision must be a non-negative safe integer");
  }

  const normalized = identities.map((identity) => createCanonicalAgentIdentity({
    identity_id: identity.identity_id,
    canonical_handle: identity.canonical_handle,
    aliases: identity.aliases,
    labels: identity.labels,
    source_mappings: identity.source_mappings.map(({ source, mapping_kind, status }) => ({ source, mapping_kind, status })),
    machine_assignments: identity.machine_assignments,
    metadata: identity.metadata,
  }));
  const seen = new Set<string>();
  for (const identity of normalized) {
    if (seen.has(identity.identity_id)) {
      throw new IdentityContractError(`duplicate identity_id: ${identity.identity_id}`);
    }
    seen.add(identity.identity_id);
  }

  return {
    contract: IDENTITY_DIRECTORY_CONTRACT_V1,
    version: 1,
    revision,
    identities: normalized,
  };
}

export function addIdentityAlias(
  directory: CanonicalIdentityDirectoryV1,
  input: { readonly identity_id: string; readonly alias: IdentityAliasV1 },
  options: { readonly expected_revision: number },
): CanonicalIdentityDirectoryV1 {
  if (directory.revision !== options.expected_revision) {
    throw new IdentityDirectoryConflictError(options.expected_revision, directory.revision);
  }

  const identityId = required(input.identity_id, "identity_id");
  const target = directory.identities.find((identity) => identity.identity_id === identityId);
  if (!target) throw new IdentityContractError(`identity_id not found: ${identityId}`);

  const alias = normalizeAlias(input.alias);
  const key = aliasLookupKey(alias);
  for (const identity of directory.identities) {
    if (identity.identity_id === identityId) continue;
    const ownsCanonicalHandle = canonicalHandleLookupKey(identity.canonical_handle) === key;
    const ownsAlias = identity.aliases.some((candidate) => aliasLookupKey(candidate) === key);
    if (ownsCanonicalHandle || ownsAlias) {
      throw new IdentityAliasCollisionError(key, identity.identity_id);
    }
  }

  if (target.aliases.some((candidate) => aliasKey(candidate) === aliasKey(alias))) {
    return directory;
  }
  if (canonicalHandleLookupKey(target.canonical_handle) === key) {
    return directory;
  }

  return {
    ...directory,
    revision: directory.revision + 1,
    identities: directory.identities.map((identity) => identity.identity_id === identityId
      ? updateCanonicalAgentIdentity(identity, { aliases: [alias] })
      : identity),
  };
}

export function resolveCanonicalIdentity(
  identities: readonly CanonicalAgentIdentityV1[],
  reference: CanonicalIdentityReferenceV1,
): CanonicalIdentityResolutionV1 {
  const matches = uniqueByIdentityId(identities.filter((identity) => matchesReference(identity, reference)));
  if (matches.length === 0) {
    return {
      status: "not_found",
      code: IDENTITY_NOT_FOUND,
      matched_by: reference.kind,
      candidate_identity_ids: [],
      trust: "denied",
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      code: reference.kind === "alias" || reference.kind === "display_name"
        ? IDENTITY_ALIAS_AMBIGUOUS
        : IDENTITY_REFERENCE_AMBIGUOUS,
      matched_by: reference.kind,
      candidate_identity_ids: matches.map((identity) => identity.identity_id).sort(),
      trust: "denied",
    };
  }

  const identity = matches[0]!;
  return {
    status: "resolved",
    identity_id: identity.identity_id,
    identity,
    matched_by: reference.kind,
    trust: resolutionTrust(identity, reference),
  };
}

export function sourceLineageKey(source: IdentitySourceLineageV1): string {
  const normalized = normalizeSourceLineage(source);
  return JSON.stringify([
    normalized.system,
    normalized.tenant_id,
    normalized.namespace,
    normalized.record_id,
  ]);
}

export function createIdentityConvergenceCandidate(
  input: IdentityConvergenceCandidateInputV1,
): IdentityConvergenceCandidateV1 {
  const source = normalizeSourceLineage(input.source);
  const candidateIdentityIds = [...new Set(input.candidate_identity_ids.map((id) => required(id, "candidate identity_id")))].sort();
  if (candidateIdentityIds.length === 0) {
    throw new IdentityContractError("convergence candidate requires at least one candidate identity_id");
  }
  const signals = [...new Set(input.signals)];
  if (signals.length === 0) {
    throw new IdentityContractError("convergence candidate requires at least one similarity signal");
  }
  const supportedSignals: readonly IdentityConvergenceSignalV1[] = [
    "handle_similarity",
    "contact_similarity",
    "name_similarity",
  ];
  for (const signal of signals) {
    if (!supportedSignals.includes(signal)) {
      throw new IdentityContractError(`unsupported convergence signal: ${String(signal)}`);
    }
  }

  return {
    contract: IDENTITY_CONVERGENCE_CANDIDATE_CONTRACT_V1,
    version: 1,
    source,
    lineage_key: sourceLineageKey(source),
    candidate_identity_ids: candidateIdentityIds,
    signals,
    status: "quarantined",
    authoritative_mapping: false,
  };
}

export function planCanonicalIdentityMigration(
  input: PlanCanonicalIdentityMigrationInputV1,
): IdentityMigrationReportV1 {
  const existing = new Map<string, CanonicalAgentIdentityV1>();
  for (const identity of input.existing_identities ?? []) {
    const normalized = createCanonicalAgentIdentity({
      identity_id: identity.identity_id,
      canonical_handle: identity.canonical_handle,
      aliases: identity.aliases,
      labels: identity.labels,
      source_mappings: identity.source_mappings.map(({ source, mapping_kind, status }) => ({ source, mapping_kind, status })),
      machine_assignments: identity.machine_assignments,
      metadata: identity.metadata,
    });
    if (existing.has(normalized.identity_id)) {
      throw new IdentityContractError(`duplicate existing identity_id: ${normalized.identity_id}`);
    }
    existing.set(normalized.identity_id, normalized);
  }

  const bindings = new Map<string, CanonicalIdentityMigrationBindingV1>();
  for (const binding of input.bindings) {
    const identityId = required(binding.identity_id, "binding identity_id");
    if (bindings.has(identityId)) throw new IdentityContractError(`duplicate migration binding: ${identityId}`);
    bindings.set(identityId, binding);
  }

  const issues: IdentityMigrationIssueV1[] = [];
  const changes: IdentityMigrationChangeV1[] = [];
  const legacyAgents = input.legacy_identities.filter((identity) => identity.kind === "agent");
  const seenLegacyIds = new Set<string>();
  for (const legacy of legacyAgents) {
    const identityId = required(legacy.id, "legacy identity id");
    if (seenLegacyIds.has(identityId)) {
      issues.push({
        severity: "error",
        code: "duplicate_legacy_identity_id",
        message: `Legacy input contains duplicate identity_id ${identityId}`,
        identity_id: identityId,
      });
      changes.push({ identity_id: identityId, action: "blocked", reasons: ["duplicate legacy identity_id"] });
      continue;
    }
    seenLegacyIds.add(identityId);

    const current = existing.get(identityId);
    const binding = bindings.get(identityId);
    if (!current && !binding) {
      issues.push({
        severity: "error",
        code: "missing_canonical_handle_binding",
        message: "New canonical identities require an explicit tenant/namespace-scoped handle binding",
        identity_id: identityId,
      });
      changes.push({ identity_id: identityId, action: "blocked", reasons: ["missing canonical handle binding"] });
      continue;
    }

    if (current && binding && canonicalHandleKey(current.canonical_handle) !== canonicalHandleKey(binding.canonical_handle)) {
      issues.push({
        severity: "error",
        code: "canonical_handle_change_rejected",
        message: "Canonical handles are stable; add the historical value as an alias instead",
        identity_id: identityId,
      });
      changes.push({ identity_id: identityId, action: "blocked", reasons: ["canonical handle change rejected"] });
      continue;
    }

    const labels = labelsFromLegacyIdentity(legacy);
    const updatedCurrent = current
      ? updateCanonicalAgentIdentity(current, {
          labels,
          aliases: binding?.aliases,
          source_mappings: binding?.source_mappings,
          metadata: binding?.metadata,
        })
      : undefined;
    const record = updatedCurrent
      ? createCanonicalAgentIdentity({
          identity_id: updatedCurrent.identity_id,
          canonical_handle: updatedCurrent.canonical_handle,
          labels: updatedCurrent.labels,
          aliases: updatedCurrent.aliases,
          source_mappings: updatedCurrent.source_mappings.map(({ source, mapping_kind, status }) => ({ source, mapping_kind, status })),
          machine_assignments: binding?.machine_assignments ?? updatedCurrent.machine_assignments,
          metadata: updatedCurrent.metadata,
        })
      : createCanonicalAgentIdentity({
          identity_id: identityId,
          canonical_handle: binding!.canonical_handle,
          labels,
          aliases: binding!.aliases,
          source_mappings: binding!.source_mappings,
          machine_assignments: binding!.machine_assignments,
          metadata: binding!.metadata,
        });

    const action: IdentityMigrationChangeActionV1 = current
      ? equivalentIdentity(current, record) ? "unchanged" : "update"
      : "create";
    changes.push({
      identity_id: identityId,
      action,
      record,
      reasons: action === "create"
        ? ["create canonical V1 projection"]
        : action === "update"
          ? ["preserve additive labels, aliases, or source mappings"]
          : ["canonical projection already current"],
    });
  }

  const resultingIdentities = new Map(existing);
  for (const change of changes) {
    if (change.record) resultingIdentities.set(change.identity_id, change.record);
  }
  issues.push(...findDirectoryCollisions([...resultingIdentities.values()]));
  const quarantinedCandidates = (input.convergence_candidates ?? []).map(createIdentityConvergenceCandidate);
  const summary = {
    total: changes.length,
    creates: changes.filter((change) => change.action === "create").length,
    updates: changes.filter((change) => change.action === "update").length,
    unchanged: changes.filter((change) => change.action === "unchanged").length,
    blocked: changes.filter((change) => change.action === "blocked").length,
    quarantined: quarantinedCandidates.length,
  };

  return {
    contract: IDENTITY_MIGRATION_REPORT_CONTRACT_V1,
    version: 1,
    mode: "dry_run",
    generated_at: input.generated_at === undefined
      ? new Date().toISOString()
      : required(input.generated_at, "generated_at"),
    read_preference: normalizeReadPreference(input.read_preference ?? DEFAULT_IDENTITY_READ_PREFERENCE),
    rollback_read_preference: ROLLBACK_IDENTITY_READ_PREFERENCE,
    writes_applied: 0,
    ready_to_apply: summary.blocked === 0 && !issues.some((issue) => issue.severity === "error"),
    changes,
    issues,
    quarantined_candidates: quarantinedCandidates,
    summary,
  };
}

export function selectIdentityRead(input: {
  readonly canonical?: CanonicalAgentIdentityV1;
  readonly legacy?: Identity;
  readonly preference?: IdentityReadPreferenceV1;
}): CompatibleIdentityReadV1 {
  if (input.canonical && input.legacy && input.canonical.identity_id !== input.legacy.id) {
    throw new IdentityContractError(
      `canonical/legacy identity mismatch: ${input.canonical.identity_id} != ${input.legacy.id}`,
    );
  }

  const preference = input.preference ?? DEFAULT_IDENTITY_READ_PREFERENCE;
  if (preference === "canonical_first" || preference === "canonical_only") {
    if (input.canonical) {
      return { source: "canonical", identity_id: input.canonical.identity_id, value: input.canonical };
    }
    if (preference === "canonical_first" && input.legacy) {
      return { source: "legacy", identity_id: input.legacy.id, value: input.legacy };
    }
    return { source: "none" };
  }

  if (input.legacy) return { source: "legacy", identity_id: input.legacy.id, value: input.legacy };
  if (preference === "legacy_first" && input.canonical) {
    return { source: "canonical", identity_id: input.canonical.identity_id, value: input.canonical };
  }
  return { source: "none" };
}

export function canonicalHandleKey(handle: CanonicalIdentityHandleV1): string {
  const normalized = normalizeCanonicalHandle(handle);
  return JSON.stringify([normalized.tenant_id, normalized.namespace, normalized.handle]);
}

function normalizeCanonicalHandle(handle: CanonicalIdentityHandleV1): CanonicalIdentityHandleV1 {
  return {
    tenant_id: scoped(required(handle.tenant_id, "canonical handle tenant_id")),
    namespace: scoped(required(handle.namespace, "canonical handle namespace")),
    handle: scoped(required(handle.handle, "canonical handle")),
  };
}

function normalizeAlias(alias: IdentityAliasV1): IdentityAliasV1 {
  if (alias.kind !== "legacy_handle" && alias.kind !== "legacy_identifier") {
    throw new IdentityContractError(`unsupported identity alias kind: ${String(alias.kind)}`);
  }
  return {
    tenant_id: scoped(required(alias.tenant_id, "alias tenant_id")),
    namespace: scoped(required(alias.namespace, "alias namespace")),
    kind: alias.kind,
    value: required(alias.value, "alias value"),
  };
}

function normalizeLabel(label: IdentityLabelV1): IdentityLabelV1 {
  if (label.kind !== "full_name" && label.kind !== "display_name") {
    throw new IdentityContractError(`unsupported identity label kind: ${String(label.kind)}`);
  }
  return {
    kind: label.kind,
    value: required(label.value, "identity label"),
    source: required(label.source, "identity label source"),
  };
}

function normalizeSourceLineage(source: IdentitySourceLineageV1): IdentitySourceLineageV1 {
  return {
    system: scoped(required(source.system, "source system")),
    tenant_id: scoped(required(source.tenant_id, "source tenant_id")),
    namespace: scoped(required(source.namespace, "source namespace")),
    record_id: required(source.record_id, "source record_id"),
  };
}

function normalizeSourceMapping(mapping: IdentitySourceMappingInputV1): IdentitySourceMappingV1 {
  if (mapping.mapping_kind !== "authoritative" && mapping.mapping_kind !== "imported") {
    throw new IdentityContractError(`unsupported source mapping kind: ${String(mapping.mapping_kind)}`);
  }
  const status = mapping.status ?? "active";
  if (status !== "active" && status !== "retired") {
    throw new IdentityContractError(`unsupported source mapping status: ${String(status)}`);
  }
  const source = normalizeSourceLineage(mapping.source);
  return {
    source,
    lineage_key: sourceLineageKey(source),
    mapping_kind: mapping.mapping_kind,
    status,
  };
}

function normalizeMachineAssignmentsProjection(
  projection: IdentityMachineAssignmentsProjectionV1,
): IdentityMachineAssignmentsProjectionV1 {
  if (projection.contract !== IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1 || projection.version !== 1) {
    throw new IdentityContractError("machine assignments projection must use contract version 1");
  }
  if (projection.authority !== "machines+projects" || projection.read_only !== true) {
    throw new IdentityContractError("machine assignments must be a read-only Machines+Projects projection");
  }
  return {
    contract: IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1,
    version: 1,
    authority: "machines+projects",
    read_only: true,
    assignments: projection.assignments.map((assignment) => ({
      machine_id: required(assignment.machine_id, "machine assignment machine_id"),
      project_id: optional(assignment.project_id, "machine assignment project_id"),
      role_id: optional(assignment.role_id, "machine assignment role_id"),
      purpose: optional(assignment.purpose, "machine assignment purpose"),
      status: optional(assignment.status, "machine assignment status"),
      metadata: assignment.metadata ? { ...assignment.metadata } : undefined,
    })),
  };
}

function dedupeAliases(aliases: readonly IdentityAliasV1[]): IdentityAliasV1[] {
  return dedupeBy(aliases.map(normalizeAlias), aliasKey);
}

function dedupeLabels(labels: readonly IdentityLabelV1[]): IdentityLabelV1[] {
  return dedupeBy(labels.map(normalizeLabel), (label) => JSON.stringify([label.kind, label.value, label.source]));
}

function dedupeSourceMappings(mappings: readonly IdentitySourceMappingInputV1[]): IdentitySourceMappingV1[] {
  const currentByLineage = new Map<string, IdentitySourceMappingV1>();
  for (const mapping of mappings.map(normalizeSourceMapping)) {
    // Existing mappings are supplied before explicit updates. Replacing the
    // current projection prevents retirement or promotion requests from being
    // silently discarded while preserving the fully qualified source lineage.
    currentByLineage.set(mapping.lineage_key, mapping);
  }
  return [...currentByLineage.values()];
}

function aliasKey(alias: IdentityAliasV1): string {
  const normalized = normalizeAlias(alias);
  return JSON.stringify([
    normalized.tenant_id,
    normalized.namespace,
    normalized.kind,
    normalized.value.toLocaleLowerCase("en-US"),
  ]);
}

function aliasLookupKey(alias: IdentityAliasV1): string {
  const normalized = normalizeAlias(alias);
  return JSON.stringify([
    normalized.tenant_id,
    normalized.namespace,
    normalized.value.toLocaleLowerCase("en-US"),
  ]);
}

function canonicalHandleLookupKey(handle: CanonicalIdentityHandleV1): string {
  const normalized = normalizeCanonicalHandle(handle);
  return JSON.stringify([normalized.tenant_id, normalized.namespace, normalized.handle]);
}

function matchesReference(identity: CanonicalAgentIdentityV1, reference: CanonicalIdentityReferenceV1): boolean {
  if (reference.kind === "identity_id") {
    return identity.identity_id === required(reference.identity_id, "identity_id reference");
  }
  if (reference.kind === "canonical_handle") {
    return canonicalHandleKey(identity.canonical_handle) === canonicalHandleKey(reference);
  }
  if (reference.kind === "alias") {
    const lookup = aliasLookupKey({ ...reference, kind: "legacy_handle" });
    return identity.aliases.some((alias) => aliasLookupKey(alias) === lookup);
  }
  if (reference.kind === "display_name") {
    const value = required(reference.value, "display name reference").toLocaleLowerCase("en-US");
    return identity.labels.some((label) => {
      return (label.kind === "display_name" || label.kind === "full_name") &&
        label.value.toLocaleLowerCase("en-US") === value;
    });
  }
  const key = sourceLineageKey(reference.source);
  return identity.source_mappings.some((mapping) => mapping.lineage_key === key);
}

function resolutionTrust(
  identity: CanonicalAgentIdentityV1,
  reference: CanonicalIdentityReferenceV1,
): "authoritative" | "non_authoritative" {
  if (reference.kind === "identity_id") return "authoritative";
  if (reference.kind !== "source") return "non_authoritative";

  const key = sourceLineageKey(reference.source);
  return identity.source_mappings.some((mapping) => {
    return mapping.lineage_key === key &&
      mapping.mapping_kind === "authoritative" &&
      mapping.status === "active";
  })
    ? "authoritative"
    : "non_authoritative";
}

function labelsFromLegacyIdentity(identity: Identity): IdentityLabelV1[] {
  const labels: IdentityLabelV1[] = [
    { kind: "full_name", value: identity.fullName, source: "legacy_identity" },
  ];
  if (identity.displayName) {
    labels.push({ kind: "display_name", value: identity.displayName, source: "legacy_identity" });
  }
  return labels;
}

function equivalentIdentity(left: CanonicalAgentIdentityV1, right: CanonicalAgentIdentityV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findDirectoryCollisions(identities: readonly CanonicalAgentIdentityV1[]): IdentityMigrationIssueV1[] {
  const issues: IdentityMigrationIssueV1[] = [];
  const handles = new Map<string, string>();
  const aliases = new Map<string, string>();
  const lineages = new Map<string, string>();
  for (const identity of identities) {
    const handle = canonicalHandleLookupKey(identity.canonical_handle);
    const handleOwner = handles.get(handle);
    if (handleOwner && handleOwner !== identity.identity_id) {
      issues.push({
        severity: "error",
        code: "canonical_handle_collision",
        message: `Canonical handle is shared by ${handleOwner} and ${identity.identity_id}`,
        identity_id: identity.identity_id,
      });
    } else {
      handles.set(handle, identity.identity_id);
    }
    const priorAliasOwner = aliases.get(handle);
    if (priorAliasOwner && priorAliasOwner !== identity.identity_id) {
      issues.push({
        severity: "error",
        code: "alias_canonical_handle_collision",
        message: `Canonical handle is also an alias of ${priorAliasOwner}`,
        identity_id: identity.identity_id,
      });
    }

    for (const alias of identity.aliases) {
      const aliasLookup = aliasLookupKey(alias);
      const canonicalOwner = handles.get(aliasLookup);
      if (canonicalOwner && canonicalOwner !== identity.identity_id) {
        issues.push({
          severity: "error",
          code: "alias_canonical_handle_collision",
          message: `Alias is also the canonical handle of ${canonicalOwner}`,
          identity_id: identity.identity_id,
        });
      }
      const aliasOwner = aliases.get(aliasLookup);
      if (aliasOwner && aliasOwner !== identity.identity_id) {
        issues.push({
          severity: "error",
          code: "alias_collision",
          message: `Alias is shared by ${aliasOwner} and ${identity.identity_id}`,
          identity_id: identity.identity_id,
        });
      } else {
        aliases.set(aliasLookup, identity.identity_id);
      }
    }

    for (const mapping of identity.source_mappings) {
      const lineageOwner = lineages.get(mapping.lineage_key);
      if (lineageOwner && lineageOwner !== identity.identity_id) {
        issues.push({
          severity: "error",
          code: "source_lineage_collision",
          message: `Source lineage is mapped to both ${lineageOwner} and ${identity.identity_id}`,
          identity_id: identity.identity_id,
          lineage_key: mapping.lineage_key,
        });
      } else {
        lineages.set(mapping.lineage_key, identity.identity_id);
      }
    }
  }
  return issues;
}

function uniqueByIdentityId(identities: readonly CanonicalAgentIdentityV1[]): CanonicalAgentIdentityV1[] {
  const seen = new Set<string>();
  const result: CanonicalAgentIdentityV1[] = [];
  for (const identity of identities) {
    if (seen.has(identity.identity_id)) continue;
    seen.add(identity.identity_id);
    result.push(identity);
  }
  return result;
}

function dedupeBy<T>(values: readonly T[], keyFor: (value: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new IdentityContractError(`${label} cannot be empty`);
  return normalized;
}

function optional(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : required(value, label);
}

function normalizeReadPreference(preference: IdentityReadPreferenceV1): IdentityReadPreferenceV1 {
  if (
    preference !== "canonical_first" &&
    preference !== "legacy_first" &&
    preference !== "canonical_only" &&
    preference !== "legacy_only"
  ) {
    throw new IdentityContractError(`unsupported identity read preference: ${String(preference)}`);
  }
  return preference;
}

function scoped(value: string): string {
  return value.toLocaleLowerCase("en-US");
}
