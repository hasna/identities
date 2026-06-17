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
identities create --kind agent --name "Ava Example" --identifier agent:ava-example --email ava@example.com --phone +15555550123
identities list
identities show agent:ava-example
identities link-email agent:ava-example ava@hasna.com
identities link-phone agent:ava-example +15555550199
identities doc set agent:ava-example ethos "Protect user intent and identity data."
identities agent manifest agent:ava-example --json
identities eve export agent:ava-example --out ./ava-agent
identities validate --json
```

Data is stored in `~/.hasna/identities/identities.json`.
Use `OPEN_IDENTITIES_STORE=/path/to/identities.json` or `--store <path>` for isolated scripts and tests.

## SDK

```ts
import { IdentityStore, syncIdentityContactPointsAndUpdate } from "@hasna/identities";

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
- `agent`: role, model, capabilities, tools, skills, channels, schedules, and subagents
- `traits` and `metadata`: extension fields for application-specific data

Sensitive government identifiers should be marked with `sensitive: true` and should only be stored when there is a legitimate operational need.
Default contact cards, agent manifests, Eve exports, and sync payloads use a non-sensitive public identifier when the canonical unique identifier is marked sensitive.

## Integration Direction

The repo currently defines adapter contracts instead of hard-coding package dependencies. The adjacent email package is `open-emails`, published as `@hasna/mailery`, with a separate `@hasna/emails-sdk`. The phone package is `open-telephony`, published as `@hasna/telephony`.

See [docs/integrations.md](docs/integrations.md) for the first sync contract.

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
