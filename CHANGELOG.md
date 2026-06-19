# Changelog

## 0.1.3

- Added first-class `voice`, `profileImage`, and generated `assets` metadata to identities.
- Added ElevenLabs voice design/TTS and MiniMax profile image generation through the CLI and SDK.
- Added roster-wide media generation and dry-run support for all Hasna company agents.
- Exported voice guidance and media references into Eve manifests.
- Published root `VOICE.md` and added media provider docs.

## 0.1.2

- Renamed every seeded Hasna company agent to a Greek or Roman canonical agent name.
- Changed canonical internal emails to `<classical-agent-name>@hasna.xyz`.
- Added cleanup for previous non-classical and role-based agent identifiers during roster seeding.
- Regenerated the committed roster markdown under the new classical-name directories.

## 0.1.1

- Added the Hasna company-agent roster and `identities agent seed-company`.
- Standardized seeded agent internal emails to `<agent-name>@hasna.xyz`.
- Replaced the deprecated Hermes identity with Nova for CLI/SDK ownership.
- Added per-agent markdown document export for seeded roster identities.
- Exported the roster SDK entrypoint as `@hasna/identities/roster`.

## 0.1.0

- Initial open identity model for humans, agents, organizations, and services.
- Added local JSON storage and a small `identities` CLI.
- Added Mailery and Telephony adapter contracts for contact-point sync.
- Added identity document templates for prompt, soul, personality, ethos, memory, consent, and voice.
- Added JSON CLI contracts, isolated store support, document commands, agent manifests, Eve export, private file permissions, audit events, duplicate prevention, persisted sync refs, and release verification.
