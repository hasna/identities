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
identities instructions export --canonical --provider codewith --json
```

`instructions list` includes store-level global/provider sources, explicit
identity sources, and derived sources from populated identity documents such as
`prompt`, `personality`, `ethos`, and `voice`. The production export contract is
`{ version: 1, package: "@hasna/identities", exportedAt, sources, validation,
metadata }`; downstream renderers should reject exports where
`validation.valid` is false.

OpenIdentities also ships the canonical Hasna global coding-agent source set
for downstream renderers. It contains one global system prompt, one
non-overridable global rules source, and provider overlays for Codewith, Claude
Code, and Codex. OpenConfigs should consume these sources and render managed
provider blocks; it remains responsible for file rendering and merge mechanics.

The canonical set includes rules for Knowledge CLI/SDK usage, Todos plans and
evidence, Mementos/Conversations/Projects source-of-truth boundaries,
coordinator delegation, Codewith-native loop terminology versus OpenLoops,
dispatch self-healing without tmux fallback, adversarial verification, secrets
safety, commit/push secrets scans, no Co-Authored-By trailers, Bun preference,
and Hasna package release-age registry hygiene.

SDK consumers can import the same data from `@hasna/identities`:

```ts
import { createGlobalAgentInstructionSourceExport } from "@hasna/identities";

const exportForCodewith = createGlobalAgentInstructionSourceExport({
  providers: ["codewith"],
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
