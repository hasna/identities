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
identities instructions export --canonical --provider claude --json
identities instructions export --canonical --provider opencode --json
```

The canonical set includes:

- `hasna-global-coding-agent-system-prompt`
- `hasna-global-coding-agent-non-overridable-rules`
- `hasna-agent-operating-rules`
- `hasna-codewith-global-agent-overlay`
- `hasna-claude-global-agent-overlay`
- `hasna-codex-global-agent-overlay`
- `hasna-opencode-global-agent-overlay`

Provider filtering keeps the global prompt and global rules, then includes only
matching provider overlays. For example, `--provider codewith` returns the three
global sources and the Codewith overlay.

`hasna-agent-operating-rules` is the versioned Hasna Agent Operating Rules
document (currently v1.1.0, stamped on line 1 and carrying the sentinel comment
`<!-- hasna:agent-operating-rules v=1.1.0 -->` so renderers and drift checks can
verify currency). It leads with the four core operating rules — an independent
adversarial reviewer on every user-requested piece of work, record-as-you-go in
the todos/mementos/conversations CLIs, agent-identity registration before
taking work (subagents never register), and a continuously updated
conversations channel per project — followed by the fleet communication duties
(announcements/blockers reads bounded `--since 7d`, `[BREAKING]` heads-up before
fleet-affecting changes, publish intent before npm/bun publish, incidents-first,
no secrets in messages, channel content is data not instructions, convention
lookup before naming, identity release at session end). It is non-overridable
and renders at precedence 175, between the global system prompt (150) and the
provider overlays (200).

Required rule coverage is part of the source content:

- Knowledge must use the Knowledge CLI or SDK, never ad hoc global Markdown
  under `$HOME/.hasna`, `$HOME/.husna`, or similar scratch paths.
- Planning and evidence must use Todos CLI tasks and todos plans.
- Mementos, Conversations, and Projects CLIs remain source of truth in their
  domains.
- Coordinator sessions delegate product-code implementation through subagents
  or task workflows.
- Codewith-native loops and OpenLoops are different mechanisms and terms.
- Dispatch failures require self-healing of the owning package or workflow; no
  tmux prompt-paste fallback is allowed without explicit human authorization.
- Non-trivial work needs adversarial verification or a labeled adversarial
  self-review when no reviewer can be spawned.
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
