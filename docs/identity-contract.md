# Canonical Agent Identity Contract V1

`@hasna/identities` exports an additive canonical agent identity contract for
Todos, Conversations, Mementos, Projects, Sessions, and other stores that need
to converge historical agent references without changing runtime ownership.

The contract identifier is `hasna.identities.agent-identity/v1`.

## Authority and lookup

- `identity_id` is the immutable, globally authoritative identity reference.
- `canonical_handle` is stable and scoped by both `tenant_id` and `namespace`.
  It is a lookup projection, not authorization authority.
- Display/full-name labels and aliases are additive historical projections.
  They never authorize. A lookup that matches more than one identity returns
  `status: "ambiguous"`, `code: "IDENTITY_ALIAS_AMBIGUOUS"`, and
  `trust: "denied"` without an identity object.
- Resolution has one external trust representation: `trust: "authoritative"`
  or `trust: "non_authoritative"` for a resolved identity, and
  `trust: "denied"` for a failed resolution. Direct `identity_id` lookup and an
  active, fully-qualified source mapping with `mapping_kind: "authoritative"`
  are authoritative. Handles, names, aliases, imported mappings, and retired
  mappings are non-authoritative.
- Alias additions use a directory revision. A stale revision fails with
  `IdentityDirectoryConflictError`; a collision with another identity's alias
  or canonical handle fails with `IdentityAliasCollisionError`. Existing
  history is not overwritten.
- Alias records are additive historical classifications. Adding the same scoped
  value under another alias kind retains both records; lookup deduplicates by
  `identity_id` and does not silently reinterpret the older record.

```ts
import {
  createCanonicalAgentIdentity,
  createIdentityRuntimeContext,
  resolveCanonicalIdentity,
} from "@hasna/identities";

const identity = createCanonicalAgentIdentity({
  identity_id: "oid_123",
  canonical_handle: {
    tenant_id: "tenant-acme",
    namespace: "engineering-agents",
    handle: "astraea",
  },
});

const context = createIdentityRuntimeContext(identity.identity_id, {
  machine: { machine_id: "station01" },
  project: { project_id: "project-a" },
  role: { role_id: "reviewer" },
  session: { session_id: "session-a" },
  runtime: { runtime_instance_id: "runtime-a" },
});

const resolved = resolveCanonicalIdentity([identity], {
  kind: "identity_id",
  identity_id: "oid_123",
});
```

Machine, project, role, session, and runtime identifiers stay in the structured
runtime-context object. They are never embedded into `identity_id` or the
canonical handle. The runtime-context contract always reports
`lease_fence_authority: "external Runtime Coordination"` and rejects lease or
fence fields. This is a logical authority label, not a package or product name;
leases, fences, and expiry remain outside `@hasna/identities`.

## Store convergence

Source mappings require the complete source lineage:

```text
system + tenant_id + namespace + record_id
```

`sourceLineageKey` produces a collision-safe key from all four components.
Never key convergence by a local ID alone. Source mappings default to
`status: "active"`; only an active `authoritative` mapping resolves with
authoritative trust. Retired mappings remain available for historical lookup
but are non-authoritative. For the same lineage, an explicit later mapping in a
create, update, or migration binding is the current projection, so promotion or
retirement is applied instead of being silently ignored; the source lineage
itself remains preserved. Handle, contact, or name similarity can be
represented only with `createIdentityConvergenceCandidate`; the separate result
is always `quarantined`, is never inserted into identity source mappings, and
never auto-binds during resolution.

## Machines and Projects

The V1 contract exposes `machine_assignments` only as the versioned
`hasna.identities.machine-assignments/v1` projection with:

- `authority: "machines+projects"`
- `read_only: true`

The package does not add a V1 assignment writer. Machines and Projects remain
the source of truth. The existing unversioned `Identity.machineAssignments`
field and `assignMachine` API remain available only for backward compatibility;
new consumers should read the V1 projection and should not treat the legacy
field as a second authority.

## Dry-run migration and rollback

`planCanonicalIdentityMigration` is pure and always returns a
`hasna.identities.migration-report/v1` dry-run report. It performs no writes and
reports:

- planned creates, updates, unchanged records, and blocked records;
- fully qualified mapping, canonical-handle, and alias collisions;
- quarantined similarity candidates;
- `writes_applied: 0`; and
- whether the plan is ready for a later package-owned apply path.

New records require an explicit scoped handle binding. The planner never derives
authority from a name, contact, or similar handle. Existing labels, aliases,
source mappings, and `identity_id` values are preserved additively.

Use `selectIdentityRead` for an incremental rollout:

- default: `canonical_first` with legacy fallback;
- rollback: `legacy_first` with canonical fallback;
- strict verification: `canonical_only` or `legacy_only`.

For existing stores, `Identity.id` is the V1 `identity_id`. Existing
`uniqueIdentifier` and secondary `identifiers` continue to resolve through the
legacy store while downstream packages add canonical mappings. Downstream
schemas should add `identity_id` rather than rename or overwrite historical
`agent_id`, name, handle, or session fields. A later migration can backfill the
new column from explicit lineage mappings, dual-read using `canonical_first`,
and roll back immediately by switching to `legacy_first` without rewriting
data.

This foundation does not implement cryptographic identity, runtime leases,
fencing, deployment, or live data migration.
