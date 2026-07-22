import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import * as identityContract from "./index.js";

const canonicalSource = {
  source_authority: "GitHub.COM",
  source_tenant_id: " HASNA ",
  source_namespace: "Accounts",
  source_entity_type: "USER",
  source_record_id: " Actor-Case-Sensitive ",
};

const normalizedSource = {
  source_authority: "github.com",
  source_tenant_id: "hasna",
  source_namespace: "accounts",
  source_entity_type: "user",
  source_record_id: "Actor-Case-Sensitive",
};

const expectedLineageKey = JSON.stringify([
  "github.com",
  "hasna",
  "accounts",
  "user",
  "Actor-Case-Sensitive",
]);

type CanonicalIdentity = ReturnType<typeof identityContract.createCanonicalAgentIdentity>;

interface ExpectedMappingRevision {
  readonly identity_id: string;
  readonly revision: number;
  readonly lifecycle_action: "create" | "promote" | "correct" | "retire";
  readonly mapping_kind: "authoritative" | "imported";
  readonly status: "active" | "retired";
  readonly evidence: Readonly<Record<string, unknown>>;
}

interface ExpectedAppendResult {
  readonly action: "create" | "unchanged" | "promote" | "correct" | "retire";
  readonly identities: readonly CanonicalIdentity[];
  readonly previous_revision: ExpectedMappingRevision | null;
  readonly current_revision: ExpectedMappingRevision;
}

type ExpectedAppend = (
  identities: readonly CanonicalIdentity[],
  input: {
    readonly identity_id: string;
    readonly source: typeof canonicalSource;
    readonly mapping_kind: "authoritative" | "imported";
    readonly status?: "active" | "retired";
    readonly evidence?: Readonly<Record<string, unknown>>;
  },
) => ExpectedAppendResult;

function lifecycleApi(): ExpectedAppend | undefined {
  return (identityContract as unknown as { appendIdentitySourceMappingRevision?: ExpectedAppend })
    .appendIdentitySourceMappingRevision;
}

function agent(identityId: string, handle: string): CanonicalIdentity {
  return identityContract.createCanonicalAgentIdentity({
    identity_id: identityId,
    canonical_handle: {
      tenant_id: "tenant-acme",
      namespace: "engineering-agents",
      handle,
    },
  });
}

describe("canonical agent identity V1 cross-repo conformance", () => {
  test("uses the exact five-part lineage and preserves record-id case", () => {
    expect(identityContract.sourceLineageKey(canonicalSource as never)).toBe(expectedLineageKey);
    expect(identityContract.sourceLineageKey(normalizedSource as never)).toBe(expectedLineageKey);
    expect(identityContract.sourceLineageKey({
      ...normalizedSource,
      source_record_id: "actor-case-sensitive",
    } as never)).not.toBe(expectedLineageKey);
    expect(identityContract.sourceLineageKey({
      ...normalizedSource,
      source_entity_type: "organization",
    } as never)).not.toBe(expectedLineageKey);

    expect(() => identityContract.sourceLineageKey({
      system: "github.com",
      tenant_id: "hasna",
      namespace: "accounts",
      record_id: "Actor-Case-Sensitive",
    } as never)).toThrow(/source_authority/);
  });

  test("appends immutable lifecycle revisions and projects the latest valid revision", () => {
    const append = lifecycleApi();
    expect(typeof append).toBe("function");
    if (!append) return;

    const original = agent("identity-original", "original");
    const corrected = agent("identity-corrected", "corrected");
    let identities: readonly CanonicalIdentity[] = [original, corrected];

    const created = append(identities, {
      identity_id: original.identity_id,
      source: canonicalSource,
      mapping_kind: "imported",
      evidence: { observed_label: "Original label", evidence_id: "evidence-1" },
    });
    expect(created).toMatchObject({
      action: "create",
      previous_revision: null,
      current_revision: {
        identity_id: "identity-original",
        revision: 1,
        lifecycle_action: "create",
        mapping_kind: "imported",
        status: "active",
      },
    });
    identities = created.identities;

    const unchanged = append(identities, {
      identity_id: original.identity_id,
      source: normalizedSource,
      mapping_kind: "imported",
      evidence: { observed_label: "Original label", evidence_id: "evidence-1" },
    });
    expect(unchanged.action).toBe("unchanged");
    expect(unchanged.identities).toEqual(identities);

    const promoted = append(identities, {
      identity_id: original.identity_id,
      source: normalizedSource,
      mapping_kind: "authoritative",
    });
    expect(promoted).toMatchObject({
      action: "promote",
      previous_revision: { revision: 1, identity_id: "identity-original" },
      current_revision: { revision: 2, lifecycle_action: "promote", identity_id: "identity-original" },
    });
    expect(promoted.previous_revision?.evidence).toEqual({
      observed_label: "Original label",
      evidence_id: "evidence-1",
    });
    identities = promoted.identities;

    const stateBeforeCorrection = structuredClone(identities);
    const correction = append(identities, {
      identity_id: corrected.identity_id,
      source: normalizedSource,
      mapping_kind: "authoritative",
      evidence: { observed_label: "Corrected label", evidence_id: "evidence-2" },
    });
    expect(correction).toMatchObject({
      action: "correct",
      previous_revision: { revision: 2, identity_id: "identity-original" },
      current_revision: { revision: 3, lifecycle_action: "correct", identity_id: "identity-corrected" },
    });
    expect(identities).toEqual(stateBeforeCorrection);
    expect(correction.previous_revision?.evidence).toEqual({
      observed_label: "Original label",
      evidence_id: "evidence-1",
    });
    identities = correction.identities;

    const retirement = append(identities, {
      identity_id: corrected.identity_id,
      source: normalizedSource,
      mapping_kind: "authoritative",
      status: "retired",
    });
    expect(retirement).toMatchObject({
      action: "retire",
      previous_revision: { revision: 3, identity_id: "identity-corrected" },
      current_revision: {
        revision: 4,
        lifecycle_action: "retire",
        identity_id: "identity-corrected",
        status: "retired",
      },
    });
    expect(retirement.current_revision.evidence).toEqual({
      observed_label: "Corrected label",
      evidence_id: "evidence-2",
    });

    expect(retirement.identities.flatMap((identity) => identity.source_mappings).map((revision) => ({
      revision: (revision as unknown as ExpectedMappingRevision).revision,
      identity_id: (revision as unknown as ExpectedMappingRevision).identity_id,
      action: (revision as unknown as ExpectedMappingRevision).lifecycle_action,
    }))).toEqual([
      { revision: 1, identity_id: "identity-original", action: "create" },
      { revision: 2, identity_id: "identity-original", action: "promote" },
      { revision: 3, identity_id: "identity-corrected", action: "correct" },
      { revision: 4, identity_id: "identity-corrected", action: "retire" },
    ]);

    expect(identityContract.resolveCanonicalIdentity(retirement.identities, {
      kind: "source",
      source: normalizedSource,
    } as never)).toMatchObject({
      status: "resolved",
      identity_id: "identity-corrected",
      trust: "non_authoritative",
    });
  });

  test("fails external source ambiguity closed with IDENTITY_ALIAS_AMBIGUOUS", () => {
    expect(identityContract.IDENTITY_REFERENCE_AMBIGUOUS).toBe(identityContract.IDENTITY_ALIAS_AMBIGUOUS);
    const append = lifecycleApi();
    expect(typeof append).toBe("function");
    if (!append) return;

    const first = append([agent("identity-first", "first")], {
      identity_id: "identity-first",
      source: normalizedSource,
      mapping_kind: "authoritative",
    }).identities[0]!;
    const second = append([agent("identity-second", "second")], {
      identity_id: "identity-second",
      source: normalizedSource,
      mapping_kind: "authoritative",
    }).identities[0]!;

    const resolution = identityContract.resolveCanonicalIdentity([first, second], {
      kind: "source",
      source: normalizedSource,
    } as never);
    expect(resolution).toEqual(expect.objectContaining({
      status: "ambiguous",
      code: identityContract.IDENTITY_ALIAS_AMBIGUOUS,
      candidate_identity_ids: ["identity-first", "identity-second"],
      trust: "denied",
    }));
    expect("identity" in resolution).toBe(false);
  });

  test("reports dry-run mapping lifecycle transitions without writes", () => {
    const append = lifecycleApi();
    expect(typeof append).toBe("function");
    if (!append) return;

    const canonical = agent("identity-migrate", "migrate");
    const imported = append([canonical], {
      identity_id: canonical.identity_id,
      source: normalizedSource,
      mapping_kind: "imported",
      evidence: { observed_label: "Migrating Agent" },
    }).identities[0]!;
    const legacy = identityContract.createIdentity({
      id: canonical.identity_id,
      kind: "agent",
      fullName: "Migrating Agent",
    });

    const report = identityContract.planCanonicalIdentityMigration({
      legacy_identities: [legacy],
      existing_identities: [imported],
      bindings: [{
        identity_id: canonical.identity_id,
        canonical_handle: canonical.canonical_handle,
        source_mappings: [{
          source: normalizedSource,
          mapping_kind: "authoritative",
          status: "active",
        }],
      }],
      generated_at: "2026-07-23T12:00:00.000Z",
    } as never);

    expect(report.writes_applied).toBe(0);
    expect(report.changes[0]).toEqual(expect.objectContaining({
      identity_id: canonical.identity_id,
      mapping_transitions: [expect.objectContaining({
        lineage_key: expectedLineageKey,
        action: "promote",
        previous_revision: 1,
        current_revision: 2,
      })],
    }));

    const corrected = agent("identity-corrected-migration", "corrected-migration");
    const promotedState = append([imported, corrected], {
      identity_id: canonical.identity_id,
      source: normalizedSource,
      mapping_kind: "authoritative",
    }).identities;
    const frozenPromotedState = structuredClone(promotedState);
    const correctionReport = identityContract.planCanonicalIdentityMigration({
      legacy_identities: [identityContract.createIdentity({
        id: corrected.identity_id,
        kind: "agent",
        fullName: "Corrected Migrating Agent",
      })],
      existing_identities: promotedState,
      bindings: [{
        identity_id: corrected.identity_id,
        canonical_handle: corrected.canonical_handle,
        source_mappings: [{
          source: normalizedSource,
          mapping_kind: "authoritative",
          status: "active",
          evidence: { observed_label: "Corrected Migrating Agent" },
        }],
      }],
      generated_at: "2026-07-23T12:00:00.000Z",
    } as never);

    expect(correctionReport.writes_applied).toBe(0);
    expect(promotedState).toEqual(frozenPromotedState);
    expect(correctionReport.changes[0]).toEqual(expect.objectContaining({
      identity_id: corrected.identity_id,
      mapping_transitions: [expect.objectContaining({
        lineage_key: expectedLineageKey,
        action: "correct",
        previous_revision: 2,
        current_revision: 3,
      })],
    }));
    expect(correctionReport.changes[0]?.record?.source_mappings).toEqual([
      expect.objectContaining({
        identity_id: corrected.identity_id,
        revision: 3,
        lifecycle_action: "correct",
      }),
    ]);
  });

  test("ships a machine-independent pinned conformance fixture and matching fingerprint", () => {
    const exports = identityContract as unknown as Record<string, unknown>;
    const fixturePath = "docs/fixtures/agent-identity-v1.conformance.json";
    expect(exports["AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_PATH"]).toBe(fixturePath);
    expect(exports["AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_ID"]).toBe(
      "hasna.identities.agent-identity/v1/conformance/1",
    );

    const absolutePath = join(import.meta.dir, "..", fixturePath);
    expect(existsSync(absolutePath)).toBe(true);
    if (!existsSync(absolutePath)) return;

    const bytes = readFileSync(absolutePath);
    const fingerprint = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    expect(exports["AGENT_IDENTITY_V1_CONFORMANCE_FIXTURE_SHA256"]).toBe(fingerprint);

    const fixture = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
    expect(fixture).toEqual(expect.objectContaining({
      fixture_id: "hasna.identities.agent-identity/v1/conformance/1",
      contract: "hasna.identities.agent-identity/v1",
      version: 1,
      lineage: expect.objectContaining({
        field_order: [
          "source_authority",
          "source_tenant_id",
          "source_namespace",
          "source_entity_type",
          "source_record_id",
        ],
        canonical_key: expectedLineageKey,
      }),
      ambiguity: expect.objectContaining({ public_code: "IDENTITY_ALIAS_AMBIGUOUS" }),
      read_preferences: {
        default: "canonical_first",
        canary: "canonical_first",
        rollback: "legacy_first",
      },
      runtime_context: {
        runtime_field: "runtime_instance_id",
        lease_fence_authority: "external Runtime Coordination",
      },
    }));

    const serialized = bytes.toString("utf8");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toMatch(/https?:\/\//);
    for (const requiredSection of ["normalization", "trust", "ambiguity", "lifecycle", "read_preferences", "runtime_context"]) {
      expect(fixture).toHaveProperty(requiredSection);
    }

    const lineage = fixture["lineage"] as {
      input: typeof canonicalSource;
      normalized: typeof normalizedSource;
      canonical_key: string;
    };
    expect(identityContract.sourceLineageKey(lineage.input as never)).toBe(lineage.canonical_key);
    expect(identityContract.sourceLineageKey(lineage.normalized as never)).toBe(lineage.canonical_key);
    expect(identityContract.DEFAULT_IDENTITY_READ_PREFERENCE).toBe("canonical_first");
    expect((identityContract as unknown as { CANARY_IDENTITY_READ_PREFERENCE: string })
      .CANARY_IDENTITY_READ_PREFERENCE).toBe("canonical_first");
    expect(identityContract.ROLLBACK_IDENTITY_READ_PREFERENCE).toBe("legacy_first");

    const runtime = identityContract.createIdentityRuntimeContext("identity-runtime", {
      runtime: { runtime_instance_id: "runtime-instance-1" },
    });
    expect(runtime.runtime).toEqual({ runtime_instance_id: "runtime-instance-1" });
    expect(runtime.lease_fence_authority).toBe("external Runtime Coordination");

    const append = lifecycleApi();
    expect(typeof append).toBe("function");
    if (!append) return;
    let identities: readonly CanonicalIdentity[] = [
      agent("identity-original", "fixture-original"),
      agent("identity-corrected", "fixture-corrected"),
    ];
    const revisions = (fixture["lifecycle"] as {
      revisions: Array<{
        revision: number;
        action: "create" | "promote" | "correct" | "retire";
        identity_id: string;
        mapping_kind: "authoritative" | "imported";
        status: "active" | "retired";
        evidence: Readonly<Record<string, unknown>>;
      }>;
    }).revisions;
    for (const expected of revisions) {
      const appended = append(identities, {
        identity_id: expected.identity_id,
        source: lineage.normalized,
        mapping_kind: expected.mapping_kind,
        status: expected.status,
        evidence: expected.evidence,
      });
      expect(appended.action).toBe(expected.action);
      expect(appended.current_revision).toMatchObject({
        revision: expected.revision,
        lifecycle_action: expected.action,
        identity_id: expected.identity_id,
        evidence: expected.evidence,
      });
      identities = appended.identities;
    }
    expect(identityContract.resolveCanonicalIdentity(identities, {
      kind: "source",
      source: lineage.normalized,
    } as never)).toMatchObject({
      status: "resolved",
      identity_id: "identity-corrected",
      trust: "non_authoritative",
    });
  });
});
