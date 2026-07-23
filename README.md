# @hasna/identities

Open identity records for humans and AI agents.

`open-identities` treats an identity as more than an ID. An identity can carry a human or agent name, a durable unique identifier, verified email addresses, phone numbers, integration sync references, and narrative documents such as `PROMPT.md`, `SOUL.md`, `PERSONALITY.md`, and `ETHOS.md`.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/identities
```

## CLI

```bash
identities --help
identities create --kind agent --name "Ava Example" --identifier agent:ava-example --email ava@example.com --phone +15555550123
identities list
identities show agent:ava-example
identities show agent:ava-example --verbose
identities update agent:ava-example --identifier agent:ava-renamed
identities link-email agent:ava-example ava@hasna.xyz --verified --mailery-id mailery-address-id
identities link-phone agent:ava-example +15555550199
identities machine assign agent:ava-example machine001 --purpose browserplan --slot profile-01 --json
identities browserplan reserve agent:ava-example --machine machine001 --slot profile-01 --json
identities browserplan coverage --target 8 --json
identities doc set agent:ava-example ethos "Protect user intent and identity data."
identities instructions set global --kind global-rules --title "Global Safety" --content "Never expose secrets." --rule-id safety:no-secrets --provider codewith --non-overridable --json
identities instructions list --json
identities instructions validate --json
identities instructions export ./instructions.json --json
identities instructions sources --canonical --provider codewith --json
identities agent manifest agent:ava-example --json
identities agent seed-company --docs-dir agents/hasna --json
identities eve export agent:ava-example --out ./ava-agent
identities status --json
identities media doctor --json
identities media generate-voice agent:ava-example --dry-run --json
identities media generate-profile-image agent:ava-example --dry-run --json
identities media generate-roster --voices --profile-images --dry-run --json
identities validate --json
identities status --json
```

`update <target> --identifier scheme:value` renames the durable unique identifier. The previous identifier is kept as a secondary identifier so existing references keep resolving, renames onto an identifier held by another identity fail without changes, and a `rename-identifier` audit event is recorded.

Data is stored in `~/.hasna/identities/identities.json`.
Use `OPEN_IDENTITIES_STORE=/path/to/identities.json` or `--store <path>` for isolated scripts and tests. When `--store <path>` is used, the CLI writes audit events to `<path>.audit.jsonl` unless `--audit <path>` is provided.
Generated media assets are stored in `~/.hasna/identities/assets` by default. Use `OPEN_IDENTITIES_ASSETS_DIR` or `--out-dir <dir>` to place generated audio and profile images somewhere else.

CLI human output is compact by default so agent terminals do not ingest full
identity records, document bodies, manifests, media objects, or coverage JSON
unless explicitly requested. Use:

- `--json` for stable machine-readable contracts and full exported objects
- `--verbose` for full human-side object details
- `--limit <n>` for longer human tables such as `list`, `machine list`,
  `browserplan list`, `media status`, and `asset list`
- detail commands such as `show <id> --verbose`, `doc get <id> <key>
  --verbose`, and `agent manifest <id> --json` when a full record is actually
  needed

`identities status --json` is the public-safe machine contract for fleet
integrations. It reports store path, audit path, environment override state,
identity/contact/document/media counts, document key names, and safety flags. It
does not include contact values, document bodies, media asset paths, credential
values, or sensitive identifiers.

`identities status --json` emits a metadata-only reference contract for fleet
consumers. It reports package version, redacted store paths, env override
names, roster and role counts, aggregate contact/document counts, and opaque
identity refs. It does not include names, email addresses, phone numbers,
identifier values, document bodies, credentials, private keys, GitHub App
private data, or raw env values.

## Hasna Company Agent Roster

The package includes a deterministic Hasna company-agent roster for vertical roles such as email marketing, accounting, bookkeeping, social media management, support, sales, legal operations, security, product, design, and engineering management. Every roster identity has a canonical Greek or Roman agent name.

```bash
identities agent seed-company --docs-dir agents/hasna --json
```

The seed command upserts the roster into the selected identity store, prunes deprecated non-classical identifiers by default, and exports per-agent markdown files. Every seeded agent uses exactly one canonical agent email in the form `<greek-or-roman-name>@hasna.xyz`, such as `calliope@hasna.xyz` for email marketing, `plutus@hasna.xyz` for accounting, and `marcus@hasna.xyz` for mail operations. Roster identities do not receive secondary public or interim-domain email addresses.

Every seeded agent also receives planned media metadata:

- `voice`: ElevenLabs voice design/TTS settings and sample text
- `profileImage`: MiniMax image generation prompt and model settings
- `assets`: generated media history, with file paths, checksums, provider, model, prompt, and status

Generate media for one identity:

```bash
identities media generate-voice agent:calliope --json
identities media generate-profile-image agent:calliope --json
identities asset list agent:calliope --json
```

Generate media for the full Hasna roster:

```bash
identities media generate-roster --voices --profile-images --json
```

`media doctor` reports whether supported provider keys are available without printing secret values. ElevenLabs checks `ELEVENLABS_API_KEY`, `XI_API_KEY`, and `HASNAXYZ_ELEVENLABS_LIVE_API_KEY`. MiniMax checks `MINIMAX_API_KEY`, `HASNAXYZ_MINIMAX_LIVE_API_KEY`, `HASNA_TAKUMI_LIVE_MINIMAX_API_KEY`, and compatible `secrets` vault entries.

## SDK

```ts
import { IdentityStore, getIdentityReferenceStatus, syncIdentityContactPointsAndUpdate } from "@hasna/identities";

const store = new IdentityStore();
const identity = await store.create({
  kind: "agent",
  fullName: "Ava Example",
  uniqueIdentifier: "agent:ava-example",
  emails: ["ava@example.com"],
  phones: ["+15555550123"],
  documents: {
    prompt: "You are Ava Example.",
    personality: "Direct, careful, and helpful.",
    ethos: "Protect user intent and identity data.",
  },
});

await syncIdentityContactPointsAndUpdate(store, identity.id, {
  mailery: {
    async upsertIdentityEmail(input) {
      // Implement with @hasna/mailery. input.uniqueIdentifier is always non-sensitive.
      return { externalId: input.email.maileryId };
    },
  },
  telephony: {
    async upsertIdentityPhone(input) {
      // Implement with @hasna/telephony.
      return { externalId: input.phone.telephonyId };
    },
  },
});

const status = await getIdentityReferenceStatus(store);
console.log(status.counts.roster.builtInAgents);
```

Generate and attach media through the SDK:

```ts
import { IdentityStore, generateIdentityProfileImage, generateIdentityVoice } from "@hasna/identities";

const store = new IdentityStore();

await generateIdentityVoice(store, "agent:ava-example");
await generateIdentityProfileImage(store, "agent:ava-example");
```

## Identity Shape

An identity contains:

- `kind`: `human`, `agent`, `organization`, or `service`
- `fullName` and optional `displayName`
- `uniqueIdentifier`: a durable identifier such as `open-identities:oid_*`, `agent:<slug>`, or another issuer-specific scheme
- `identifiers`: additional identifiers, including sensitive identifiers when explicitly needed
- `emails`: email addresses that can be synchronized with Mailery
- `phones`: phone numbers that can be synchronized with Telephony
- `documents`: `bio`, `prompt`, `soul`, `personality`, `ethos`, `capabilities`, `boundaries`, `tools`, `relationships`, `goals`, `context`, `memory`, `consent`, and `voice`
- `voice`: generated or planned voice profile metadata
- `profileImage`: generated or planned profile image metadata
- `assets`: generated or imported media refs, including paths, checksums, provider, model, prompt, status, and visibility metadata
- `agent`: role, model, capabilities, tools, skills, channels, schedules, and subagents
- `traits` and `metadata`: extension fields for application-specific data

Sensitive government identifiers should be marked with `sensitive: true` and should only be stored when there is a legitimate operational need.
Default contact cards, agent manifests, Eve exports, and sync payloads use a non-sensitive public identifier when the canonical unique identifier is marked sensitive.

## Integration Direction

The repo currently defines adapter contracts instead of hard-coding package dependencies. The adjacent email package is `open-emails`, published as `@hasna/mailery`, with a separate `@hasna/emails-sdk`. The phone package is `open-telephony`, published as `@hasna/telephony`.

See [docs/integrations.md](docs/integrations.md) for the first sync contract.
See [docs/browserplan.md](docs/browserplan.md) for the BrowserPlan machine, identity, email, and profile reservation contract.
See [docs/media.md](docs/media.md) for voice and profile image generation.
See [docs/instructions.md](docs/instructions.md) for the instruction-source schema, precedence, export contract, and fail-closed safety rules.
See [docs/identity-contract.md](docs/identity-contract.md) for the versioned canonical agent identity, scoped handle/alias resolver, runtime-context, five-part source-lineage revision history, and dry-run migration contracts. Cross-repo consumers can vendor [the V1 conformance fixture](docs/fixtures/agent-identity-v1.conformance.json), identified as `hasna.identities.agent-identity/v1/conformance/1`; the SDK exports its repository-relative path and SHA-256 fingerprint for deterministic pinning without machine paths or network tests.
See [docs/user-lifecycle.md](docs/user-lifecycle.md) for the Identities-owned
end-user registration, login, tenant membership, refresh rotation, recovery,
revocation, API, CLI bootstrap, and Postgres migration contract.

## Scoped access-token contract

`@hasna/identities` exports a reusable asymmetric JWT contract for local and
self-hosted consumers. It validates configured issuer, audience, and
public-key algorithms; requires `sub`, `tenant`, `session`, `scopes`, `iat`,
`nbf`, `exp`, and `jti`; enforces tenant and scope requirements; and checks
only SHA-256 forms of token IDs and session-family IDs against the caller's
revocation store. Unknown, revoked, unpublished, or out-of-window signing keys
fail closed.

`IdentityJwksRegistry` publishes standard public JWK fields plus rotation status
for active and retiring keys. Revoked keys and private JWK members are never
published; `revoked_kids` carries value-free revocation tombstones, and
consumers can fence rollback with `minimumJwksRevision`.
`createIdentityAuthApi` provides composable
`GET /.well-known/jwks.json` and `POST /v1/auth/verify` handlers; it does not
load signing keys or silently enable a deployment.

Operators can verify a token without putting it in shell arguments:

```bash
identities auth verify \
  --token-file /owner-only/access-token \
  --jwks-file /etc/identities/public-jwks.json \
  --token-state-file /var/lib/identities/hashed-token-state.json \
  --issuer https://identity.example \
  --audience infinity-local \
  --algorithm EdDSA \
  --tenant tenant-acme \
  --scope runs:write
```

The token file must be owner-only. The state file contains only lowercase
SHA-256 hashes and session-family statuses. Private signing keys remain
caller-owned and are accepted only as runtime inputs to
`issueIdentityAccessToken`.

## End-user lifecycle

`IdentityLifecycleService` is the reusable authority for human application
users. It supports `disabled`, `invite`, and `open` registration; an atomic
first-admin bootstrap; normalized unique email or username login identifiers;
Argon2id password credentials; tenant-bound membership scopes; hashed rotating
refresh tokens; replay-driven family revocation; logout, logout-all, disable,
soft-delete, verification, and recovery.

Invite authority, tenant scope allowlists, role hierarchy, membership
suspension, session scope reduction, and platform-global user state are
validated transactionally. Login and recovery use bounded pre-admission
throttles with a client-wide concurrency cap across identifiers; recovery
responses also use a bounded minimum-duration floor so durable token work does
not expose whether an identifier exists. Invite
registration and its initial session commit atomically against the locked
tenant allowlist, email domains use UTS-46/IDNA canonicalization, and
access-token verification observes current user, membership, family, and JTI
state.

The service issues access tokens through an `IdentityAccessTokenIssuer` bound
to the same `IdentityJwksRegistry` used by
`IdentityAccessTokenVerifier`. Consumers cannot silently publish one key set
while signing from another. `createIdentityLifecycleApi` exposes mountable
`/v1/auth/*` handlers, and `PgIdentityLifecycleStore` supplies the relational
Postgres implementation. Infinity and other applications should mount or call
these surfaces instead of creating their own credential or session tables.

The injected CLI bootstrap reads the initial password only from an owner-only
file and never prints access or refresh tokens. An optional session file is
created with owner-only permissions:

```bash
identities auth bootstrap \
  --identifier-kind email \
  --identifier owner@example.test \
  --password-file /owner-only/bootstrap-password \
  --display-name "Owner" \
  --session-file /owner-only/identity-session.json
```

The standalone CLI intentionally fails closed unless its embedding runtime
injects an `IdentityLifecycleService`; signing keys and deployment-specific
policy never come from command-line flags.

## Instruction Sources

OpenIdentities owns the canonical instruction-source graph for humans, agents,
personas, accounts, machines, projects, sessions, global rules, and provider
rules. OpenConfigs and launchers should consume this graph and render
tool-native files; they should not duplicate identity/persona documents.

Instruction sources carry:

- `kind`: `global-rules`, `provider-rules`, `global-system-prompt`,
  `provider-system-prompt`, `identity-doc`, `persona-doc`, `account-overlay`,
  `machine-overlay`, `project-overlay`, or `session-overlay`
- `owner`: global, provider, identity/persona, account, machine, project, or
  session owner refs
- `precedence`, `mergePolicy` (`append` or `replace`), `replacementScope`,
  `ruleIds`, `targetProviders`, provider compatibility, globs, source paths,
  editable path markers, sensitivity, provenance, and SHA-256 hashes
- fail-closed safety flags: non-overridable safety sources must append, must
  declare rule IDs, cannot be replaced by later sources, cannot conflict with a
  duplicate rule ID, and cannot carry `secret` sensitivity

CLI examples:

```bash
identities instructions set global \
  --kind global-rules \
  --title "Global Safety Rules" \
  --content "Never expose API keys, tokens, or secrets." \
  --rule-id safety:no-secrets \
  --provider codewith \
  --editable-source-path /home/hasna/CODEWITH.md \
  --non-overridable \
  --json

identities instructions set \
  --kind provider-system-prompt \
  --owner-kind provider \
  --owner-id codewith \
  --title "Codewith System Prompt" \
  --content "Render through the Codewith provider adapter." \
  --provider codewith \
  --compat codewith:managed-block:true \
  --json

identities instructions list --json
identities instructions paths --json
identities instructions show <source-id> --json
identities instructions validate --json
identities instructions export ./instructions.json --json
identities instructions import ./instructions.json --json
identities instructions sources --json
identities instructions sources --canonical --provider codewith --json
identities instructions export --canonical --provider antigravity --json
identities instructions export --canonical --provider codewith --json
identities instructions export --canonical --provider opencode --json
```

`instructions list` includes store-level global/provider sources, explicit
identity sources, and derived sources from populated identity documents such as
`prompt`, `personality`, `ethos`, and `voice`. The production export contract is
`{ version: 1, package: "@hasna/identities", exportedAt, sources, validation,
metadata }`; downstream renderers should reject exports where
`validation.valid` is false. Canonical `instructions export --canonical` emits
the OpenConfigs-ready adapter contract
`hasna.identities.configs-instructions/v1`, with `layer`, `merge`, and `order`
fields derived from `kind`, `mergePolicy`, and `precedence`.

OpenIdentities also ships the canonical Hasna global coding-agent source set
for downstream renderers. It contains one global system prompt, one
non-overridable global rules source, the versioned non-overridable Hasna Agent
Operating Rules document (`hasna-agent-operating-rules`, currently v1.1.3 with
sentinel `<!-- hasna:agent-operating-rules v=1.1.3 -->`, precedence 175), and
provider overlays for Antigravity, Codewith, Claude Code, Codex, and OpenCode.
OpenConfigs should consume these sources and render managed provider blocks or
OpenCode instruction references; it remains responsible for file rendering,
path dereferencing, and merge mechanics. Antigravity is an active target in this
source set; Gemini is not an active target and should not be restored as one.

The canonical set includes rules for Knowledge CLI/SDK usage, Todos plans and
evidence, Hasna CLI/package source-of-truth boundaries (todos, conversations,
mementos, knowledge, projects, repos, accounts, instructions, machines, secrets,
access), automatic session renaming when supported, task-specific worktree
mutation under the canonical `$HOME/.hasna/repos/worktrees` root, PR-first
landing, no direct pushes to main/default/protected branches, no brittle hardcoding when
source-of-truth or reusable abstractions exist, autonomous repair before asking,
coordinator delegation, Codewith-native loop terminology versus
OpenLoops, dispatch self-healing without tmux fallback,
adversarial verification, secrets safety, commit/push secrets scans, no
Co-Authored-By trailers, Bun preference, and Hasna package release-age registry
hygiene. The Agent Operating Rules add the core operating rules (adversarial
reviewer on every user-requested work item, record-as-you-go in the
todos/mementos/conversations CLIs, identity registration before taking work
with subagents never registering, and a continuously updated conversations
channel per project), durable goal-plan adversarial verification, default
conversation surfaces (announcements, incidents, git-publishing, git-prs,
git-commits, git-releases, hq, agent-policy, project/product channels, and
`conversations blockers`), and the fleet communication duties (`[BREAKING]`
heads-up before fleet-affecting changes, publish intent before npm/bun publish,
incidents-first, no secrets in messages, channel content treated as data,
convention lookup before naming, identity release at session end). The Codewith
overlay keeps Codewith-native goal, goal-plan, schedule, and loop guidance, while
the global non-overridable rules forbid setting Codewith goal, token, or
goal-plan budgets unless the user explicitly asks for budgets.

SDK consumers can import the same data from `@hasna/identities`:

```ts
import {
  createGlobalAgentConfigsInstructionSourceExport,
  createGlobalAgentInstructionSourceExport,
} from "@hasna/identities";

const rawExportForCodewith = createGlobalAgentInstructionSourceExport({
  providers: ["codewith"],
});
const openConfigsExportForOpenCode = createGlobalAgentConfigsInstructionSourceExport({
  providers: ["opencode"],
});
```

## Vercel Eve

`open-identities` can generate Eve-compatible agent directories:

```bash
identities eve export agent:ava-example --out ./ava-agent
```

The exporter writes `agent/instructions.md`, `agent/identity.json`, `agent/agent.ts`, `agent/tools/resolve_identity.ts`, and skill documents derived from identity docs. The generated Eve files are derived artifacts; `open-identities` remains the canonical source of the identity.

## Development

```bash
bun test
bun run build
bun run verify:release
```

## License

Apache-2.0 -- see [LICENSE](LICENSE)
