import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IDENTITY_READ_PREFERENCE,
  EXTERNAL_RUNTIME_COORDINATION_AUTHORITY,
  IDENTITY_ALIAS_AMBIGUOUS,
  IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1,
  ROLLBACK_IDENTITY_READ_PREFERENCE,
  IdentityAliasCollisionError,
  IdentityDirectoryConflictError,
  addIdentityAlias,
  createCanonicalAgentIdentity,
  createIdentityConvergenceCandidate,
  createIdentityDirectory,
  createIdentityRuntimeContext,
  createIdentity,
  planCanonicalIdentityMigration,
  resolveCanonicalIdentity,
  selectIdentityRead,
  sourceLineageKey,
  updateCanonicalAgentIdentity,
} from "./index.js";

const scope = {
  tenant_id: "tenant-acme",
  namespace: "engineering-agents",
};

function canonicalAgent(
  identity_id: string,
  handle: string,
  options: {
    display_name?: string;
    aliases?: Array<{
      kind: "legacy_handle" | "legacy_identifier";
      tenant_id: string;
      namespace: string;
      value: string;
    }>;
  } = {},
) {
  return createCanonicalAgentIdentity({
    identity_id,
    canonical_handle: { ...scope, handle },
    labels: options.display_name
      ? [{ kind: "display_name", value: options.display_name, source: "test" }]
      : [],
    aliases: options.aliases,
  });
}

describe("canonical agent identity contract v1", () => {
  test("keeps one immutable identity_id across machine/project/role/session/runtime contexts", () => {
    const identity = canonicalAgent("oid_global_agent", "astraea", { display_name: "Astraea" });
    const first = createIdentityRuntimeContext(identity.identity_id, {
      machine: { machine_id: "station01" },
      project: { project_id: "project-a" },
      role: { role_id: "implementer" },
      session: { session_id: "session-a" },
      runtime: { runtime_instance_id: "runtime-a" },
    });
    const second = createIdentityRuntimeContext(identity.identity_id, {
      machine: { machine_id: "station02" },
      project: { project_id: "project-b" },
      role: { role_id: "reviewer" },
      session: { session_id: "session-b" },
      runtime: { runtime_instance_id: "runtime-b" },
    });

    expect(first.identity_id).toBe("oid_global_agent");
    expect(second.identity_id).toBe("oid_global_agent");
    expect(first.machine).toEqual({ machine_id: "station01" });
    expect(second.project).toEqual({ project_id: "project-b" });
    expect(first.runtime).toEqual({ runtime_instance_id: "runtime-a" });
    expect(first.lease_fence_authority).toBe(EXTERNAL_RUNTIME_COORDINATION_AUTHORITY);
    expect(second.lease_fence_authority).toBe("external Runtime Coordination");
    expect("lease_authority" in first).toBe(false);
    expect(identity.canonical_handle).toEqual({ ...scope, handle: "astraea" });

    expect(() => updateCanonicalAgentIdentity(identity, {
      identity_id: "oid_replacement",
    } as never)).toThrow(/identity_id is immutable/);
    expect(() => createIdentityRuntimeContext(identity.identity_id, {
      runtime: { runtime_instance_id: "runtime-c" },
      fencing_token: "must-stay-runtime-owned",
    } as never)).toThrow(/external Runtime Coordination/);
  });

  test("marks names, handles, and aliases as non-authorizing and rejects ambiguous labels", () => {
    const first = canonicalAgent("oid_first", "first", {
      display_name: "Shared Display",
      aliases: [{ ...scope, kind: "legacy_handle", value: "shared-alias" }],
    });
    const second = canonicalAgent("oid_second", "second", {
      display_name: "Shared Display",
      aliases: [{ ...scope, kind: "legacy_handle", value: "shared-alias" }],
    });

    const byId = resolveCanonicalIdentity([first, second], {
      kind: "identity_id",
      identity_id: first.identity_id,
    });
    expect(byId).toMatchObject({ status: "resolved", identity_id: "oid_first", trust: "authoritative" });

    const byHandle = resolveCanonicalIdentity([first, second], {
      kind: "canonical_handle",
      ...scope,
      handle: "first",
    });
    expect(byHandle).toMatchObject({ status: "resolved", identity_id: "oid_first", trust: "non_authoritative" });

    const byDisplay = resolveCanonicalIdentity([first, second], {
      kind: "display_name",
      value: "Shared Display",
    });
    expect(byDisplay).toEqual(expect.objectContaining({
      status: "ambiguous",
      code: IDENTITY_ALIAS_AMBIGUOUS,
      trust: "denied",
      candidate_identity_ids: ["oid_first", "oid_second"],
    }));

    const byAlias = resolveCanonicalIdentity([first, second], {
      kind: "alias",
      ...scope,
      value: "shared-alias",
    });
    expect(byAlias).toEqual(expect.objectContaining({
      status: "ambiguous",
      code: "IDENTITY_ALIAS_AMBIGUOUS",
      trust: "denied",
      candidate_identity_ids: ["oid_first", "oid_second"],
    }));
    expect("identity" in byAlias).toBe(false);
  });

  test("adds aliases immutably while rejecting collisions and stale concurrent revisions", () => {
    const first = canonicalAgent("oid_first", "first");
    const second = canonicalAgent("oid_second", "second");
    const initial = createIdentityDirectory([first, second]);

    const updated = addIdentityAlias(initial, {
      identity_id: first.identity_id,
      alias: { ...scope, kind: "legacy_handle", value: "historical-first" },
    }, { expected_revision: 0 });

    expect(initial.revision).toBe(0);
    expect(initial.identities[0]?.aliases).toEqual([]);
    expect(updated.revision).toBe(1);
    expect(updated.identities[0]?.aliases).toEqual([
      { ...scope, kind: "legacy_handle", value: "historical-first" },
    ]);

    expect(() => addIdentityAlias(updated, {
      identity_id: second.identity_id,
      alias: { ...scope, kind: "legacy_handle", value: "historical-first" },
    }, { expected_revision: 1 })).toThrow(IdentityAliasCollisionError);

    expect(() => addIdentityAlias(updated, {
      identity_id: first.identity_id,
      alias: { ...scope, kind: "legacy_handle", value: "another-alias" },
    }, { expected_revision: 0 })).toThrow(IdentityDirectoryConflictError);
  });

  test("keys convergence mappings by fully qualified source lineage", () => {
    const todosSource = {
      system: "todos",
      tenant_id: "tenant-acme",
      namespace: "agents",
      record_id: "local-agent-17",
    };
    const importedSource = {
      system: "conversations",
      tenant_id: "tenant-acme",
      namespace: "agents",
      record_id: "local-agent-17",
    };
    const retiredSource = {
      system: "mementos",
      tenant_id: "tenant-acme",
      namespace: "agents",
      record_id: "historical-agent-17",
    };

    expect(sourceLineageKey(todosSource)).not.toBe(sourceLineageKey(importedSource));
    expect(() => sourceLineageKey({
      system: "todos",
      tenant_id: "",
      namespace: "agents",
      record_id: "local-agent-17",
    })).toThrow(/tenant_id cannot be empty/);

    const identity = createCanonicalAgentIdentity({
      identity_id: "oid_mapped",
      canonical_handle: { ...scope, handle: "mapped" },
      source_mappings: [
        { source: todosSource, mapping_kind: "authoritative", status: "active" },
        { source: importedSource, mapping_kind: "imported", status: "active" },
        { source: retiredSource, mapping_kind: "authoritative", status: "retired" },
      ],
    });
    const authoritative = resolveCanonicalIdentity([identity], { kind: "source", source: todosSource });
    const imported = resolveCanonicalIdentity([identity], { kind: "source", source: importedSource });
    const retired = resolveCanonicalIdentity([identity], { kind: "source", source: retiredSource });

    expect(authoritative).toMatchObject({
      status: "resolved",
      identity_id: "oid_mapped",
      trust: "authoritative",
    });
    expect(imported).toMatchObject({
      status: "resolved",
      identity_id: "oid_mapped",
      trust: "non_authoritative",
    });
    expect(retired).toMatchObject({
      status: "resolved",
      identity_id: "oid_mapped",
      trust: "non_authoritative",
    });
    expect(identity.source_mappings.map((mapping) => mapping.lineage_key)).toEqual([
      sourceLineageKey(todosSource),
      sourceLineageKey(importedSource),
      sourceLineageKey(retiredSource),
    ]);
    expect(identity.source_mappings.map((mapping) => mapping.status)).toEqual([
      "active",
      "active",
      "retired",
    ]);
  });

  test("applies explicit same-lineage trust transitions and reports retirement in dry-run", () => {
    const source = {
      system: "todos",
      tenant_id: "tenant-acme",
      namespace: "agents",
      record_id: "transition-agent-17",
    };
    const imported = createCanonicalAgentIdentity({
      identity_id: "oid_transition",
      canonical_handle: { ...scope, handle: "transition" },
      labels: [{ kind: "full_name", value: "Transition Agent", source: "legacy_identity" }],
      source_mappings: [{ source, mapping_kind: "imported", status: "active" }],
    });

    const promoted = updateCanonicalAgentIdentity(imported, {
      source_mappings: [{ source, mapping_kind: "authoritative", status: "active" }],
    });
    expect(imported.source_mappings[0]).toMatchObject({ mapping_kind: "imported", status: "active" });
    expect(promoted.source_mappings[0]).toMatchObject({ mapping_kind: "authoritative", status: "active" });
    expect(resolveCanonicalIdentity([promoted], { kind: "source", source })).toMatchObject({
      status: "resolved",
      trust: "authoritative",
    });

    const retired = updateCanonicalAgentIdentity(promoted, {
      source_mappings: [{ source, mapping_kind: "authoritative", status: "retired" }],
    });
    expect(retired.source_mappings).toHaveLength(1);
    expect(retired.source_mappings[0]).toMatchObject({ mapping_kind: "authoritative", status: "retired" });
    expect(resolveCanonicalIdentity([retired], { kind: "source", source })).toMatchObject({
      status: "resolved",
      trust: "non_authoritative",
    });

    const report = planCanonicalIdentityMigration({
      legacy_identities: [createIdentity({
        id: imported.identity_id,
        kind: "agent",
        fullName: "Transition Agent",
      })],
      existing_identities: [promoted],
      bindings: [{
        identity_id: promoted.identity_id,
        canonical_handle: promoted.canonical_handle,
        source_mappings: [{ source, mapping_kind: "authoritative", status: "retired" }],
      }],
      generated_at: "2026-07-23T12:00:00.000Z",
    });

    expect(report.writes_applied).toBe(0);
    expect(report.changes[0]?.action).toBe("update");
    expect(report.changes[0]?.record?.source_mappings[0]?.status).toBe("retired");
  });

  test("quarantines similarity-only convergence candidates", () => {
    const candidate = createIdentityConvergenceCandidate({
      source: {
        system: "mementos",
        tenant_id: "tenant-acme",
        namespace: "agents",
        record_id: "agent-by-name-only",
      },
      candidate_identity_ids: ["oid_first", "oid_second"],
      signals: ["handle_similarity", "contact_similarity", "name_similarity"],
    });

    expect(candidate.status).toBe("quarantined");
    expect(candidate.authoritative_mapping).toBe(false);
    expect(candidate.candidate_identity_ids).toEqual(["oid_first", "oid_second"]);
    expect(resolveCanonicalIdentity([
      canonicalAgent("oid_first", "first"),
      canonicalAgent("oid_second", "second"),
    ], { kind: "source", source: candidate.source })).toMatchObject({
      status: "not_found",
      trust: "denied",
    });
  });

  test("exposes machine assignments only as a versioned Machines+Projects projection", () => {
    const identity = createCanonicalAgentIdentity({
      identity_id: "oid_projected",
      canonical_handle: { ...scope, handle: "projected" },
      machine_assignments: {
        contract: IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1,
        version: 1,
        authority: "machines+projects",
        read_only: true,
        assignments: [{
          machine_id: "station01",
          project_id: "project-a",
          role_id: "implementer",
        }],
      },
    });

    expect(identity.machine_assignments).toEqual({
      contract: IDENTITY_MACHINE_ASSIGNMENTS_PROJECTION_V1,
      version: 1,
      authority: "machines+projects",
      read_only: true,
      assignments: [{ machine_id: "station01", project_id: "project-a", role_id: "implementer" }],
    });
  });

  test("plans migration without writes and preserves historical labels and aliases additively", () => {
    const existing = canonicalAgent("oid_migrate", "migrate", {
      display_name: "Historical Display",
      aliases: [{ ...scope, kind: "legacy_handle", value: "historical-handle" }],
    });
    const legacy = createIdentity({
      id: "oid_migrate",
      kind: "agent",
      fullName: "Current Full Name",
      displayName: "Current Display",
    });
    const frozenExisting = Object.freeze([existing]);
    const frozenLegacy = Object.freeze([legacy]);

    const report = planCanonicalIdentityMigration({
      legacy_identities: frozenLegacy,
      existing_identities: frozenExisting,
      bindings: [{
        identity_id: legacy.id,
        canonical_handle: existing.canonical_handle,
        aliases: [{ ...scope, kind: "legacy_identifier", value: "agent:older-id" }],
        source_mappings: [{
          source: {
            system: "todos",
            tenant_id: "tenant-acme",
            namespace: "agents",
            record_id: "legacy-agent-row",
          },
          mapping_kind: "imported",
        }],
      }],
      generated_at: "2026-07-23T12:00:00.000Z",
    });

    expect(report.mode).toBe("dry_run");
    expect(report.writes_applied).toBe(0);
    expect(report.summary).toMatchObject({ total: 1, updates: 1, blocked: 0 });
    expect(frozenExisting[0]?.labels).toEqual([
      { kind: "display_name", value: "Historical Display", source: "test" },
    ]);

    const planned = report.changes[0];
    expect(planned?.action).toBe("update");
    expect(planned?.record?.labels.map((label) => label.value)).toEqual([
      "Historical Display",
      "Current Full Name",
      "Current Display",
    ]);
    expect(planned?.record?.aliases.map((alias) => alias.value)).toEqual([
      "historical-handle",
      "agent:older-id",
    ]);
  });

  test("supports canonical-first adoption and legacy-first rollback without changing records", () => {
    const canonical = canonicalAgent("oid_compat", "compat");
    const legacy = createIdentity({ id: "oid_compat", kind: "agent", fullName: "Legacy Compat Agent" });

    expect(DEFAULT_IDENTITY_READ_PREFERENCE).toBe("canonical_first");
    expect(ROLLBACK_IDENTITY_READ_PREFERENCE).toBe("legacy_first");
    expect(selectIdentityRead({ canonical, legacy, preference: "canonical_first" })).toMatchObject({
      source: "canonical",
      identity_id: "oid_compat",
    });
    expect(selectIdentityRead({ canonical, legacy, preference: "legacy_first" })).toMatchObject({
      source: "legacy",
      identity_id: "oid_compat",
    });
    expect(selectIdentityRead({ legacy, preference: "canonical_first" })).toMatchObject({
      source: "legacy",
      identity_id: "oid_compat",
    });
  });
});
