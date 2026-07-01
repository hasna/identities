import {
  createConfigsInstructionSourceExport,
  createInstructionSourceExport,
  normalizeInstructionSources,
} from "./instructions.js";
import type {
  ConfigsInstructionSourceExport,
  InstructionProviderCompatibility,
  InstructionSource,
  InstructionSourceExport,
  InstructionSourceInput,
} from "./types.js";

export const globalAgentInstructionSourceSet = {
  id: "hasna-global-agent-rules-standard",
  version: "2026-07-01",
  title: "Hasna Global Coding Agent Rules Standard",
} as const;

export const globalAgentInstructionProviders = ["generic", "codewith", "claude", "codex", "opencode"] as const;

export type GlobalAgentInstructionProvider = (typeof globalAgentInstructionProviders)[number];

export interface GlobalAgentInstructionSourceOptions {
  providers?: readonly string[];
}

const sourceSetMetadata = {
  sourceSet: globalAgentInstructionSourceSet.id,
  sourceSetVersion: globalAgentInstructionSourceSet.version,
  plan: "global-agent-rules-standard",
} as const;

const provenance = {
  source: "open-identities:global-agent-rules",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as const;

const globalProviderCompatibility: InstructionProviderCompatibility[] = [
  {
    provider: "generic",
    supported: true,
    strategy: "rendered",
    notes: "Provider-neutral source for renderers that do not have a native instruction file.",
  },
  {
    provider: "codewith",
    supported: true,
    strategy: "managed-block",
    nativePaths: ["CODEWITH.md", "~/.codewith/CODEWITH.md"],
    notes: "OpenConfigs should render this as a managed Codewith instruction block.",
  },
  {
    provider: "claude",
    supported: true,
    strategy: "managed-block",
    nativePaths: ["CLAUDE.md", "~/.claude/CLAUDE.md"],
    notes: "OpenConfigs should render this as a managed Claude Code instruction block.",
  },
  {
    provider: "codex",
    supported: true,
    strategy: "managed-block",
    nativePaths: ["AGENTS.md", "~/.codex/AGENTS.md"],
    notes: "OpenConfigs should render this as a managed Codex instruction block.",
  },
  {
    provider: "opencode",
    supported: true,
    strategy: "import",
    nativePaths: ["opencode.json", "~/.config/opencode/opencode.json"],
    notes: "OpenConfigs should render this as OpenCode instruction references in opencode.json pointing at managed fragments.",
  },
];

const codewithCompatibility: InstructionProviderCompatibility[] = [{
  provider: "codewith",
  supported: true,
  strategy: "managed-block",
  nativePaths: ["CODEWITH.md", "~/.codewith/CODEWITH.md"],
  notes: "Provider overlay for Codewith-native goals, schedules, and loops.",
}];

const claudeCompatibility: InstructionProviderCompatibility[] = [{
  provider: "claude",
  supported: true,
  strategy: "managed-block",
  nativePaths: ["CLAUDE.md", "~/.claude/CLAUDE.md"],
  notes: "Provider overlay for Claude Code instruction files.",
}];

const codexCompatibility: InstructionProviderCompatibility[] = [{
  provider: "codex",
  supported: true,
  strategy: "managed-block",
  nativePaths: ["AGENTS.md", "~/.codex/AGENTS.md"],
  notes: "Provider overlay for Codex instruction files.",
}];

const opencodeCompatibility: InstructionProviderCompatibility[] = [{
  provider: "opencode",
  supported: true,
  strategy: "import",
  nativePaths: ["opencode.json", "~/.config/opencode/opencode.json"],
  notes: "Provider overlay for OpenCode opencode.json instruction references.",
}];

export const globalAgentInstructionSourceInputs: InstructionSourceInput[] = [
  {
    id: "hasna-global-coding-agent-system-prompt",
    kind: "global-system-prompt",
    title: "Canonical Global Coding Agent System Prompt",
    content: lines([
      "# Canonical Global Coding Agent Prompt",
      "",
      "You are a Hasna coding agent operating inside a shared engineering workspace. Treat repository code, tracked tasks, durable plans, and package-owned data sources as the source of truth. Prefer direct execution, evidence, and small reversible changes over advice that asks a human to run commands you can run yourself.",
      "",
      "Use the Knowledge CLI or SDK for durable knowledge reads and writes. Do not create, update, or rely on ad hoc global Markdown under $HOME/.hasna, $HOME/.husna, or similar home-level scratch paths as instruction or knowledge truth.",
      "",
      "Use the Todos CLI and todos plans for planning, task state, comments, commits, verification evidence, and handoff notes. Use Mementos, Conversations, and Projects CLIs as their domain source of truth where memory, coordination, or project registry state is involved.",
      "",
      "Coordinator sessions route implementation through subagents and task workflows. A coordinator may inspect, plan, review, and record evidence, but it must not write product code directly unless the task explicitly assigns implementation to that session.",
      "",
      "When a dispatch, package, or automation path fails, self-heal the owning package instead of bypassing it. Pull or inspect the owning repository, fix the CLI or SDK behavior, publish or prepare the package update as required, update affected machines, and record evidence. Do not fall back to tmux prompt paste unless a human explicitly authorizes that emergency path.",
      "",
      "Apply a minimum adversarial verification policy: non-trivial code, config, release, or operational changes require an independent adversarial review or a clearly labeled adversarial self-review when no reviewer can be spawned. Reconcile findings before marking work complete.",
      "",
      "Protect secrets and provenance. Never expose API keys, tokens, app passwords, private keys, or credential values. Before every commit or push, run the mandated staged secrets scan for credential patterns. Stop and remove any discovered secret from the diff before committing. Do not add Co-Authored-By trailers to commits.",
      "",
      "Use Bun for JavaScript and TypeScript workspace installs, scripts, tests, and builds unless a repository explicitly requires another tool. Keep Bun's package release-age quarantine enabled; when creating or publishing a new supervised Hasna package, add the exact package name to the Bun release-age exclusion registry before relying on fresh installs.",
    ]),
    owner: { kind: "global", id: "global", name: "Hasna Global Agent Rules" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "safety",
    ruleIds: ["global-agent:canonical-system-prompt"],
    targetProviders: [...globalAgentInstructionProviders],
    providerCompatibility: globalProviderCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "canonical-system-prompt",
    },
  },
  {
    id: "hasna-global-coding-agent-non-overridable-rules",
    kind: "global-rules",
    title: "Non-Overridable Global Coding Agent Rules",
    content: lines([
      "# Non-Overridable Global Coding Agent Rules",
      "",
      "1. Knowledge belongs in the Knowledge CLI or SDK. Do not use ad hoc global Markdown under $HOME/.hasna, $HOME/.husna, or similar home-level paths as a replacement for the knowledge system.",
      "2. Planning and evidence belong in Todos CLI tasks and todos plans. Keep task status, comments, commits, verification commands, and handoff evidence current.",
      "3. Mementos, Conversations, and Projects CLIs are the source of truth for memory, team coordination, and project registry state when those domains apply.",
      "4. Coordinator sessions do not write product code directly. They delegate implementation through subagents or task workflows and then inspect, review, and coordinate the result.",
      "5. Codewith native loops are Codewith-native scheduled or recurring sessions, including /loop and built-in loop tools. OpenLoops is a separate orchestration package and daemon. Use the correct term and mechanism.",
      "6. Dispatch failure requires self-healing. Do not use tmux prompt paste as a fallback unless explicitly authorized. Fix the owning package or route, publish or prepare the update, update affected machines, and record evidence.",
      "7. Minimum adversarial verification is required for non-trivial changes. Use a fresh adversarial reviewer when available; otherwise perform and label an adversarial self-review, then reconcile findings.",
      "8. Secrets safety is mandatory. Never expose credential values. Run the staged secrets scan before every commit and push. Remove any detected credential from the diff before continuing.",
      "9. Commit messages must not include Co-Authored-By trailers.",
      "10. Prefer Bun in Hasna JavaScript and TypeScript repositories. Preserve Bun's release-age quarantine and add exact new Hasna package names to the release-age exclusion registry when applicable.",
    ]),
    owner: { kind: "global", id: "global", name: "Hasna Global Agent Rules" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "non-overridable-safety",
    nonOverridable: true,
    ruleIds: [
      "knowledge:cli-sdk-only",
      "todos:plans-evidence-source-of-truth",
      "state:mementos-conversations-projects-cli",
      "coordination:coordinators-delegate-code",
      "loops:codewith-native-vs-openloops",
      "dispatch:self-heal-no-tmux-fallback",
      "verification:minimum-adversarial",
      "security:secrets-scan-before-commit-push",
      "git:no-coauthoredby",
      "packages:bun-release-age-registry",
    ],
    targetProviders: [...globalAgentInstructionProviders],
    providerCompatibility: globalProviderCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "non-overridable-global-rules",
    },
  },
  {
    id: "hasna-codewith-global-agent-overlay",
    kind: "provider-rules",
    title: "Codewith Global Agent Overlay",
    content: lines([
      "# Codewith Provider Overlay",
      "",
      "Use native Codewith goal plans for substantial multi-phase work and native Codewith goals for coherent single-slice work. Keep short-horizon checklists aligned with the active native goal.",
      "",
      "Use Codewith native /loop and built-in schedule or loop tools when the user asks for Codewith recurring work. OpenLoops is a separate package; do not call native Codewith loops OpenLoops.",
      "",
      "If Codewith dispatch, task routing, or profile support fails, repair the owning package or workflow path. Do not paste prompts into tmux panes unless the human explicitly authorizes the legacy emergency route.",
    ]),
    owner: { kind: "provider", id: "codewith", name: "Codewith" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "safety",
    ruleIds: [
      "provider:codewith:native-goals",
      "provider:codewith:native-loops",
      "provider:codewith:no-tmux-fallback",
    ],
    targetProviders: ["codewith"],
    providerCompatibility: codewithCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "provider-overlay",
      provider: "codewith",
    },
  },
  {
    id: "hasna-claude-global-agent-overlay",
    kind: "provider-rules",
    title: "Claude Code Global Agent Overlay",
    content: lines([
      "# Claude Code Provider Overlay",
      "",
      "Render this source into Claude Code managed instruction blocks such as CLAUDE.md. Preserve repository and user instructions outside the managed block.",
      "",
      "Use Todos CLI tasks and plans as the source of truth for delegated Claude Code work. Do not treat a tmux session or pane as the work queue.",
      "",
      "When Claude Code routing or account selection fails, repair the task workflow, account profile, or owning package and record evidence instead of bypassing the failure with manual prompt paste.",
    ]),
    owner: { kind: "provider", id: "claude", name: "Claude Code" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "safety",
    ruleIds: [
      "provider:claude:managed-block",
      "provider:claude:todos-source",
      "provider:claude:no-manual-paste-fallback",
    ],
    targetProviders: ["claude"],
    providerCompatibility: claudeCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "provider-overlay",
      provider: "claude",
    },
  },
  {
    id: "hasna-codex-global-agent-overlay",
    kind: "provider-rules",
    title: "Codex Global Agent Overlay",
    content: lines([
      "# Codex Provider Overlay",
      "",
      "Render this source into Codex managed instruction blocks such as AGENTS.md. Preserve repository-owned instructions outside the managed block.",
      "",
      "Use the repository's existing test, build, and formatting commands with Bun preference where applicable. Keep evidence in Todos CLI comments and verification records.",
      "",
      "Do not add Co-Authored-By trailers or expose credential values in Codex-generated commits, logs, messages, or docs.",
    ]),
    owner: { kind: "provider", id: "codex", name: "Codex" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "safety",
    ruleIds: [
      "provider:codex:managed-agents",
      "provider:codex:bun-evidence",
      "provider:codex:commit-safety",
    ],
    targetProviders: ["codex"],
    providerCompatibility: codexCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "provider-overlay",
      provider: "codex",
    },
  },
  {
    id: "hasna-opencode-global-agent-overlay",
    kind: "provider-rules",
    title: "OpenCode Global Agent Overlay",
    content: lines([
      "# OpenCode Provider Overlay",
      "",
      "Render this source through the OpenCode provider adapter as managed instruction references in opencode.json, with fragment files owned by the renderer. Preserve user and project OpenCode configuration outside the managed section.",
      "",
      "Use Todos CLI tasks and plans as the source of truth for OpenCode work, evidence, commits, and review state. Do not treat a shell, terminal, or tmux pane as the work queue.",
      "",
      "When OpenCode provider routing, profile selection, or instruction rendering fails, repair the owning CLI, SDK, or workflow path and record evidence instead of bypassing the failure with manual prompt paste.",
    ]),
    owner: { kind: "provider", id: "opencode", name: "OpenCode" },
    sensitivity: "internal",
    mergePolicy: "append",
    safety: "safety",
    ruleIds: [
      "provider:opencode:managed-instruction-references",
      "provider:opencode:todos-source",
      "provider:opencode:no-manual-paste-fallback",
    ],
    targetProviders: ["opencode"],
    providerCompatibility: opencodeCompatibility,
    provenance,
    metadata: {
      ...sourceSetMetadata,
      role: "provider-overlay",
      provider: "opencode",
    },
  },
];

export function listGlobalAgentInstructionSources(
  options: GlobalAgentInstructionSourceOptions = {},
): InstructionSource[] {
  const providers = normalizeProviderFilter(options.providers);
  const selected = providers.size === 0
    ? globalAgentInstructionSourceInputs
    : globalAgentInstructionSourceInputs.filter((source) => matchesProviderFilter(source, providers));
  return normalizeInstructionSources(selected);
}

export function createGlobalAgentInstructionSourceExport(
  options: GlobalAgentInstructionSourceOptions = {},
): InstructionSourceExport {
  const sources = listGlobalAgentInstructionSources(options);
  return createInstructionSourceExport(sources, {
    ...sourceSetMetadata,
    requestedProviders: [...normalizeProviderFilter(options.providers)].sort(),
  });
}

export function createGlobalAgentConfigsInstructionSourceExport(
  options: GlobalAgentInstructionSourceOptions = {},
): ConfigsInstructionSourceExport {
  const sources = listGlobalAgentInstructionSources(options);
  return createConfigsInstructionSourceExport(sources, {
    ...sourceSetMetadata,
    requestedProviders: [...normalizeProviderFilter(options.providers)].sort(),
  });
}

function matchesProviderFilter(source: InstructionSourceInput, providers: Set<string>): boolean {
  if (source.owner?.kind === "global") return true;
  const ownerId = source.owner?.id;
  if (ownerId && providers.has(ownerId)) return true;
  return (source.targetProviders ?? []).some((provider) => providers.has(provider));
}

function normalizeProviderFilter(providers: readonly string[] | undefined): Set<string> {
  return new Set((providers ?? []).map((provider) => provider.trim()).filter(Boolean));
}

function lines(values: string[]): string {
  return values.join("\n");
}
