# Identities End-User Lifecycle

`@hasna/identities` owns the reusable end-user authentication lifecycle. An
application such as Infinity consumes this contract; it does not create a
parallel user, password, tenant, refresh-token, or revocation store.

The contract version is `hasna.identity-user-lifecycle/v1`.

## Authority boundaries

- `IdentityLifecycleService` owns registration, login, recovery, verification,
  session rotation, logout, disable, and soft-delete state transitions.
- `PgIdentityLifecycleStore` is the production relational repository.
  `InMemoryIdentityLifecycleStore` exists for deterministic tests and embedded
  development only.
- `IdentityAccessTokenIssuer` signs through one active key in the same
  `IdentityJwksRegistry` used by `IdentityAccessTokenVerifier`. Private key
  loading remains the embedding runtime's responsibility.
- Tenant IDs and membership scopes are persisted authority. Client-requested
  tenant IDs or scopes never create membership or expand grants.
- Raw passwords, invite tokens, verification tokens, recovery tokens, refresh
  tokens, JTIs, and session IDs are not persisted in token-state tables.
  Passwords use Argon2id; opaque tokens, JTIs, and session references are
  stored as SHA-256 hashes.

## Registration policy

The embedding runtime selects exactly one policy:

- `disabled`: public signup is unavailable.
- `invite`: signup requires an unexpired, unused, hashed invite whose optional
  normalized identifier matches.
- `open`: public signup is allowed. The first user atomically receives the
  configured bootstrap tenant's owner membership; later users receive isolated
  personal tenants unless they use an invite policy in another deployment.

`bootstrapFirstAdmin` uses a serialized transaction and succeeds only while no
user exists. Concurrent attempts produce one administrator and one
`bootstrap_complete` result. Login-identifier uniqueness is enforced by both
normalization and a database unique constraint.

Email and username identifiers are trimmed, NFKC-normalized, and lowercased.
Email has a bounded structural check. Usernames accept 3–64 lowercase
alphanumeric, dot, underscore, or hyphen characters.

## Credentials and login

`Argon2idIdentityPasswordHasher` defaults to 64 MiB and three iterations and
enforces a 12–1024 character password boundary. Deployments may raise those
parameters, but cannot configure less than 32 MiB or two iterations.

Unknown users, incorrect passwords, disabled users, deleted users, and tenant
mismatches return the same authentication failure. Unknown users still verify
against a cached Argon2id dummy hash. Throttle keys hash the normalized
identifier and the embedding runtime's client key; failures and lock expiry are
updated atomically.

Login selects one persisted membership. Requested scopes must be a non-empty
subset of that membership's scopes. Tokens bind `sub`, `tenant`, `session`,
`scopes`, `iat`, `nbf`, `exp`, and `jti`.

## Refresh rotation and revocation

Refresh tokens are 256-bit random values stored only by hash. Every successful
refresh consumes the current row and creates a new generation in the same
session family. Reuse of a consumed or revoked token is treated as compromise:
the family and all its refresh generations are revoked in one transaction.

Access-token verification checks the hashed JTI and hashed session-family
reference on every request. Logout records the current JTI and revokes the
family. Logout-all, password recovery, account disable, and soft-delete revoke
all of that user's active families. Administrative disable/delete requires an
owner or administrator membership in the same tenant as the target.

## Verification and recovery

Verification and recovery tokens are one-time, hashed, expiring records.
Delivery occurs only through caller-supplied hooks. Unknown recovery requests
return the same accepted response without calling the delivery hook.
Successful recovery replaces the password hash and revokes all sessions.

Restore is a trusted recovery/administrative library hook and is not exposed by
the public lifecycle HTTP handler. Existing sessions remain revoked after a
restore.

## HTTP and SDK

`createIdentityLifecycleApi` provides:

- `POST /v1/auth/signup`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `POST /v1/auth/logout-all`
- `POST /v1/auth/verification/complete`
- `POST /v1/auth/recovery/start`
- `POST /v1/auth/recovery/complete`

Responses set `Cache-Control: no-store` and never echo passwords. Login and
refresh errors use bounded public reason codes. The serve runtime accepts an
optional lifecycle handler and otherwise returns a fail-closed 503 for these
routes. The OpenAPI document and generated `@hasna/identities/sdk` client
include the same schemas and operations.

## Postgres migrations

Lifecycle migrations are `identities_0004` through `identities_0008`:

1. users, tenants, memberships;
2. normalized login identifiers, Argon2id credentials, invites;
3. session families, hashed refresh tokens, hashed JTI revocations;
4. verification and recovery tokens;
5. login throttle state.

They use the existing checksum ledger, are safe to reapply, and reject checksum
drift. `rollbackIdentityLifecycleMigrations` is an explicit destructive
operator surface requiring `allowDestructive: true`; it removes only lifecycle
migrations in reverse dependency order and clears only their ledger rows.
