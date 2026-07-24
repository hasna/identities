import type { ConfigsInstructionLayer, ConfigsInstructionSourceExport, Identity, InstructionSource, InstructionSourceExport, InstructionSourceInput, InstructionSourceKind, InstructionSourceValidationResult } from "./types.js";
export declare const instructionSourceKindPrecedence: Record<InstructionSourceKind, number>;
export declare const configsInstructionExportContract: "hasna.identities.configs-instructions/v1";
export declare const instructionSourceSchema: {
    readonly version: 1;
    readonly kinds: readonly ["global-rules", "provider-rules", "global-system-prompt", "provider-system-prompt", "identity-doc", "persona-doc", "account-overlay", "machine-overlay", "project-overlay", "session-overlay"];
    readonly ownerKinds: readonly ["global", "provider", "identity", "persona", "account", "machine", "project", "session"];
    readonly sensitivity: readonly ["public", "internal", "confidential", "secret"];
    readonly mergePolicies: readonly ["append", "replace"];
    readonly safetyClasses: readonly ["standard", "safety", "non-overridable-safety"];
    readonly providerStrategies: readonly ["native", "import", "managed-block", "rendered", "unsupported"];
    readonly precedence: Record<"global-rules" | "provider-rules" | "global-system-prompt" | "provider-system-prompt" | "identity-doc" | "persona-doc" | "account-overlay" | "machine-overlay" | "project-overlay" | "session-overlay", number>;
    readonly failClosed: {
        readonly nonOverridableSafetyRules: readonly ["must use append mergePolicy", "must carry at least one ruleId", "cannot be replaced by later replace-policy sources", "cannot be duplicated with different content", "cannot be exported with secret sensitivity"];
    };
};
interface NormalizeInstructionOptions {
    identityId?: string;
    now?: string;
}
export declare function nowInstructionIso(): string;
export declare function hashInstructionContent(value: unknown): string;
export declare function normalizeInstructionSource(input: InstructionSourceInput | InstructionSource, options?: NormalizeInstructionOptions): InstructionSource;
export declare function normalizeInstructionSources(sources: Array<InstructionSourceInput | InstructionSource> | undefined, options?: NormalizeInstructionOptions): InstructionSource[];
export declare function createIdentityDocumentInstructionSources(identity: Identity): InstructionSource[];
export declare function listIdentityInstructionSources(identity: Identity, options?: {
    includeDocuments?: boolean;
}): InstructionSource[];
export declare function sortInstructionSources(sources: InstructionSource[]): InstructionSource[];
export declare function validateInstructionSources(sources: Array<InstructionSourceInput | InstructionSource>): InstructionSourceValidationResult;
export declare function createInstructionSourceExport(sources: Array<InstructionSourceInput | InstructionSource>, metadata?: Record<string, unknown>): InstructionSourceExport;
export declare function createConfigsInstructionSourceExport(sources: Array<InstructionSourceInput | InstructionSource>, metadata?: Record<string, unknown>): ConfigsInstructionSourceExport;
export declare function projectInstructionSourcePaths(sources: InstructionSource[]): Array<{
    sourceId: string;
    kind: InstructionSourceKind;
    owner: string;
    path: string;
    editable: boolean;
    required: boolean;
    hash?: string;
}>;
export declare function instructionKindToConfigsLayer(kind: InstructionSourceKind): ConfigsInstructionLayer;
export {};
