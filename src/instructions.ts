import { createHash } from "node:crypto";
import type {
  Identity,
  IdentityDocumentKey,
  InstructionMergePolicy,
  InstructionProviderCompatibility,
  InstructionProviderStrategy,
  InstructionSafetyClass,
  InstructionSensitivity,
  InstructionSource,
  InstructionSourceExport,
  InstructionSourceInput,
  InstructionSourceKind,
  InstructionSourceOwner,
  InstructionSourceOwnerKind,
  InstructionSourcePath,
  InstructionSourceProvenance,
  InstructionSourceValidationIssue,
  InstructionSourceValidationResult,
} from "./types.js";
import {
  identityDocumentKeys,
  instructionMergePolicies,
  instructionOwnerKinds,
  instructionProviderStrategies,
  instructionSafetyClasses,
  instructionSensitivityLevels,
  instructionSourceKinds,
} from "./types.js";

export const instructionSourceKindPrecedence: Record<InstructionSourceKind, number> = {
  "global-rules": 100,
  "global-system-prompt": 150,
  "provider-rules": 200,
  "provider-system-prompt": 250,
  "identity-doc": 300,
  "persona-doc": 350,
  "account-overlay": 500,
  "machine-overlay": 600,
  "project-overlay": 700,
  "session-overlay": 800,
};

export const instructionSourceSchema = {
  version: 1,
  kinds: instructionSourceKinds,
  ownerKinds: instructionOwnerKinds,
  sensitivity: instructionSensitivityLevels,
  mergePolicies: instructionMergePolicies,
  safetyClasses: instructionSafetyClasses,
  providerStrategies: instructionProviderStrategies,
  precedence: instructionSourceKindPrecedence,
  failClosed: {
    nonOverridableSafetyRules: [
      "must use append mergePolicy",
      "must carry at least one ruleId",
      "cannot be replaced by later replace-policy sources",
      "cannot be duplicated with different content",
      "cannot be exported with secret sensitivity",
    ],
  },
} as const;

interface NormalizeInstructionOptions {
  identityId?: string;
  now?: string;
}

export function nowInstructionIso(): string {
  return new Date().toISOString();
}

export function hashInstructionContent(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

export function normalizeInstructionSource(
  input: InstructionSourceInput | InstructionSource,
  options: NormalizeInstructionOptions = {},
): InstructionSource {
  const now = options.now ?? nowInstructionIso();
  const kind = requireInstructionSourceKind(input.kind);
  const owner = normalizeInstructionOwner(input.owner, kind, options.identityId);
  const title = trimmed(input.title) ?? defaultInstructionTitle(kind);
  const safety = requireSafetyClass(input.safety ?? (input.nonOverridable ? "non-overridable-safety" : "standard"));
  const nonOverridable = input.nonOverridable ?? safety === "non-overridable-safety";
  const mergePolicy = requireMergePolicy(input.mergePolicy ?? "append");
  const sensitivity = requireSensitivity(input.sensitivity ?? "internal");
  const sourcePaths = normalizeSourcePaths(input.sourcePaths);
  const targetProviders = normalizeStringList(input.targetProviders).length > 0
    ? normalizeStringList(input.targetProviders)
    : ["generic"];
  const providerCompatibility = normalizeProviderCompatibility(input.providerCompatibility, targetProviders);
  const ruleIds = normalizeStringList(input.ruleIds);
  const globs = normalizeStringList(input.globs);
  const precedence = input.precedence ?? instructionSourceKindPrecedence[kind];
  const provenance = normalizeProvenance(input.provenance, now);
  const content = normalizeContent(input.content);
  const replacementScope = trimmed(input.replacementScope);
  const id = trimmed(input.id) ?? createInstructionSourceId({
    kind,
    owner,
    title,
    ruleIds,
    targetProviders,
    replacementScope,
  });
  const hashPayload = {
    kind,
    title,
    content,
    owner,
    sensitivity,
    precedence,
    mergePolicy,
    replacementScope,
    safety,
    nonOverridable,
    ruleIds,
    targetProviders,
    providerCompatibility,
    sourcePaths,
    globs,
  };
  const pathHash = sourcePaths.length > 0 ? hashInstructionContent(sourcePaths.map(({ path, editable, required, format }) => ({
    path,
    editable,
    required: required ?? false,
    format,
  }))) : undefined;

  return {
    id,
    kind,
    title,
    content,
    owner,
    sensitivity,
    precedence,
    mergePolicy,
    replacementScope,
    safety: nonOverridable ? "non-overridable-safety" : safety,
    nonOverridable,
    ruleIds,
    targetProviders,
    providerCompatibility,
    sourcePaths,
    globs,
    hash: hashInstructionContent(hashPayload),
    pathHash,
    provenance,
    metadata: input.metadata ?? {},
  };
}

export function normalizeInstructionSources(
  sources: Array<InstructionSourceInput | InstructionSource> | undefined,
  options: NormalizeInstructionOptions = {},
): InstructionSource[] {
  return sortInstructionSources((sources ?? []).map((source) => normalizeInstructionSource(source, options)));
}

export function createIdentityDocumentInstructionSources(identity: Identity): InstructionSource[] {
  const sources: InstructionSource[] = [];
  for (const key of identityDocumentKeys) {
    const content = identity.documents[key]?.trim();
    if (!content) continue;
    sources.push(normalizeInstructionSource({
      id: `identity:${identity.id}:doc:${key}`,
      kind: instructionKindForDocument(key),
      title: `Identity ${key}`,
      content,
      owner: {
        kind: key === "personality" || key === "soul" || key === "ethos" || key === "voice" ? "persona" : "identity",
        id: identity.id,
        name: identity.displayName ?? identity.fullName,
      },
      sensitivity: "internal",
      precedence: instructionKindForDocument(key) === "persona-doc" ? 350 : 300,
      mergePolicy: "append",
      ruleIds: [`identity-doc:${key}`],
      targetProviders: ["generic"],
      providerCompatibility: [{
        provider: "generic",
        supported: true,
        strategy: "rendered",
        notes: "Downstream config renderers may map identity documents into provider-native instruction files.",
      }],
      provenance: {
        source: "identity.documents",
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      },
    }, { identityId: identity.id }));
  }
  return sources;
}

export function listIdentityInstructionSources(identity: Identity, options: { includeDocuments?: boolean } = {}): InstructionSource[] {
  const explicit = normalizeInstructionSources(identity.instructionSources, { identityId: identity.id });
  const derived = options.includeDocuments === false ? [] : createIdentityDocumentInstructionSources(identity);
  return sortInstructionSources([...explicit, ...derived]);
}

export function sortInstructionSources(sources: InstructionSource[]): InstructionSource[] {
  return [...sources].sort((left, right) => {
    if (left.precedence !== right.precedence) return left.precedence - right.precedence;
    if (left.kind !== right.kind) return left.kind.localeCompare(right.kind);
    return left.id.localeCompare(right.id);
  });
}

export function validateInstructionSources(
  sources: Array<InstructionSourceInput | InstructionSource>,
): InstructionSourceValidationResult {
  const normalized = normalizeInstructionSources(sources);
  const issues: InstructionSourceValidationIssue[] = [];
  const seenIds = new Set<string>();
  const ruleOwners = new Map<string, InstructionSource>();
  const nonOverridableSafetyRules: string[] = [];

  for (const source of normalized) {
    if (seenIds.has(source.id)) {
      issues.push({
        severity: "error",
        code: "duplicate_source_id",
        message: `Duplicate instruction source id: ${source.id}`,
        sourceId: source.id,
      });
    }
    seenIds.add(source.id);

    if (!source.content && source.sourcePaths.length === 0) {
      issues.push({
        severity: "error",
        code: "missing_content_or_path",
        message: "Instruction source must include inline content or at least one source path.",
        sourceId: source.id,
      });
    }

    if (source.sensitivity === "secret") {
      issues.push({
        severity: "error",
        code: "secret_instruction_source",
        message: "Instruction sources cannot carry secret sensitivity; store secrets in a vault and reference non-secret policy only.",
        sourceId: source.id,
      });
    }

    if (source.targetProviders.length === 0) {
      issues.push({
        severity: "error",
        code: "missing_target_provider",
        message: "Instruction source must declare at least one target provider.",
        sourceId: source.id,
      });
    }

    for (const provider of source.targetProviders) {
      const compatibility = source.providerCompatibility.find((item) => item.provider === provider);
      if (!compatibility) {
        issues.push({
          severity: "warning",
          code: "missing_provider_compatibility",
          message: `Provider compatibility is not declared for ${provider}.`,
          sourceId: source.id,
        });
      } else if (!compatibility.supported) {
        issues.push({
          severity: "error",
          code: "unsupported_provider",
          message: `Instruction source targets unsupported provider ${provider}.`,
          sourceId: source.id,
        });
      }
    }

    if (source.nonOverridable || source.safety === "non-overridable-safety") {
      if (source.mergePolicy !== "append") {
        issues.push({
          severity: "error",
          code: "non_overridable_must_append",
          message: "Non-overridable safety instruction sources must use append mergePolicy.",
          sourceId: source.id,
        });
      }
      if (source.ruleIds.length === 0) {
        issues.push({
          severity: "error",
          code: "non_overridable_missing_rule_id",
          message: "Non-overridable safety instruction sources must declare at least one ruleId.",
          sourceId: source.id,
        });
      }
      nonOverridableSafetyRules.push(...source.ruleIds);
    }

    for (const ruleId of source.ruleIds) {
      const existing = ruleOwners.get(ruleId);
      if (!existing) {
        ruleOwners.set(ruleId, source);
        continue;
      }
      const sameHash = existing.hash === source.hash;
      const guarded = existing.nonOverridable || source.nonOverridable;
      issues.push({
        severity: guarded && !sameHash ? "error" : "warning",
        code: guarded && !sameHash ? "non_overridable_rule_conflict" : "duplicate_rule_id",
        message: sameHash
          ? `Duplicate instruction rule id has identical content hash: ${ruleId}`
          : `Duplicate instruction rule id has different content hash: ${ruleId}`,
        sourceId: source.id,
        ruleId,
      });
    }
  }

  for (const source of normalized) {
    if (source.mergePolicy !== "replace") continue;
    for (const protectedSource of normalized) {
      if (source.id === protectedSource.id || !protectedSource.nonOverridable) continue;
      if (source.precedence < protectedSource.precedence) continue;
      if (!replacementIntersects(source, protectedSource)) continue;
      issues.push({
        severity: "error",
        code: "replace_overrides_non_overridable",
        message: `Replace-policy source ${source.id} would override non-overridable safety source ${protectedSource.id}.`,
        sourceId: source.id,
      });
    }
  }

  const effectiveHash = hashInstructionContent(normalized.map((source) => ({
    id: source.id,
    hash: source.hash,
    precedence: source.precedence,
    mergePolicy: source.mergePolicy,
    replacementScope: source.replacementScope,
  })));

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    sourceCount: normalized.length,
    issues,
    effectiveHash,
    nonOverridableSafetyRules: [...new Set(nonOverridableSafetyRules)].sort(),
  };
}

export function createInstructionSourceExport(
  sources: Array<InstructionSourceInput | InstructionSource>,
  metadata: Record<string, unknown> = {},
): InstructionSourceExport {
  const normalized = normalizeInstructionSources(sources);
  return {
    version: 1,
    package: "@hasna/identities",
    exportedAt: nowInstructionIso(),
    sources: normalized,
    validation: validateInstructionSources(normalized),
    metadata,
  };
}

export function projectInstructionSourcePaths(sources: InstructionSource[]): Array<{
  sourceId: string;
  kind: InstructionSourceKind;
  owner: string;
  path: string;
  editable: boolean;
  required: boolean;
  hash?: string;
}> {
  return sortInstructionSources(sources).flatMap((source) => source.sourcePaths.map((path) => ({
    sourceId: source.id,
    kind: source.kind,
    owner: `${source.owner.kind}:${source.owner.id}`,
    path: path.path,
    editable: path.editable,
    required: path.required ?? false,
    hash: path.hash,
  })));
}

function normalizeInstructionOwner(
  owner: Partial<InstructionSourceOwner> | undefined,
  kind: InstructionSourceKind,
  identityId: string | undefined,
): InstructionSourceOwner {
  const fallbackKind = defaultOwnerKind(kind);
  const ownerKind = requireOwnerKind(owner?.kind ?? fallbackKind);
  const ownerId = trimmed(owner?.id) ?? (ownerKind === "identity" || ownerKind === "persona" ? identityId : ownerKind);
  if (!ownerId) throw new Error(`Instruction source owner id is required for ${ownerKind}`);
  return {
    kind: ownerKind,
    id: ownerId,
    name: trimmed(owner?.name),
  };
}

function normalizeSourcePaths(paths: InstructionSourcePath[] | undefined): InstructionSourcePath[] {
  const seen = new Set<string>();
  const normalized: InstructionSourcePath[] = [];
  for (const path of paths ?? []) {
    const value = trimmed(path.path);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push({
      path: value,
      editable: path.editable ?? false,
      required: path.required,
      format: path.format,
      hash: trimmed(path.hash),
      label: trimmed(path.label),
    });
  }
  return normalized;
}

function normalizeProviderCompatibility(
  compatibility: InstructionProviderCompatibility[] | undefined,
  targetProviders: string[],
): InstructionProviderCompatibility[] {
  const byProvider = new Map<string, InstructionProviderCompatibility>();
  for (const item of compatibility ?? []) {
    const provider = trimmed(item.provider);
    if (!provider) continue;
    byProvider.set(provider, {
      provider,
      supported: item.supported ?? true,
      strategy: requireProviderStrategy(item.strategy ?? "rendered"),
      nativePaths: normalizeStringList(item.nativePaths),
      notes: trimmed(item.notes),
      minVersion: trimmed(item.minVersion),
    });
  }
  for (const provider of targetProviders) {
    if (byProvider.has(provider)) continue;
    byProvider.set(provider, {
      provider,
      supported: true,
      strategy: provider === "generic" ? "rendered" : "managed-block",
    });
  }
  return [...byProvider.values()].sort((left, right) => left.provider.localeCompare(right.provider));
}

function normalizeProvenance(
  provenance: Partial<InstructionSourceProvenance> | undefined,
  now: string,
): InstructionSourceProvenance {
  return {
    createdAt: provenance?.createdAt ?? now,
    updatedAt: provenance?.updatedAt ?? now,
    source: trimmed(provenance?.source),
    importedFrom: trimmed(provenance?.importedFrom),
  };
}

function normalizeStringList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeContent(value: string | undefined): string | undefined {
  const trimmedValue = value?.replace(/\r\n/g, "\n").trim();
  return trimmedValue ? `${trimmedValue}\n` : undefined;
}

function createInstructionSourceId(input: {
  kind: InstructionSourceKind;
  owner: InstructionSourceOwner;
  title: string;
  ruleIds: string[];
  targetProviders: string[];
  replacementScope?: string;
}): string {
  const digest = createHash("sha256")
    .update(stableStringify(input))
    .digest("hex")
    .slice(0, 16);
  return `instr_${digest}`;
}

function defaultInstructionTitle(kind: InstructionSourceKind): string {
  return kind.split("-").map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ");
}

function defaultOwnerKind(kind: InstructionSourceKind): InstructionSourceOwnerKind {
  if (kind.startsWith("provider-")) return "provider";
  if (kind === "identity-doc") return "identity";
  if (kind === "persona-doc") return "persona";
  if (kind === "account-overlay") return "account";
  if (kind === "machine-overlay") return "machine";
  if (kind === "project-overlay") return "project";
  if (kind === "session-overlay") return "session";
  return "global";
}

function instructionKindForDocument(key: IdentityDocumentKey): InstructionSourceKind {
  if (key === "personality" || key === "soul" || key === "ethos" || key === "voice") return "persona-doc";
  return "identity-doc";
}

function replacementIntersects(source: InstructionSource, protectedSource: InstructionSource): boolean {
  if (source.replacementScope === "*") return true;
  if (source.replacementScope && protectedSource.replacementScope && source.replacementScope === protectedSource.replacementScope) {
    return true;
  }
  return source.ruleIds.some((ruleId) => protectedSource.ruleIds.includes(ruleId));
}

function requireInstructionSourceKind(value: string): InstructionSourceKind {
  if ((instructionSourceKinds as readonly string[]).includes(value)) return value as InstructionSourceKind;
  throw new Error(`Invalid instruction source kind: ${value}`);
}

function requireOwnerKind(value: string): InstructionSourceOwnerKind {
  if ((instructionOwnerKinds as readonly string[]).includes(value)) return value as InstructionSourceOwnerKind;
  throw new Error(`Invalid instruction owner kind: ${value}`);
}

function requireSensitivity(value: string): InstructionSensitivity {
  if ((instructionSensitivityLevels as readonly string[]).includes(value)) return value as InstructionSensitivity;
  throw new Error(`Invalid instruction sensitivity: ${value}`);
}

function requireMergePolicy(value: string): InstructionMergePolicy {
  if ((instructionMergePolicies as readonly string[]).includes(value)) return value as InstructionMergePolicy;
  throw new Error(`Invalid instruction merge policy: ${value}`);
}

function requireSafetyClass(value: string): InstructionSafetyClass {
  if ((instructionSafetyClasses as readonly string[]).includes(value)) return value as InstructionSafetyClass;
  throw new Error(`Invalid instruction safety class: ${value}`);
}

function requireProviderStrategy(value: string): InstructionProviderStrategy {
  if ((instructionProviderStrategies as readonly string[]).includes(value)) return value as InstructionProviderStrategy;
  throw new Error(`Invalid instruction provider strategy: ${value}`);
}

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}
