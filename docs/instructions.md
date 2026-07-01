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

## Export Contract

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
