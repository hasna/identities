import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "./generated/storage-kit/query.js";
import { hashOpaqueClaim, type IdentitySessionFamilyStatus } from "./identity-auth.js";
import {
  IDENTITY_INVITES_TABLE,
  IDENTITY_ISSUED_ACCESS_TOKENS_TABLE,
  IDENTITY_JTI_REVOCATIONS_TABLE,
  IDENTITY_LOGIN_IDENTIFIER_AUDIT_TABLE,
  IDENTITY_LOGIN_IDENTIFIERS_TABLE,
  IDENTITY_LOGIN_THROTTLE_TABLE,
  IDENTITY_MEMBERSHIPS_TABLE,
  IDENTITY_ONE_TIME_TOKENS_TABLE,
  IDENTITY_PASSWORD_CREDENTIALS_TABLE,
  IDENTITY_REFRESH_TOKENS_TABLE,
  IDENTITY_SESSION_FAMILIES_TABLE,
  IDENTITY_TENANTS_TABLE,
  IDENTITY_USERS_TABLE,
  IdentityLifecycleError,
  auditLoginIdentifierCanonicalization,
  normalizeLoginIdentifier,
  type CreateSessionMutation,
  type IdentityInviteRecord,
  type IdentityJtiRevocationRecord,
  type IdentityLifecycleStore,
  type IdentityLoginThrottleRecord,
  type IdentityIssuedAccessTokenRecord,
  type IdentityLoginIdentifierCanonicalizationAudit,
  type IdentityOneTimeTokenRecord,
  type IdentityThrottlePolicy,
  type IdentityUserRecord,
  type LoginCandidate,
  type LoginIdentifierKind,
  type RefreshRotationResult,
  type RegistrationMutation,
  type RegistrationResult,
  type IdentityRefreshTokenRecord,
} from "./user-lifecycle.js";

interface UserRow extends QueryResultRow {
  id: string;
  status: "active" | "disabled" | "deleted";
  display_name: string;
  created_at: Date | string;
  updated_at: Date | string;
  disabled_at: Date | string | null;
  deleted_at: Date | string | null;
}

interface TenantRow extends QueryResultRow {
  id: string;
  slug: string;
  name: string;
  allowed_scopes: unknown;
  created_at: Date | string;
}

interface MembershipTenantRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  scopes: unknown;
  status: "active" | "suspended";
  created_at: Date | string;
  tenant_slug: string;
  tenant_name: string;
  tenant_allowed_scopes: unknown;
  tenant_created_at: Date | string;
}

interface IdentifierCredentialUserRow extends UserRow {
  identifier_id: string;
  identifier_kind: LoginIdentifierKind;
  normalized_value: string;
  verified_at: Date | string | null;
  identifier_created_at: Date | string;
  credential_id: string;
  password_hash: string;
  algorithm: string;
  credential_created_at: Date | string;
  credential_updated_at: Date | string;
}

interface InviteRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  token_hash: string;
  identifier_kind: LoginIdentifierKind | null;
  normalized_identifier: string | null;
  management_scope: string;
  role: "owner" | "admin" | "member";
  scopes: unknown;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  consumed_by_user_id: string | null;
  created_by_user_id: string;
  created_at: Date | string;
}

interface RefreshFamilyRow extends QueryResultRow {
  refresh_id: string;
  family_id: string;
  token_hash: string;
  generation: number;
  refresh_expires_at: Date | string;
  refresh_created_at: Date | string;
  used_at: Date | string | null;
  refresh_revoked_at: Date | string | null;
  user_id: string;
  tenant_id: string;
  family_scopes: unknown;
  family_status: "active" | "revoked" | "disabled" | "deleted";
  family_expires_at: Date | string;
  family_created_at: Date | string;
  family_updated_at: Date | string;
  family_revoked_at: Date | string | null;
  revoke_reason: string | null;
}

interface SessionContextRow extends UserRow {
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  tenant_created_at: Date | string;
  membership_id: string;
  membership_role: "owner" | "admin" | "member";
  membership_scopes: unknown;
  membership_status: "active" | "suspended";
  membership_created_at: Date | string;
}

interface OneTimeRow extends QueryResultRow {
  id: string;
  user_id: string;
  identifier_id: string | null;
  kind: "verification" | "recovery";
  token_hash: string;
  expires_at: Date | string;
  created_at: Date | string;
  consumed_at: Date | string | null;
}

interface ThrottleRow extends QueryResultRow {
  key_hash: string;
  failures: number;
  window_started_at: Date | string;
  locked_until: Date | string | null;
  tokens: number | string | null;
  last_refilled_at: Date | string | null;
  in_flight: number;
  updated_at: Date | string | null;
}

function lifecycleFailure(
  reason: IdentityLifecycleError["reason"],
  message: string,
  status: IdentityLifecycleError["status"],
): IdentityLifecycleError {
  return new IdentityLifecycleError(reason, message, status);
}

export class PgIdentityLifecycleStore implements IdentityLifecycleStore {
  constructor(private readonly client: PoolQueryClient) {}

  async prepare(): Promise<IdentityLoginIdentifierCanonicalizationAudit> {
    let audit: IdentityLoginIdentifierCanonicalizationAudit;
    try {
      audit = await this.client.transaction(async (tx) => {
        await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          "hasna-identities-user-registration-v1",
        ]);
        const identifiers = await tx.many<{
          id: string;
          kind: LoginIdentifierKind;
          normalized_value: string;
        }>(
          `SELECT id, kind, normalized_value
           FROM ${IDENTITY_LOGIN_IDENTIFIERS_TABLE}
           WHERE kind = 'email'
           ORDER BY id
           FOR UPDATE`,
        );
        const result = auditLoginIdentifierCanonicalization(
          identifiers.map((identifier) => ({
            id: identifier.id,
            kind: identifier.kind,
            normalizedValue: identifier.normalized_value,
          })),
        );
        const auditedAt = new Date().toISOString();
        for (const entry of result.entries) {
          await tx.execute(
            `INSERT INTO ${IDENTITY_LOGIN_IDENTIFIER_AUDIT_TABLE}
               (identifier_id, previous_value, canonical_value, conflicting_identifier_ids, collision, audited_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6)
             ON CONFLICT (identifier_id, canonical_value) DO UPDATE SET
               previous_value = EXCLUDED.previous_value,
               conflicting_identifier_ids = EXCLUDED.conflicting_identifier_ids,
               collision = EXCLUDED.collision,
               audited_at = EXCLUDED.audited_at`,
            [
              entry.identifierId,
              entry.previousValue,
              entry.canonicalValue,
              JSON.stringify(entry.conflictingIdentifierIds),
              entry.conflictingIdentifierIds.length > 0,
              auditedAt,
            ],
          );
        }
        if (result.collisions.length === 0) {
          for (const entry of result.entries) {
            await tx.execute(
              `UPDATE ${IDENTITY_LOGIN_IDENTIFIERS_TABLE}
               SET normalized_value = $2
               WHERE id = $1`,
              [entry.identifierId, entry.canonicalValue],
            );
          }
        }
        const emailInvites = await tx.many<{
          id: string;
          normalized_identifier: string;
        }>(
          `SELECT id, normalized_identifier
           FROM ${IDENTITY_INVITES_TABLE}
           WHERE identifier_kind = 'email' AND normalized_identifier IS NOT NULL
           FOR UPDATE`,
        );
        for (const invite of emailInvites) {
          const canonical = normalizeLoginIdentifier({
            kind: "email",
            value: invite.normalized_identifier,
          }).value;
          if (canonical !== invite.normalized_identifier) {
            await tx.execute(
              `UPDATE ${IDENTITY_INVITES_TABLE}
               SET normalized_identifier = $2
               WHERE id = $1`,
              [invite.id, canonical],
            );
          }
        }
        return result;
      });
    } catch (error) {
      if (error instanceof IdentityLifecycleError && error.reason === "invalid_request") {
        throw lifecycleFailure(
          "invalid_configuration",
          "persisted login identifier cannot be canonicalized",
          500,
        );
      }
      throw error;
    }
    if (audit.collisions.length > 0) {
      throw lifecycleFailure(
        "invalid_configuration",
        "canonical login identifier collision requires operator resolution",
        500,
      );
    }
    return audit;
  }

  async register(input: RegistrationMutation): Promise<RegistrationResult> {
    try {
      return await this.client.transaction(async (tx) => {
        await tx.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          "hasna-identities-user-registration-v1",
        ]);
        const duplicate = await tx.get<{ exists: boolean }>(
          `SELECT true AS exists FROM ${IDENTITY_LOGIN_IDENTIFIERS_TABLE}
           WHERE kind = $1 AND normalized_value = $2`,
          [input.identifier.kind, input.identifier.normalizedValue],
        );
        if (duplicate !== null) {
          throw lifecycleFailure("duplicate_identifier", "registration could not be completed", 409);
        }
        const count = await tx.one<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${IDENTITY_USERS_TABLE}`,
        );
        const isFirstUser = Number(count.count) === 0;
        if (input.bootstrapOnly && !isFirstUser) {
          throw lifecycleFailure("bootstrap_complete", "initial administrator already exists", 409);
        }
        if (!input.bootstrapOnly && input.policy === "disabled") {
          throw lifecycleFailure("registration_disabled", "registration is not available", 403);
        }
        if (!input.bootstrapOnly && isFirstUser && input.policy === "invite") {
          throw lifecycleFailure("invite_invalid", "invite is invalid or expired", 400);
        }

        let tenant = input.personalTenant;
        let membership = input.ownerMembership;
        let invite: InviteRow | null = null;
        if (isFirstUser) {
          tenant = {
            id: input.personalTenant.id,
            slug: input.bootstrapTenant.slug,
            name: input.bootstrapTenant.name,
            allowedScopes: [...input.personalTenant.allowedScopes ?? input.ownerMembership.scopes],
            createdAt: input.user.createdAt,
          };
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: "owner",
            status: "active",
          };
        } else if (input.policy === "invite" && !input.bootstrapOnly) {
          invite = await tx.get<InviteRow>(
            `SELECT * FROM ${IDENTITY_INVITES_TABLE}
             WHERE token_hash = $1
             FOR UPDATE`,
            [input.inviteTokenHash ?? ""],
          );
          if (
            invite === null ||
            invite.consumed_at !== null ||
            new Date(invite.expires_at) <= new Date(input.user.createdAt) ||
            (invite.identifier_kind !== null &&
              (invite.identifier_kind !== input.identifier.kind ||
                invite.normalized_identifier !== input.identifier.normalizedValue))
          ) {
            throw lifecycleFailure("invite_invalid", "invite is invalid or expired", 400);
          }
          const invitedTenant = await tx.get<TenantRow>(
            `SELECT * FROM ${IDENTITY_TENANTS_TABLE} WHERE id = $1`,
            [invite.tenant_id],
          );
          if (invitedTenant === null) {
            throw lifecycleFailure("invite_invalid", "invite is invalid or expired", 400);
          }
          const creator = await tx.get<{
            role: "owner" | "admin" | "member";
            scopes: unknown;
            membership_status: "active" | "suspended";
            user_status: "active" | "disabled" | "deleted";
          }>(
            `SELECT
               membership.role,
               membership.scopes,
               membership.status AS membership_status,
               creator.status AS user_status
             FROM ${IDENTITY_MEMBERSHIPS_TABLE} membership
             JOIN ${IDENTITY_USERS_TABLE} creator ON creator.id = membership.user_id
             WHERE membership.tenant_id = $1 AND membership.user_id = $2
             FOR UPDATE OF membership, creator`,
            [invite.tenant_id, invite.created_by_user_id],
          );
          const inviteScopes = parseScopes(invite.scopes);
          if (
            creator === null ||
            creator.user_status !== "active" ||
            creator.membership_status !== "active" ||
            !roleCanAssign(creator.role, invite.role) ||
            !parseScopes(creator.scopes).includes(invite.management_scope) ||
            !scopeSubset(inviteScopes, parseScopes(creator.scopes)) ||
            !scopeSubset(inviteScopes, parseScopes(invitedTenant.allowed_scopes))
          ) {
            throw lifecycleFailure("invite_invalid", "invite is invalid or expired", 400);
          }
          tenant = mapTenant(invitedTenant);
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: invite.role,
            scopes: inviteScopes,
            status: "active",
          };
        } else {
          tenant = {
            ...tenant,
            allowedScopes: [...tenant.allowedScopes ?? input.ownerMembership.scopes],
          };
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: "owner",
            status: "active",
          };
        }

        await tx.execute(
          `INSERT INTO ${IDENTITY_USERS_TABLE}
             (id, status, display_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.user.id, input.user.status, input.user.displayName, input.user.createdAt, input.user.updatedAt],
        );
        if (invite === null) {
          await tx.execute(
            `INSERT INTO ${IDENTITY_TENANTS_TABLE} (id, slug, name, allowed_scopes, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [
              tenant.id,
              tenant.slug,
              tenant.name,
              JSON.stringify(tenant.allowedScopes ?? input.ownerMembership.scopes),
              tenant.createdAt,
            ],
          );
        }
        await tx.execute(
          `INSERT INTO ${IDENTITY_LOGIN_IDENTIFIERS_TABLE}
             (id, user_id, kind, normalized_value, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.identifier.id,
            input.identifier.userId,
            input.identifier.kind,
            input.identifier.normalizedValue,
            input.identifier.createdAt,
          ],
        );
        await tx.execute(
          `INSERT INTO ${IDENTITY_PASSWORD_CREDENTIALS_TABLE}
             (id, user_id, password_hash, algorithm, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.credential.id,
            input.credential.userId,
            input.credential.passwordHash,
            input.credential.algorithm,
            input.credential.createdAt,
            input.credential.updatedAt,
          ],
        );
        await tx.execute(
          `INSERT INTO ${IDENTITY_MEMBERSHIPS_TABLE}
             (id, tenant_id, user_id, role, scopes, status, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            membership.id,
            membership.tenantId,
            membership.userId,
              membership.role,
              JSON.stringify(membership.scopes),
              membership.status ?? "active",
              membership.createdAt,
          ],
        );
        await insertOneTimeToken(tx, input.verification);
        if (invite !== null) {
          await tx.execute(
            `UPDATE ${IDENTITY_INVITES_TABLE}
             SET consumed_at = $2, consumed_by_user_id = $3
             WHERE id = $1`,
            [invite.id, input.user.createdAt, input.user.id],
          );
        }
        return { user: input.user, tenant, membership, identifier: input.identifier };
      });
    } catch (error) {
      if (error instanceof IdentityLifecycleError) throw error;
      if (isUniqueViolation(error)) {
        throw lifecycleFailure("duplicate_identifier", "registration could not be completed", 409);
      }
      throw error;
    }
  }

  async findLoginCandidate(
    kind: LoginIdentifierKind,
    normalizedValue: string,
  ): Promise<LoginCandidate | null> {
    const row = await this.client.get<IdentifierCredentialUserRow>(
      `SELECT
         u.*,
         li.id AS identifier_id,
         li.kind AS identifier_kind,
         li.normalized_value,
         li.verified_at,
         li.created_at AS identifier_created_at,
         pc.id AS credential_id,
         pc.password_hash,
         pc.algorithm,
         pc.created_at AS credential_created_at,
         pc.updated_at AS credential_updated_at
       FROM ${IDENTITY_LOGIN_IDENTIFIERS_TABLE} li
       JOIN ${IDENTITY_USERS_TABLE} u ON u.id = li.user_id
       JOIN ${IDENTITY_PASSWORD_CREDENTIALS_TABLE} pc ON pc.user_id = u.id
       WHERE li.kind = $1 AND li.normalized_value = $2`,
      [kind, normalizedValue],
    );
    if (row === null) return null;
    const membershipRows = await this.client.many<MembershipTenantRow>(
      `SELECT
         m.*,
         t.slug AS tenant_slug,
         t.name AS tenant_name,
         t.allowed_scopes AS tenant_allowed_scopes,
         t.created_at AS tenant_created_at
       FROM ${IDENTITY_MEMBERSHIPS_TABLE} m
       JOIN ${IDENTITY_TENANTS_TABLE} t ON t.id = m.tenant_id
       WHERE m.user_id = $1
       ORDER BY m.created_at ASC, m.id ASC`,
      [row.id],
    );
    return {
      user: mapUser(row),
      identifier: {
        id: row.identifier_id,
        userId: row.id,
        kind: row.identifier_kind,
        normalizedValue: row.normalized_value,
        ...(row.verified_at === null ? {} : { verifiedAt: iso(row.verified_at) }),
        createdAt: iso(row.identifier_created_at),
      },
      credential: {
        id: row.credential_id,
        userId: row.id,
        passwordHash: row.password_hash,
        algorithm: row.algorithm,
        createdAt: iso(row.credential_created_at),
        updatedAt: iso(row.credential_updated_at),
      },
      memberships: membershipRows.map(mapMembership),
      tenants: membershipRows.map((membership) => ({
        id: membership.tenant_id,
        slug: membership.tenant_slug,
        name: membership.tenant_name,
        allowedScopes: parseScopes(membership.tenant_allowed_scopes),
        createdAt: iso(membership.tenant_created_at),
      })),
    };
  }

  async getLoginThrottle(keyHash: string, now: Date): Promise<IdentityLoginThrottleRecord | null> {
    const row = await this.client.get<ThrottleRow>(
      `SELECT * FROM ${IDENTITY_LOGIN_THROTTLE_TABLE} WHERE key_hash = $1`,
      [keyHash],
    );
    if (row === null) return null;
    if (row.locked_until !== null && new Date(row.locked_until) <= now) {
      await this.client.execute(
        `DELETE FROM ${IDENTITY_LOGIN_THROTTLE_TABLE} WHERE key_hash = $1`,
        [keyHash],
      );
      return null;
    }
    return mapThrottle(row);
  }

  async reserveAuthAttempt(
    keyHash: string,
    now: Date,
    policy: IdentityThrottlePolicy,
  ): Promise<boolean> {
    return this.client.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO ${IDENTITY_LOGIN_THROTTLE_TABLE}
           (key_hash, failures, window_started_at, locked_until, tokens, last_refilled_at, in_flight, updated_at)
         VALUES ($1, 0, $2, NULL, $3, $2, 0, $2)
         ON CONFLICT (key_hash) DO NOTHING`,
        [keyHash, now.toISOString(), policy.maxFailures],
      );
      const row = await tx.one<ThrottleRow>(
        `SELECT * FROM ${IDENTITY_LOGIN_THROTTLE_TABLE}
         WHERE key_hash = $1
         FOR UPDATE`,
        [keyHash],
      );
      if (row.locked_until !== null && new Date(row.locked_until) > now) return false;
      const lastRefilledAt = new Date(row.last_refilled_at ?? row.window_started_at);
      const elapsedSeconds = Math.max(0, (now.getTime() - lastRefilledAt.getTime()) / 1_000);
      const refillRate = policy.maxFailures / policy.windowSeconds;
      const tokens = Math.min(
        policy.maxFailures,
        (row.tokens === null ? policy.maxFailures : Number(row.tokens)) + elapsedSeconds * refillRate,
      );
      const reservationIsStale =
        row.updated_at !== null &&
        new Date(row.updated_at).getTime() <= now.getTime() - policy.windowSeconds * 1_000;
      const inFlight = reservationIsStale ? 0 : Number(row.in_flight);
      if (inFlight >= policy.maxConcurrent || tokens < 1) return false;
      await tx.execute(
        `UPDATE ${IDENTITY_LOGIN_THROTTLE_TABLE}
         SET tokens = $2,
             last_refilled_at = $3,
             in_flight = $4,
             updated_at = $3
         WHERE key_hash = $1`,
        [keyHash, tokens - 1, now.toISOString(), inFlight + 1],
      );
      return true;
    });
  }

  async completeAuthAttempt(
    keyHash: string,
    now: Date,
    outcome: "success" | "failure",
    policy: IdentityThrottlePolicy,
  ): Promise<void> {
    await this.client.transaction(async (tx) => {
      const row = await tx.get<ThrottleRow>(
        `SELECT * FROM ${IDENTITY_LOGIN_THROTTLE_TABLE}
         WHERE key_hash = $1
         FOR UPDATE`,
        [keyHash],
      );
      if (row === null) return;
      let failures = outcome === "success" ? 0 : Number(row.failures) + 1;
      let windowStartedAt = iso(row.window_started_at);
      if (
        outcome === "failure" &&
        new Date(row.window_started_at).getTime() < now.getTime() - policy.windowSeconds * 1_000
      ) {
        failures = 1;
        windowStartedAt = now.toISOString();
      }
      const lockedUntil =
        outcome === "failure" && failures >= policy.maxFailures
          ? new Date(now.getTime() + policy.lockSeconds * 1_000).toISOString()
          : null;
      await tx.execute(
        `UPDATE ${IDENTITY_LOGIN_THROTTLE_TABLE}
         SET failures = $2,
             window_started_at = $3,
             locked_until = $4,
             in_flight = GREATEST(0, in_flight - 1),
             updated_at = $5
         WHERE key_hash = $1`,
        [keyHash, failures, windowStartedAt, lockedUntil, now.toISOString()],
      );
    });
  }

  async recordLoginFailure(
    keyHash: string,
    now: Date,
    policy: { maxFailures: number; windowSeconds: number; lockSeconds: number },
  ): Promise<void> {
    const windowCutoff = new Date(now.getTime() - policy.windowSeconds * 1_000);
    const lockedUntil = new Date(now.getTime() + policy.lockSeconds * 1_000);
    await this.client.execute(
      `INSERT INTO ${IDENTITY_LOGIN_THROTTLE_TABLE}
         (key_hash, failures, window_started_at, locked_until)
       VALUES ($1, 1, $2, NULL)
       ON CONFLICT (key_hash) DO UPDATE SET
         failures = CASE
           WHEN ${IDENTITY_LOGIN_THROTTLE_TABLE}.window_started_at < $3 THEN 1
           ELSE ${IDENTITY_LOGIN_THROTTLE_TABLE}.failures + 1
         END,
         window_started_at = CASE
           WHEN ${IDENTITY_LOGIN_THROTTLE_TABLE}.window_started_at < $3 THEN $2
           ELSE ${IDENTITY_LOGIN_THROTTLE_TABLE}.window_started_at
         END,
         locked_until = CASE
           WHEN (
             CASE
               WHEN ${IDENTITY_LOGIN_THROTTLE_TABLE}.window_started_at < $3 THEN 1
               ELSE ${IDENTITY_LOGIN_THROTTLE_TABLE}.failures + 1
             END
           ) >= $4 THEN $5
           ELSE ${IDENTITY_LOGIN_THROTTLE_TABLE}.locked_until
         END`,
      [keyHash, now.toISOString(), windowCutoff.toISOString(), policy.maxFailures, lockedUntil.toISOString()],
    );
  }

  async clearLoginFailures(keyHash: string): Promise<void> {
    await this.client.execute(
      `DELETE FROM ${IDENTITY_LOGIN_THROTTLE_TABLE} WHERE key_hash = $1`,
      [keyHash],
    );
  }

  async createInvite(
    invite: IdentityInviteRecord,
    authorization?: {
      actorTokenScopes: readonly string[];
      inviteManagementScope: string;
    },
  ): Promise<void> {
    await this.client.transaction(async (tx) => {
      const actor = await tx.get<{
        role: "owner" | "admin" | "member";
        scopes: unknown;
        membership_status: "active" | "suspended";
        user_status: "active" | "disabled" | "deleted";
        allowed_scopes: unknown;
      }>(
        `SELECT
           membership.role,
           membership.scopes,
           membership.status AS membership_status,
           actor_user.status AS user_status,
           tenant.allowed_scopes
         FROM ${IDENTITY_MEMBERSHIPS_TABLE} membership
         JOIN ${IDENTITY_USERS_TABLE} actor_user ON actor_user.id = membership.user_id
         JOIN ${IDENTITY_TENANTS_TABLE} tenant ON tenant.id = membership.tenant_id
         WHERE membership.tenant_id = $1 AND membership.user_id = $2
         FOR UPDATE OF membership, actor_user, tenant`,
        [invite.tenantId, invite.createdByUserId],
      );
      if (
        actor === null ||
        actor.user_status !== "active" ||
        actor.membership_status !== "active" ||
        authorization === undefined ||
        !authorization.actorTokenScopes.includes(authorization.inviteManagementScope) ||
        !parseScopes(actor.scopes).includes(authorization.inviteManagementScope) ||
        !roleCanAssign(actor.role, invite.role)
      ) {
        throw lifecycleFailure("forbidden", "access denied", 403);
      }
      if (
        !scopeSubset(invite.scopes, authorization.actorTokenScopes) ||
        !scopeSubset(invite.scopes, parseScopes(actor.scopes)) ||
        !scopeSubset(invite.scopes, parseScopes(actor.allowed_scopes))
      ) {
        throw lifecycleFailure("invalid_scope", "requested scope is not allowed", 403);
      }
      await tx.execute(
        `INSERT INTO ${IDENTITY_INVITES_TABLE}
           (id, tenant_id, token_hash, identifier_kind, normalized_identifier,
            management_scope, role, scopes, expires_at, created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
        [
          invite.id,
          invite.tenantId,
          invite.tokenHash,
          invite.identifierKind ?? null,
          invite.normalizedIdentifier ?? null,
          invite.managementScope ?? authorization.inviteManagementScope,
          invite.role,
          JSON.stringify(invite.scopes),
          invite.expiresAt,
          invite.createdByUserId,
          invite.createdAt,
        ],
      );
    });
  }

  async createSession(input: CreateSessionMutation): Promise<void> {
    await this.client.transaction(async (tx) => {
      const context = await tx.get<{
        membership_scopes: unknown;
        membership_status: "active" | "suspended";
        allowed_scopes: unknown;
      }>(
        `SELECT
           m.scopes AS membership_scopes,
           m.status AS membership_status,
           t.allowed_scopes
         FROM ${IDENTITY_USERS_TABLE} u
         JOIN ${IDENTITY_MEMBERSHIPS_TABLE} m
           ON m.user_id = u.id AND m.tenant_id = $2
         JOIN ${IDENTITY_TENANTS_TABLE} t ON t.id = m.tenant_id
         WHERE u.id = $1 AND u.status = 'active'
         FOR UPDATE OF u, m, t`,
        [input.family.userId, input.family.tenantId],
      );
      if (context === null || context.membership_status !== "active") {
        throw lifecycleFailure("invalid_credentials", "authentication failed", 401);
      }
      input.family.scopes = intersectScopeSets(
        input.family.scopes,
        parseScopes(context.membership_scopes),
        parseScopes(context.allowed_scopes),
      );
      if (input.family.scopes.length === 0) {
        throw lifecycleFailure("invalid_scope", "requested scope is not allowed", 403);
      }
      await tx.execute(
        `INSERT INTO ${IDENTITY_SESSION_FAMILIES_TABLE}
           (id, session_hash, user_id, tenant_id, scopes, status, expires_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          input.family.id,
          hashOpaqueClaim(input.family.id),
          input.family.userId,
          input.family.tenantId,
          JSON.stringify(input.family.scopes),
          input.family.status,
          input.family.expiresAt,
          input.family.createdAt,
          input.family.updatedAt,
        ],
      );
      await insertRefreshToken(tx, input.refresh);
    });
  }

  async rotateRefreshToken(input: {
    currentTokenHash: string;
    replacement: IdentityRefreshTokenRecord;
    now: Date;
  }): Promise<RefreshRotationResult> {
    return this.client.transaction(async (tx) => {
      const row = await tx.get<RefreshFamilyRow>(
        `SELECT
           r.id AS refresh_id,
           r.family_id,
           r.token_hash,
           r.generation,
           r.expires_at AS refresh_expires_at,
           r.created_at AS refresh_created_at,
           r.used_at,
           r.revoked_at AS refresh_revoked_at,
           f.user_id,
           f.tenant_id,
           f.scopes AS family_scopes,
           f.status AS family_status,
           f.expires_at AS family_expires_at,
           f.created_at AS family_created_at,
           f.updated_at AS family_updated_at,
           f.revoked_at AS family_revoked_at,
           f.revoke_reason
         FROM ${IDENTITY_REFRESH_TOKENS_TABLE} r
         JOIN ${IDENTITY_SESSION_FAMILIES_TABLE} f ON f.id = r.family_id
         WHERE r.token_hash = $1
         FOR UPDATE OF r, f`,
        [input.currentTokenHash],
      );
      if (row === null) return { kind: "invalid" };
      if (row.used_at !== null || row.refresh_revoked_at !== null) {
        if (row.family_status === "active") {
          await revokeFamily(tx, row.family_id, "refresh_replay", input.now);
        }
        return { kind: "replay" };
      }
      if (
        row.family_status !== "active" ||
        new Date(row.refresh_expires_at) <= input.now ||
        new Date(row.family_expires_at) <= input.now
      ) {
        return { kind: "invalid" };
      }
      const context = await tx.get<SessionContextRow>(
        `SELECT
           u.*,
           t.id AS tenant_id,
           t.slug AS tenant_slug,
           t.name AS tenant_name,
           t.allowed_scopes AS tenant_allowed_scopes,
           t.created_at AS tenant_created_at,
           m.id AS membership_id,
           m.role AS membership_role,
           m.scopes AS membership_scopes,
           m.status AS membership_status,
           m.created_at AS membership_created_at
         FROM ${IDENTITY_USERS_TABLE} u
         JOIN ${IDENTITY_MEMBERSHIPS_TABLE} m
           ON m.user_id = u.id AND m.tenant_id = $2
         JOIN ${IDENTITY_TENANTS_TABLE} t ON t.id = m.tenant_id
         WHERE u.id = $1`,
        [row.user_id, row.tenant_id],
      );
      const currentScopes =
        context === null
          ? []
          : intersectScopeSets(
              parseScopes(row.family_scopes),
              parseScopes(context.membership_scopes),
              parseScopes(context.tenant_allowed_scopes),
            );
      if (
        context === null ||
        context.status !== "active" ||
        context.membership_status !== "active" ||
        currentScopes.length === 0
      ) {
        await revokeFamily(tx, row.family_id, "membership_incompatible", input.now);
        return { kind: "invalid" };
      }
      await tx.execute(
        `UPDATE ${IDENTITY_REFRESH_TOKENS_TABLE} SET used_at = $2 WHERE id = $1`,
        [row.refresh_id, input.now.toISOString()],
      );
      input.replacement.familyId = row.family_id;
      input.replacement.generation = row.generation + 1;
      if (new Date(input.replacement.expiresAt) > new Date(row.family_expires_at)) {
        input.replacement.expiresAt = iso(row.family_expires_at);
      }
      await insertRefreshToken(tx, input.replacement);
      await tx.execute(
        `UPDATE ${IDENTITY_SESSION_FAMILIES_TABLE}
         SET scopes = $2::jsonb, updated_at = $3
         WHERE id = $1`,
        [row.family_id, JSON.stringify(currentScopes), input.now.toISOString()],
      );
      return {
        kind: "rotated",
        family: {
          id: row.family_id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          scopes: currentScopes,
          status: row.family_status,
          expiresAt: iso(row.family_expires_at),
          createdAt: iso(row.family_created_at),
          updatedAt: input.now.toISOString(),
          ...(row.family_revoked_at === null ? {} : { revokedAt: iso(row.family_revoked_at) }),
          ...(row.revoke_reason === null ? {} : { revokeReason: row.revoke_reason }),
        },
        user: mapUser(context),
        tenant: {
          id: context.tenant_id,
          slug: context.tenant_slug,
          name: context.tenant_name,
          allowedScopes: parseScopes(context.tenant_allowed_scopes),
          createdAt: iso(context.tenant_created_at),
        },
        membership: {
          id: context.membership_id,
          tenantId: context.tenant_id,
          userId: context.id,
          role: context.membership_role,
          scopes: parseScopes(context.membership_scopes),
          status: context.membership_status,
          createdAt: iso(context.membership_created_at),
        },
      };
    });
  }

  async revokeSessionFamily(familyId: string, reason: string, now: Date): Promise<void> {
    await this.client.transaction(async (tx) => {
      await revokeFamily(tx, familyId, reason, now);
      await revokeIssuedJtis(tx, `issued.family_id = $1`, [familyId], now);
    });
  }

  async revokeAllUserSessions(userId: string, reason: string, now: Date): Promise<void> {
    await this.client.transaction(async (tx) => {
      const rows = await tx.many<{ id: string }>(
        `SELECT id FROM ${IDENTITY_SESSION_FAMILIES_TABLE}
         WHERE user_id = $1 AND status = 'active'
         FOR UPDATE`,
        [userId],
      );
      for (const row of rows) await revokeFamily(tx, row.id, reason, now);
      await revokeIssuedJtis(tx, `issued.user_id = $1`, [userId], now);
    });
  }

  async revokeJti(input: IdentityJtiRevocationRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO ${IDENTITY_JTI_REVOCATIONS_TABLE}
         (jti_hash, user_id, expires_at, revoked_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (jti_hash) DO NOTHING`,
      [input.jtiHash, input.userId, input.expiresAt, input.revokedAt],
    );
  }

  async recordIssuedAccessToken(input: IdentityIssuedAccessTokenRecord): Promise<void> {
    await this.client.transaction(async (tx) => {
      const family = await tx.get<{ ok: boolean }>(
        `SELECT true AS ok
         FROM ${IDENTITY_SESSION_FAMILIES_TABLE} family
         JOIN ${IDENTITY_USERS_TABLE} identity_user ON identity_user.id = family.user_id
         JOIN ${IDENTITY_MEMBERSHIPS_TABLE} membership
           ON membership.user_id = family.user_id AND membership.tenant_id = family.tenant_id
         WHERE family.id = $1
           AND family.user_id = $2
           AND family.tenant_id = $3
           AND family.status = 'active'
           AND identity_user.status = 'active'
           AND membership.status = 'active'
         FOR UPDATE OF family, identity_user, membership`,
        [input.familyId, input.userId, input.tenantId],
      );
      if (family === null) {
        throw lifecycleFailure("invalid_credentials", "authentication failed", 401);
      }
      await tx.execute(
        `INSERT INTO ${IDENTITY_ISSUED_ACCESS_TOKENS_TABLE}
           (jti_hash, family_id, user_id, tenant_id, expires_at, issued_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (jti_hash) DO NOTHING`,
        [
          input.jtiHash,
          input.familyId,
          input.userId,
          input.tenantId,
          input.expiresAt,
          input.issuedAt,
        ],
      );
    });
  }

  async mutateUserSecurityState(input: {
    actorUserId: string;
    actorTenantId: string;
    actorTokenScopes: readonly string[];
    platformAuthorityScope: string;
    platformAuthorityTenantSlugs: readonly string[];
    targetUserId: string;
    status: "active" | "disabled" | "deleted";
    now: Date;
  }): Promise<IdentityUserRecord | null> {
    return this.client.transaction(async (tx) => {
      const actor = await tx.get<{
        role: "owner" | "admin" | "member";
        scopes: unknown;
        membership_status: "active" | "suspended";
        user_status: "active" | "disabled" | "deleted";
        tenant_slug: string;
      }>(
        `SELECT
           membership.role,
           membership.scopes,
           membership.status AS membership_status,
           actor_user.status AS user_status,
           tenant.slug AS tenant_slug
         FROM ${IDENTITY_MEMBERSHIPS_TABLE} membership
         JOIN ${IDENTITY_USERS_TABLE} actor_user ON actor_user.id = membership.user_id
         JOIN ${IDENTITY_TENANTS_TABLE} tenant ON tenant.id = membership.tenant_id
         WHERE membership.user_id = $1 AND membership.tenant_id = $2
         FOR UPDATE OF membership, actor_user, tenant`,
        [input.actorUserId, input.actorTenantId],
      );
      const target = await tx.get<UserRow>(
        `SELECT * FROM ${IDENTITY_USERS_TABLE} WHERE id = $1 FOR UPDATE`,
        [input.targetUserId],
      );
      if (target === null) return null;
      const targetRoles = await tx.many<{ role: "owner" | "admin" | "member" }>(
        `SELECT role FROM ${IDENTITY_MEMBERSHIPS_TABLE}
         WHERE user_id = $1
         FOR UPDATE`,
        [input.targetUserId],
      );
      const highestTargetRole = highestMembershipRole(targetRoles.map((item) => item.role));
      if (
        actor === null ||
        actor.user_status !== "active" ||
        actor.membership_status !== "active" ||
        actor.role !== "owner" ||
        !input.platformAuthorityTenantSlugs.includes(actor.tenant_slug) ||
        !input.actorTokenScopes.includes(input.platformAuthorityScope) ||
        !parseScopes(actor.scopes).includes(input.platformAuthorityScope) ||
        highestTargetRole === null ||
        !roleCanManage(actor.role, highestTargetRole)
      ) {
        throw lifecycleFailure("forbidden", "access denied", 403);
      }
      const updated = await tx.one<UserRow>(
        `UPDATE ${IDENTITY_USERS_TABLE}
         SET status = $2::text,
             updated_at = $3::timestamptz,
             disabled_at = CASE WHEN $2::text = 'disabled' THEN $3::timestamptz ELSE NULL END,
             deleted_at = CASE WHEN $2::text = 'deleted' THEN $3::timestamptz ELSE NULL END
         WHERE id = $1
         RETURNING *`,
        [input.targetUserId, input.status, input.now.toISOString()],
      );
      const families = await tx.many<{ id: string }>(
        `SELECT id FROM ${IDENTITY_SESSION_FAMILIES_TABLE}
         WHERE user_id = $1 AND status = 'active'
         FOR UPDATE`,
        [input.targetUserId],
      );
      for (const family of families) {
        await revokeFamily(tx, family.id, `user_${input.status}`, input.now);
      }
      await revokeIssuedJtis(tx, `issued.user_id = $1`, [input.targetUserId], input.now);
      return mapUser(updated);
    });
  }

  async suspendMembership(input: {
    actorUserId: string;
    tenantId: string;
    targetUserId: string;
    now: Date;
  }) {
    return this.client.transaction(async (tx) => {
      const memberships = await tx.many<{
        id: string;
        user_id: string;
        role: "owner" | "admin" | "member";
        scopes: unknown;
        status: "active" | "suspended";
        created_at: Date | string;
        user_status: "active" | "disabled" | "deleted";
      }>(
        `SELECT membership.*, identity_user.status AS user_status
         FROM ${IDENTITY_MEMBERSHIPS_TABLE} membership
         JOIN ${IDENTITY_USERS_TABLE} identity_user ON identity_user.id = membership.user_id
         WHERE membership.tenant_id = $1
           AND membership.user_id IN ($2, $3)
         FOR UPDATE OF membership, identity_user`,
        [input.tenantId, input.actorUserId, input.targetUserId],
      );
      const actor = memberships.find((membership) => membership.user_id === input.actorUserId);
      const target = memberships.find((membership) => membership.user_id === input.targetUserId);
      if (target === undefined) return null;
      if (
        actor === undefined ||
        actor.user_status !== "active" ||
        actor.status !== "active" ||
        !roleCanManage(actor.role, target.role)
      ) {
        throw lifecycleFailure("forbidden", "access denied", 403);
      }
      await tx.execute(
        `UPDATE ${IDENTITY_MEMBERSHIPS_TABLE} SET status = 'suspended' WHERE id = $1`,
        [target.id],
      );
      const families = await tx.many<{ id: string }>(
        `SELECT id FROM ${IDENTITY_SESSION_FAMILIES_TABLE}
         WHERE user_id = $1 AND tenant_id = $2 AND status = 'active'
         FOR UPDATE`,
        [input.targetUserId, input.tenantId],
      );
      for (const family of families) await revokeFamily(tx, family.id, "membership_suspended", input.now);
      await revokeIssuedJtis(
        tx,
        `issued.user_id = $1 AND issued.tenant_id = $2`,
        [input.targetUserId, input.tenantId],
        input.now,
      );
      return {
        id: target.id,
        tenantId: input.tenantId,
        userId: target.user_id,
        role: target.role,
        scopes: parseScopes(target.scopes),
        status: "suspended" as const,
        createdAt: iso(target.created_at),
      };
    });
  }

  async canAdminister(actorUserId: string, tenantId: string, targetUserId: string): Promise<boolean> {
    const row = await this.client.get<{
      actor_role: "owner" | "admin" | "member";
      target_role: "owner" | "admin" | "member";
    }>(
      `SELECT actor.role AS actor_role, target.role AS target_role
       FROM ${IDENTITY_MEMBERSHIPS_TABLE} actor
       JOIN ${IDENTITY_USERS_TABLE} actor_user ON actor_user.id = actor.user_id
       JOIN ${IDENTITY_MEMBERSHIPS_TABLE} target
         ON target.tenant_id = actor.tenant_id
        AND target.user_id = $3
       WHERE actor.user_id = $1
         AND actor.tenant_id = $2
         AND actor.status = 'active'
         AND target.status = 'active'
         AND actor_user.status = 'active'`,
      [actorUserId, tenantId, targetUserId],
    );
    return row !== null && roleCanManage(row.actor_role, row.target_role);
  }

  async setUserStatus(
    userId: string,
    status: "active" | "disabled" | "deleted",
    now: Date,
  ): Promise<IdentityUserRecord | null> {
    return this.client.transaction(async (tx) => {
      const rows = await tx.many<UserRow>(
        `UPDATE ${IDENTITY_USERS_TABLE}
         SET status = $2::text,
             updated_at = $3::timestamptz,
             disabled_at = CASE WHEN $2::text = 'disabled' THEN $3::timestamptz ELSE NULL END,
             deleted_at = CASE WHEN $2::text = 'deleted' THEN $3::timestamptz ELSE NULL END
         WHERE id = $1
         RETURNING *`,
        [userId, status, now.toISOString()],
      );
      const user = rows[0];
      if (user === undefined) return null;
      if (status !== "active") {
        const families = await tx.many<{ id: string }>(
          `SELECT id FROM ${IDENTITY_SESSION_FAMILIES_TABLE}
           WHERE user_id = $1 AND status = 'active'
           FOR UPDATE`,
          [userId],
        );
        for (const family of families) await revokeFamily(tx, family.id, `user_${status}`, now);
        await revokeIssuedJtis(tx, `issued.user_id = $1`, [userId], now);
      }
      return mapUser(user);
    });
  }

  async createOneTimeToken(token: IdentityOneTimeTokenRecord): Promise<void> {
    await this.client.transaction(async (tx) => {
      await tx.execute(
        `UPDATE ${IDENTITY_ONE_TIME_TOKENS_TABLE}
         SET consumed_at = $3
         WHERE user_id = $1 AND kind = $2 AND consumed_at IS NULL`,
        [token.userId, token.kind, token.createdAt],
      );
      await insertOneTimeToken(tx, token);
    });
  }

  async consumeVerification(tokenHash: string, now: Date): Promise<boolean> {
    return this.client.transaction(async (tx) => {
      const token = await tx.get<OneTimeRow>(
        `SELECT * FROM ${IDENTITY_ONE_TIME_TOKENS_TABLE}
         WHERE token_hash = $1 AND kind = 'verification'
         FOR UPDATE`,
        [tokenHash],
      );
      if (
        token === null ||
        token.consumed_at !== null ||
        token.identifier_id === null ||
        new Date(token.expires_at) <= now
      ) {
        return false;
      }
      const updated = await tx.many<{ id: string }>(
        `UPDATE ${IDENTITY_LOGIN_IDENTIFIERS_TABLE}
         SET verified_at = $2
         WHERE id = $1 AND user_id = $3
         RETURNING id`,
        [token.identifier_id, now.toISOString(), token.user_id],
      );
      if (updated.length !== 1) return false;
      await tx.execute(
        `UPDATE ${IDENTITY_ONE_TIME_TOKENS_TABLE} SET consumed_at = $2 WHERE id = $1`,
        [token.id, now.toISOString()],
      );
      return true;
    });
  }

  async completeRecovery(input: {
    tokenHash: string;
    passwordHash: string;
    algorithm: string;
    now: Date;
  }): Promise<string | null> {
    return this.client.transaction(async (tx) => {
      const token = await tx.get<OneTimeRow>(
        `SELECT ott.*
         FROM ${IDENTITY_ONE_TIME_TOKENS_TABLE} ott
         JOIN ${IDENTITY_USERS_TABLE} u ON u.id = ott.user_id
         WHERE ott.token_hash = $1
           AND ott.kind = 'recovery'
           AND u.status = 'active'
         FOR UPDATE OF ott`,
        [input.tokenHash],
      );
      if (token === null || token.consumed_at !== null || new Date(token.expires_at) <= input.now) {
        return null;
      }
      await tx.execute(
        `UPDATE ${IDENTITY_PASSWORD_CREDENTIALS_TABLE}
         SET password_hash = $2, algorithm = $3, updated_at = $4
         WHERE user_id = $1`,
        [token.user_id, input.passwordHash, input.algorithm, input.now.toISOString()],
      );
      await tx.execute(
        `UPDATE ${IDENTITY_ONE_TIME_TOKENS_TABLE} SET consumed_at = $2 WHERE id = $1`,
        [token.id, input.now.toISOString()],
      );
      const families = await tx.many<{ id: string }>(
        `SELECT id FROM ${IDENTITY_SESSION_FAMILIES_TABLE}
         WHERE user_id = $1 AND status = 'active'
         FOR UPDATE`,
        [token.user_id],
      );
      for (const family of families) await revokeFamily(tx, family.id, "password_recovery", input.now);
      await revokeIssuedJtis(tx, `issued.user_id = $1`, [token.user_id], input.now);
      return token.user_id;
    });
  }

  async isJtiRevoked(jtiSha256: string): Promise<boolean> {
    const row = await this.client.get<{ exists: boolean }>(
      `SELECT true AS exists FROM ${IDENTITY_JTI_REVOCATIONS_TABLE}
       WHERE jti_hash = $1 AND expires_at > now()`,
      [requireSha256(jtiSha256)],
    );
    return row !== null;
  }

  async getSessionFamilyStatus(sessionSha256: string): Promise<IdentitySessionFamilyStatus> {
    const row = await this.client.get<{
      family_status: SessionFamilyStatusRow;
      family_scopes: unknown;
      user_status: "active" | "disabled" | "deleted";
      membership_status: "active" | "suspended";
      membership_scopes: unknown;
      allowed_scopes: unknown;
    }>(
      `SELECT
         family.status AS family_status,
         family.scopes AS family_scopes,
         identity_user.status AS user_status,
         membership.status AS membership_status,
         membership.scopes AS membership_scopes,
         tenant.allowed_scopes
       FROM ${IDENTITY_SESSION_FAMILIES_TABLE} family
       JOIN ${IDENTITY_USERS_TABLE} identity_user ON identity_user.id = family.user_id
       JOIN ${IDENTITY_MEMBERSHIPS_TABLE} membership
         ON membership.user_id = family.user_id AND membership.tenant_id = family.tenant_id
       JOIN ${IDENTITY_TENANTS_TABLE} tenant ON tenant.id = family.tenant_id
       WHERE family.session_hash = $1`,
      [requireSha256(sessionSha256)],
    );
    if (row === null) return "unknown";
    if (row.user_status === "deleted") return "deleted";
    if (
      row.user_status !== "active" ||
      row.membership_status !== "active" ||
      !scopeSubset(parseScopes(row.family_scopes), parseScopes(row.membership_scopes)) ||
      !scopeSubset(parseScopes(row.family_scopes), parseScopes(row.allowed_scopes))
    ) {
      return "disabled";
    }
    if (row.family_status === "active") return "active";
    if (row.family_status === "disabled") return "disabled";
    return "deleted";
  }
}

type SessionFamilyStatusRow = "active" | "revoked" | "disabled" | "deleted";

async function insertOneTimeToken(
  client: TypedQueryClient,
  token: IdentityOneTimeTokenRecord,
): Promise<void> {
  await client.execute(
    `INSERT INTO ${IDENTITY_ONE_TIME_TOKENS_TABLE}
       (id, user_id, identifier_id, kind, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      token.id,
      token.userId,
      token.identifierId ?? null,
      token.kind,
      token.tokenHash,
      token.expiresAt,
      token.createdAt,
    ],
  );
}

async function insertRefreshToken(
  client: TypedQueryClient,
  token: IdentityRefreshTokenRecord,
): Promise<void> {
  await client.execute(
    `INSERT INTO ${IDENTITY_REFRESH_TOKENS_TABLE}
       (id, family_id, token_hash, generation, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [token.id, token.familyId, token.tokenHash, token.generation, token.expiresAt, token.createdAt],
  );
}

async function revokeFamily(
  client: TypedQueryClient,
  familyId: string,
  reason: string,
  now: Date,
): Promise<void> {
  await client.execute(
    `UPDATE ${IDENTITY_SESSION_FAMILIES_TABLE}
     SET status = 'revoked', revoked_at = $2, updated_at = $2, revoke_reason = $3
     WHERE id = $1 AND status = 'active'`,
    [familyId, now.toISOString(), reason],
  );
  await client.execute(
    `UPDATE ${IDENTITY_REFRESH_TOKENS_TABLE}
     SET revoked_at = COALESCE(revoked_at, $2)
     WHERE family_id = $1`,
    [familyId, now.toISOString()],
  );
}

async function revokeIssuedJtis(
  client: TypedQueryClient,
  predicateSql: string,
  predicateParameters: readonly unknown[],
  now: Date,
): Promise<void> {
  const nowParameter = `$${predicateParameters.length + 1}`;
  await client.execute(
    `INSERT INTO ${IDENTITY_JTI_REVOCATIONS_TABLE}
       (jti_hash, user_id, expires_at, revoked_at)
     SELECT issued.jti_hash, issued.user_id, issued.expires_at, ${nowParameter}
     FROM ${IDENTITY_ISSUED_ACCESS_TOKENS_TABLE} issued
     WHERE ${predicateSql}
       AND issued.expires_at > ${nowParameter}
     ON CONFLICT (jti_hash) DO NOTHING`,
    [...predicateParameters, now.toISOString()],
  );
}

function mapUser(row: UserRow): IdentityUserRecord {
  return {
    id: row.id,
    status: row.status,
    displayName: row.display_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...(row.disabled_at === null ? {} : { disabledAt: iso(row.disabled_at) }),
    ...(row.deleted_at === null ? {} : { deletedAt: iso(row.deleted_at) }),
  };
}

function mapTenant(row: TenantRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    allowedScopes: parseScopes(row.allowed_scopes),
    createdAt: iso(row.created_at),
  };
}

function mapMembership(row: MembershipTenantRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    role: row.role,
    scopes: parseScopes(row.scopes),
    status: row.status,
    createdAt: iso(row.created_at),
  };
}

function mapThrottle(row: ThrottleRow): IdentityLoginThrottleRecord {
  return {
    keyHash: row.key_hash,
    failures: Number(row.failures),
    windowStartedAt: iso(row.window_started_at),
    ...(row.locked_until === null ? {} : { lockedUntil: iso(row.locked_until) }),
    ...(row.tokens === null ? {} : { tokens: Number(row.tokens) }),
    ...(row.last_refilled_at === null ? {} : { lastRefilledAt: iso(row.last_refilled_at) }),
    inFlight: Number(row.in_flight),
    ...(row.updated_at === null ? {} : { updatedAt: iso(row.updated_at) }),
  };
}

function scopeSubset(values: readonly string[], allowedValues: readonly string[]): boolean {
  const allowed = new Set(allowedValues);
  return values.every((value) => allowed.has(value));
}

function intersectScopeSets(...collections: readonly (readonly string[])[]): string[] {
  if (collections.length === 0) return [];
  const [first, ...rest] = collections;
  return [...new Set((first ?? []).filter((scope) => rest.every((collection) => collection.includes(scope))))].sort();
}

const ROLE_RANK: Readonly<Record<"owner" | "admin" | "member", number>> = {
  member: 0,
  admin: 1,
  owner: 2,
};

function roleCanAssign(
  actor: "owner" | "admin" | "member",
  target: "owner" | "admin" | "member",
): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}

function roleCanManage(
  actor: "owner" | "admin" | "member",
  target: "owner" | "admin" | "member",
): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}

function highestMembershipRole(
  roles: readonly ("owner" | "admin" | "member")[],
): "owner" | "admin" | "member" | null {
  return roles.reduce<"owner" | "admin" | "member" | null>(
    (highest, role) => highest === null || ROLE_RANK[role] > ROLE_RANK[highest] ? role : highest,
    null,
  );
}

function parseScopes(value: unknown): string[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw lifecycleFailure("invalid_configuration", "persisted membership scopes are invalid", 500);
  }
  return [...new Set(parsed)].sort();
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw lifecycleFailure("invalid_configuration", "persisted timestamp is invalid", 500);
  }
  return date.toISOString();
}

function requireSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw lifecycleFailure("invalid_request", "token state hash is invalid", 400);
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
