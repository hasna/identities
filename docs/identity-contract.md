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
- Alias, display-label, and fully-qualified source ambiguity use that same
  external `IDENTITY_ALIAS_AMBIGUOUS` code. Implementations may retain a more
  specific internal cause, but V1 callers never receive a second incompatible
  source/reference ambiguity code. The deprecated
  `IDENTITY_REFERENCE_AMBIGUOUS` export aliases the canonical code value.
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
source_authority + source_tenant_id + source_namespace + source_entity_type + source_record_id
```

`sourceLineageKey` trims all five fields, lowercases `source_authority`,
`source_tenant_id`, `source_namespace`, and `source_entity_type` with the
`en-US` locale, and preserves `source_record_id` case after trimming. It then
JSON-encodes the normalized values in the order above. Empty fields are
rejected. There is no V1 four-field lineage type or implicit default for
`source_entity_type`, because such an adapter cannot map unambiguously.

Source mappings default to `status: "active"`; only the latest unique revision
of an active `authoritative` mapping resolves with authoritative trust. Mapping
history is append-only and each revision retains its target `identity_id`,
mapping kind, status, and immutable evidence. `appendIdentitySourceMappingRevision`
classifies a proposal as `create`, `unchanged`, `promote`, `correct`, or
`retire`. `unchanged` appends nothing; every other action appends the next
revision. Corrections may point the same lineage at a different identity while
the prior identity and evidence remain intact. Resolution projects the highest
unique valid revision; competing rows at that revision fail closed with
`IDENTITY_ALIAS_AMBIGUOUS` rather than selecting arbitrarily. Retired current
revisions remain available for historical lookup but are non-authoritative.

Never key convergence by a local ID alone. Handle, contact, or name similarity
can be represented only with `createIdentityConvergenceCandidate`; the separate
result is always `quarantined`, is never inserted into identity source-mapping
history, and never auto-binds during resolution.

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
- per-lineage `create`, `unchanged`, `promote`, `correct`, and `retire`
  transitions with previous/current revision numbers;
- fully qualified mapping, canonical-handle, and alias collisions;
- quarantined similarity candidates;
- `writes_applied: 0`; and
- whether the plan is ready for a later package-owned apply path.

New records require an explicit scoped handle binding. The planner never derives
authority from a name, contact, or similar handle. Existing labels, aliases,
source mappings, and `identity_id` values are preserved additively.

Use `selectIdentityRead` for an incremental rollout:

- default: `canonical_first` with legacy fallback;
- canary: `canonical_first` with legacy fallback;
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

## Cross-repo conformance fixture

The machine-independent fixture at
`docs/fixtures/agent-identity-v1.conformance.json` is the vendorable V1 oracle
for lineage field order and normalization, canonical key encoding, trust,
ambiguity, lifecycle revisions, default/canary/rollback reads,
`runtime_instance_id`, and the `external Runtime Coordination` authority label.
It contains no machine path or network dependency. Consumers should pin:

- fixture ID: `hasna.identities.agent-identity/v1/conformance/1`
- exported path: `AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_PATH`
- exported raw-content fingerprint:
  `AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_SHA256`

The JSON fixture is forced to LF line endings so its raw SHA-256 is stable
across supported checkouts.
