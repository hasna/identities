import type { ConfigsInstructionSourceExport, InstructionSource, InstructionSourceExport, InstructionSourceInput } from "./types.js";
export declare const globalAgentInstructionSourceSet: {
    readonly id: "hasna-global-agent-rules-standard";
    readonly version: "2026-07-23";
    readonly title: "Hasna Global Coding Agent Rules Standard";
};
export declare const agentOperatingRulesVersion: "1.1.5";
export declare const agentOperatingRulesSentinel: "<!-- hasna:agent-operating-rules v=1.1.5 -->";
export declare const noBrittleHardcodingRule: "Do not hardcode brittle values, paths, provider names, config, business logic, environment-specific IDs, or one-off mappings when a source-of-truth, schema/config-driven, package-owned, reusable, or cleaner abstraction exists. This is especially strict in medium and large applications. Explicit constants, fixtures, tests, and temporary compatibility shims are allowed only when scoped, named, and justified.";
export declare const globalAgentInstructionProviders: readonly ["generic", "antigravity", "codewith", "claude", "codex", "opencode"];
export type GlobalAgentInstructionProvider = (typeof globalAgentInstructionProviders)[number];
export interface GlobalAgentInstructionSourceOptions {
    providers?: readonly string[];
}
export declare const globalAgentInstructionSourceInputs: InstructionSourceInput[];
export declare function listGlobalAgentInstructionSources(options?: GlobalAgentInstructionSourceOptions): InstructionSource[];
export declare function createGlobalAgentInstructionSourceExport(options?: GlobalAgentInstructionSourceOptions): InstructionSourceExport;
export declare function createGlobalAgentConfigsInstructionSourceExport(options?: GlobalAgentInstructionSourceOptions): ConfigsInstructionSourceExport;
