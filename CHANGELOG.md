# Changelog

## 0.3.5 - 2026-07-20

- operating rules v1.1.5 — eliminate phantom-freeze stop/defer; keep prompt-injection firewall.

## 0.3.4 - 2026-07-10

- Promote `hasna-agent-operating-rules` to v1.1.3 and source-set version `2026-07-10` with the mandatory no-brittle-hardcoding rule.
- Require source-of-truth, schema/config-driven, package-owned, reusable, or cleaner abstractions over hardcoded values, paths, provider names, config, business logic, environment-specific IDs, and one-off mappings, with scoped exceptions for constants, fixtures, tests, and temporary compatibility shims.

## 0.3.3 - 2026-07-09

- Promote managed global agent operating rules v1.1.2 with Antigravity provider rendering and Gemini retired from active providers.
- Add non-overridable worktree, PR-first, no-main-push, autonomous repair, conversations surfaces, and no-budget-unless-requested rules.


## Unreleased

- Added the authoritative Identities-owned end-user lifecycle: relational
  users, tenants, memberships, normalized login identifiers, Argon2id
  credentials, invite/verification/recovery state, hashed rotating refresh
  tokens, session-family and JTI revocation, registration policy and atomic
  first-admin bootstrap, timing-safe throttled login, mountable HTTP schemas
  and generated SDK operations, a guarded CLI bootstrap, and reversible
  checksum-guarded Postgres migrations.
- Hardened lifecycle authority with transactional invite role/scope/tenant
  checks, current membership scope intersection, tenant-only suspension versus
  platform-global state, atomic family/JTI revocation, bounded concurrent
  throttle admission, prewarmed enumeration-safe asynchronous recovery, and
  UTS-46 email-domain canonicalization with migration collision audits.
- Added reusable scoped JWT verification and issuance, public JWKS rotation
  status, hashed token/session-family revocation checks, and composable auth
  API and CLI surfaces for local and self-hosted consumers.
- Added the versioned canonical agent identity V1 contract with immutable `identity_id` authority, tenant/namespace-scoped handles and additive aliases, one typed `IDENTITY_ALIAS_AMBIGUOUS` fail-closed boundary, exact five-part source lineage, append-only source-mapping revisions (`create`, `unchanged`, `promote`, `correct`, `retire`), quarantined similarity candidates, structured `runtime_instance_id` context with external Runtime Coordination lease/fence ownership, a read-only Machines+Projects assignment projection, lifecycle-aware zero-write migration reports, canonical/canary/rollback read preferences, and a pinned machine-independent conformance fixture.
- Bumped `hasna-agent-operating-rules` to v1.1.2 (2026-07-09) and expanded the canonical source set with rules for automatic session renaming, task-specific worktree mutation under `$HOME/.hasna/repos/worktrees`, PR-first landing, no direct pushes to main/default/protected branches, autonomous repair before asking, full Hasna CLI/package source-of-truth coverage, default conversation surfaces plus `conversations blockers`, durable goal-plan adversarial verification, and Codewith goal/token/goal-plan budget opt-in only.
- Added Antigravity as an active global instruction provider target and provider overlay, while keeping Gemini out of active target/provider compatibility coverage.

## 0.2.1

- Added the versioned `hasna-agent-operating-rules` canonical source: Hasna Agent Operating Rules v1.1.0 (version stamp on line 1, sentinel `<!-- hasna:agent-operating-rules v=1.1.0 -->`), leading with Andrei's four core operating rules (independent adversarial reviewer on every user-requested work item; record-as-you-go in todos/mementos/conversations CLIs; register an agent identity before taking work, subagents never; every project has a continuously updated conversations channel) followed by the fleet communication duties from the fleet comms strategy (todos task 39a68145).
- Rendered the new source non-overridable at precedence/order 175, between the global system prompt (150) and provider overlays (200), and bumped the canonical source-set version to `2026-07-06`.
- Exported `agentOperatingRulesVersion` and `agentOperatingRulesSentinel` from the SDK.

## 0.2.0

- Added the `identities-serve` HTTP API: `GET /health`, `/ready`, `/version`, `/openapi.json`, and an API-key-authenticated versioned `/v1` surface for identity CRUD (list, get, create, update, delete), email/phone linking, and contact cards.
- Added the `identities-mcp` MCP server exposing identity CRUD and link tools over stdio.
- Added a generated, dependency-free SDK client (`@hasna/identities/sdk`) produced from the serve OpenAPI document, with an `IDENTITIES_API_URL` + `IDENTITIES_API_KEY` self_hosted factory.
- Added a cloud (Postgres) storage mode (PURE REMOTE per Amendment A1) via the vendored `@hasna/contracts` storage kit, a pluggable `StorageBackend` with optimistic-concurrency tokens, and checksum-guarded migrations with an `identities-serve migrate` runner.
- Added API-key authentication (`@hasna/contracts/auth`), an ARM64/Bun `Dockerfile`, `docker-compose.yml`, and a `hasna.contract.json` service manifest.

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
