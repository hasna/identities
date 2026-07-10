# Instruction Source Contract

OpenIdentities is the canonical owner for identity and instruction sources.
Downstream packages such as OpenConfigs consume this contract and render
provider-specific files, managed blocks, imports, or manifests.

## Source Kinds And Precedence

Precedence is ascending; later overlays may append or replace earlier material
unless a protected safety rule blocks replacement.

| Kind | Precedence | Owner |
| --- | ---: | --- |
| `global-rules` | 100 | `global` |
| `global-system-prompt` | 150 | `global` |
| `provider-rules` | 200 | `provider` |
| `provider-system-prompt` | 250 | `provider` |
| `identity-doc` | 300 | `identity` |
| `persona-doc` | 350 | `persona` |
| `account-overlay` | 500 | `account` |
| `machine-overlay` | 600 | `machine` |
| `project-overlay` | 700 | `project` |
| `session-overlay` | 800 | `session` |

## Required Fields

Every source has an `id`, `kind`, `title`, `owner`, `sensitivity`,
`precedence`, `mergePolicy`, `safety`, `nonOverridable`, `ruleIds`,
`targetProviders`, `providerCompatibility`, `sourcePaths`, `globs`, `hash`,
`provenance`, and `metadata`.

Inline `content` is optional only when at least one `sourcePaths` entry exists.
Source paths can be marked `editable` so tools can route edits to the canonical
file instead of mutating derived provider output.

## Safety Rules

Non-overridable safety sources fail closed:

- `mergePolicy` must be `append`
- at least one `ruleId` is required
- `sensitivity` cannot be `secret`
- duplicate protected `ruleId` values with different hashes are invalid
- later `replace` sources cannot intersect the protected rule IDs or
  replacement scope

`identities instructions validate --json` returns an
`InstructionSourceValidationResult`. Consumers must reject exports with
`valid: false`.

## Raw Export Contract

```json
{
  "version": 1,
  "package": "@hasna/identities",
  "exportedAt": "2026-07-01T00:00:00.000Z",
  "sources": [],
  "validation": {
    "valid": true,
    "sourceCount": 0,
    "issues": [],
    "effectiveHash": "sha256:...",
    "nonOverridableSafetyRules": []
  },
  "metadata": {}
}
```

Renderers should use `hash` and `effectiveHash` for manifests and should keep
provider artifacts derived. The editable source path, owner ref, and provenance
point back to OpenIdentities as the source of truth.

## OpenConfigs Export Contract

OpenConfigs consumes the adapter contract emitted by canonical exports:

```json
{
  "contract": "hasna.identities.configs-instructions/v1",
  "version": 1,
  "package": "@hasna/identities",
  "exportedAt": "2026-07-01T00:00:00.000Z",
  "sources": [
    {
      "id": "hasna-codewith-global-agent-overlay",
      "label": "Codewith Global Agent Overlay",
      "layer": "tool",
      "merge": "append",
      "order": 200,
      "content": "# Codewith Provider Overlay\n...",
      "targetProviders": ["codewith"],
      "rules": []
    }
  ],
  "validation": {
    "valid": true,
    "sourceCount": 1,
    "issues": [],
    "effectiveHash": "sha256:...",
    "nonOverridableSafetyRules": []
  },
  "metadata": {}
}
```

The compatibility mapping is deterministic:

- `global-rules` and `global-system-prompt` map to `layer: "global"`.
- `provider-rules` and `provider-system-prompt` map to `layer: "tool"`.
- identity and persona documents map to `layer: "agent"`.
- account, project, machine, and session overlays map to their closest
  OpenConfigs layer: `account`, `project`, or `local`.
- `merge` copies `mergePolicy`; `order` copies `precedence`.

The adapter preserves `sourcePaths`, `globs`, hashes, provenance, owner refs,
metadata, and provider compatibility metadata. Source-path-only and
rule-path-only entries remain valid OpenIdentities sources; renderers that do
not yet dereference paths may emit empty inline content while preserving the
path metadata for their own follow-up resolution.

## Canonical Global Agent Rules

OpenIdentities publishes the Hasna global coding-agent instruction source set
as built-in data. It is intentionally not a renderer. OpenConfigs and other
consumers should retrieve the source graph, validate it, and render derived
provider files or managed blocks in their own layer.

```bash
identities instructions sources --canonical --json
identities instructions sources --canonical --provider codewith --json
identities instructions export --canonical --provider antigravity --json
identities instructions export --canonical --provider claude --json
identities instructions export --canonical --provider opencode --json
```

The canonical set includes:

- `hasna-global-coding-agent-system-prompt`
- `hasna-global-coding-agent-non-overridable-rules`
- `hasna-agent-operating-rules`
- `hasna-antigravity-global-agent-overlay`
- `hasna-codewith-global-agent-overlay`
- `hasna-claude-global-agent-overlay`
- `hasna-codex-global-agent-overlay`
- `hasna-opencode-global-agent-overlay`

Provider filtering keeps the global prompt and global rules, then includes only
matching provider overlays. For example, `--provider codewith` returns the three
global sources and the Codewith overlay.

`hasna-agent-operating-rules` is the versioned Hasna Agent Operating Rules
document (currently v1.1.3, stamped on line 1 and carrying the sentinel comment
`<!-- hasna:agent-operating-rules v=1.1.3 -->` so renderers and drift checks can
verify currency). It leads with the core operating rules — an independent
adversarial reviewer on every user-requested piece of work, record-as-you-go in
the todos/mementos/conversations CLIs, agent-identity registration before
taking work (subagents never register), a continuously updated conversations
channel per project, automatic session renaming when supported, Hasna
CLI/package source-of-truth boundaries, and autonomous repair before asking —
then code/landing rules and fleet communication duties. It is non-overridable
and renders at precedence 175, between the global system prompt (150) and the
provider overlays (200).

Required rule coverage is part of the source content:

- Knowledge must use the Knowledge CLI or SDK, never ad hoc global Markdown
  under `$HOME/.hasna`, `$HOME/.husna`, or similar scratch paths.
- Hasna CLIs/packages are source of truth for todos, conversations, mementos,
  knowledge, projects, repos, accounts, instructions, machines, secrets, and
  access.
- Planning and evidence must use Todos CLI tasks and todos plans.
- Agents should automatically rename sessions when the runtime supports it.
- Repo mutation must happen in task-specific worktrees under the canonical
  `$HOME/.hasna/repos/worktrees` root; prefer Hasna repo/project worktree
  mechanisms, otherwise `git worktree` rooted there, and never mutate shared
  checkouts.
- Normal changes use PR-first landing through a branch/worktree plus a pull
  request or prepared pull-request handoff.
- Agents must not push directly to `main`, default, or protected branches unless
  the user explicitly instructs that exact repo and operation.
- Agents must not hardcode brittle values, paths, provider names, config,
  business logic, environment-specific IDs, or one-off mappings when a
  source-of-truth, schema/config-driven, package-owned, reusable, or cleaner
  abstraction exists. This is especially strict in medium and large
  applications; explicit constants, fixtures, tests, and temporary
  compatibility shims are allowed only when scoped, named, and justified.
- Agents act autonomously by diagnosing and repairing owning CLIs, packages,
  and workflows before asking the user; ask only for destructive,
  secret-bearing, or user-only decisions.
- Coordinator sessions delegate product-code implementation through subagents
  or task workflows.
- Codewith-native loops and OpenLoops are different mechanisms and terms.
- Dispatch failures require self-healing of the owning package or workflow; no
  tmux prompt-paste fallback is allowed without explicit human authorization.
- Non-trivial work needs adversarial verification or a labeled adversarial
  self-review when no reviewer can be spawned.
- Durable goal plans require adversarial verification steps during the plan and
  a final adversarial verification step before completion.
- Default conversation surfaces are announcements, incidents, git-publishing,
  git-prs, git-commits, git-releases, hq, agent-policy, project/product
  channels, and `conversations blockers` (not a literal blockers channel).
- Codewith goal, token, and goal-plan budgets must not be set unless the user
  explicitly asks for budgets.
- Antigravity is an active provider target; Gemini must not be created or
  restored as an active global instruction provider target.
- Secrets must not be exposed, commit/push secrets scans are mandatory, and
  commits must not use Co-Authored-By trailers.
- Bun is preferred for Hasna JavaScript and TypeScript repositories, with
  package release-age registry hygiene when new supervised Hasna packages are
  created or published.

SDK consumers can use:

```ts
import {
  createGlobalAgentConfigsInstructionSourceExport,
  createGlobalAgentInstructionSourceExport,
  listGlobalAgentInstructionSources,
} from "@hasna/identities";

const sources = listGlobalAgentInstructionSources({ providers: ["codewith"] });
const rawExportPayload = createGlobalAgentInstructionSourceExport({ providers: ["codewith"] });
const openConfigsExportPayload = createGlobalAgentConfigsInstructionSourceExport({ providers: ["opencode"] });
```
