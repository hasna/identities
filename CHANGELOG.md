# Changelog

## 0.1.8

- Added durable identifier renaming: `identities update <target> --identifier scheme:value` changes the unique identifier while keeping the previous identifier as a secondary alias, so old references keep resolving.
- Renaming onto an identifier already held by another identity now fails with a clear `Identifier already in use by another identity` error and leaves the record unchanged.
- Identifier renames emit a `rename-identifier` audit event recording the old and new identifiers.
- Documented `--identifier` in the `update` usage/help text and README.

## 0.1.7

- Fixed `identities update <target> --name` appearing to be a silent no-op when the identity has a display name: the human `update`/`show` summaries now include `name` (fullName) and `displayName` rows, so renames are always visible.
- Added a hint after `update --name` when a differing display name still masks the presented name, pointing to `--display-name`.
- Added regression tests proving update-by-identifier-alias (`agent:<name>`) and update-by-oid both persist across store reloads.

## 0.1.6

- Published release (version bump only; no committed source changes).

## 0.1.5

- Added the canonical Hasna global coding-agent system prompt, non-overridable rules, and provider overlays for Codewith, Claude Code, Codex, and OpenCode.
- Exposed canonical global agent instruction sources through the SDK and `identities instructions sources/export --canonical`.
- Added the `hasna.identities.configs-instructions/v1` canonical export adapter for OpenConfigs, including `layer`, `merge`, and `order` compatibility fields.

## 0.1.4

- Added canonical instruction sources, instruction CLI commands, validation, import/export, and fail-closed safety checks.

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
