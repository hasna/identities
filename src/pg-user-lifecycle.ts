import type { QueryResultRow } from "pg";
import type { PoolQueryClient, TypedQueryClient } from "./generated/storage-kit/query.js";
import { hashOpaqueClaim, type IdentitySessionFamilyStatus } from "./identity-auth.js";
import {
  IDENTITY_INVITES_TABLE,
  IDENTITY_JTI_REVOCATIONS_TABLE,
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
  type CreateSessionMutation,
  type IdentityInviteRecord,
  type IdentityJtiRevocationRecord,
  type IdentityLifecycleStore,
  type IdentityLoginThrottleRecord,
  type IdentityOneTimeTokenRecord,
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
  created_at: Date | string;
}

interface MembershipTenantRow extends QueryResultRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  scopes: unknown;
  created_at: Date | string;
  tenant_slug: string;
  tenant_name: string;
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
            createdAt: input.user.createdAt,
          };
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: "owner",
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
          tenant = mapTenant(invitedTenant);
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: invite.role,
            scopes: parseScopes(invite.scopes),
          };
        } else {
          membership = {
            ...input.ownerMembership,
            tenantId: tenant.id,
            userId: input.user.id,
            role: "owner",
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
            `INSERT INTO ${IDENTITY_TENANTS_TABLE} (id, slug, name, created_at)
             VALUES ($1, $2, $3, $4)`,
            [tenant.id, tenant.slug, tenant.name, tenant.createdAt],
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
             (id, tenant_id, user_id, role, scopes, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
          [
            membership.id,
            membership.tenantId,
            membership.userId,
            membership.role,
            JSON.stringify(membership.scopes),
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

  async createInvite(invite: IdentityInviteRecord): Promise<void> {
    await this.client.transaction(async (tx) => {
      const actor = await tx.get<{ ok: boolean }>(
        `SELECT true AS ok FROM ${IDENTITY_MEMBERSHIPS_TABLE}
         WHERE tenant_id = $1 AND user_id = $2 AND role IN ('owner', 'admin')`,
        [invite.tenantId, invite.createdByUserId],
      );
      if (actor === null) throw lifecycleFailure("forbidden", "access denied", 403);
      await tx.execute(
        `INSERT INTO ${IDENTITY_INVITES_TABLE}
           (id, tenant_id, token_hash, identifier_kind, normalized_identifier,
            role, scopes, expires_at, created_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
        [
          invite.id,
          invite.tenantId,
          invite.tokenHash,
          invite.identifierKind ?? null,
          invite.normalizedIdentifier ?? null,
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
      const context = await tx.get<{ ok: boolean }>(
        `SELECT true AS ok
         FROM ${IDENTITY_USERS_TABLE} u
         JOIN ${IDENTITY_MEMBERSHIPS_TABLE} m
           ON m.user_id = u.id AND m.tenant_id = $2
         WHERE u.id = $1 AND u.status = 'active'`,
        [input.family.userId, input.family.tenantId],
      );
      if (context === null) throw lifecycleFailure("invalid_credentials", "authentication failed", 401);
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
           t.created_at AS tenant_created_at,
           m.id AS membership_id,
           m.role AS membership_role,
           m.scopes AS membership_scopes,
           m.created_at AS membership_created_at
         FROM ${IDENTITY_USERS_TABLE} u
         JOIN ${IDENTITY_MEMBERSHIPS_TABLE} m
           ON m.user_id = u.id AND m.tenant_id = $2
         JOIN ${IDENTITY_TENANTS_TABLE} t ON t.id = m.tenant_id
         WHERE u.id = $1`,
        [row.user_id, row.tenant_id],
      );
      if (context === null || context.status !== "active") return { kind: "invalid" };
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
        `UPDATE ${IDENTITY_SESSION_FAMILIES_TABLE} SET updated_at = $2 WHERE id = $1`,
        [row.family_id, input.now.toISOString()],
      );
      return {
        kind: "rotated",
        family: {
          id: row.family_id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          scopes: parseScopes(row.family_scopes),
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
          createdAt: iso(context.tenant_created_at),
        },
        membership: {
          id: context.membership_id,
          tenantId: context.tenant_id,
          userId: context.id,
          role: context.membership_role,
          scopes: parseScopes(context.membership_scopes),
          createdAt: iso(context.membership_created_at),
        },
      };
    });
  }

  async revokeSessionFamily(familyId: string, reason: string, now: Date): Promise<void> {
    await this.client.transaction((tx) => revokeFamily(tx, familyId, reason, now));
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

  async canAdminister(actorUserId: string, tenantId: string, targetUserId: string): Promise<boolean> {
    const row = await this.client.get<{ ok: boolean }>(
      `SELECT true AS ok
       FROM ${IDENTITY_MEMBERSHIPS_TABLE} actor
       JOIN ${IDENTITY_MEMBERSHIPS_TABLE} target
         ON target.tenant_id = actor.tenant_id
        AND target.user_id = $3
       WHERE actor.user_id = $1
         AND actor.tenant_id = $2
         AND actor.role IN ('owner', 'admin')`,
      [actorUserId, tenantId, targetUserId],
    );
    return row !== null;
  }

  async setUserStatus(
    userId: string,
    status: "active" | "disabled" | "deleted",
    now: Date,
  ): Promise<IdentityUserRecord | null> {
    const rows = await this.client.many<UserRow>(
      `UPDATE ${IDENTITY_USERS_TABLE}
       SET status = $2,
           updated_at = $3,
           disabled_at = CASE WHEN $2 = 'disabled' THEN $3 ELSE NULL END,
           deleted_at = CASE WHEN $2 = 'deleted' THEN $3 ELSE NULL END
       WHERE id = $1
       RETURNING *`,
      [userId, status, now.toISOString()],
    );
    return rows[0] === undefined ? null : mapUser(rows[0]);
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
    const row = await this.client.get<{ status: SessionFamilyStatusRow }>(
      `SELECT status FROM ${IDENTITY_SESSION_FAMILIES_TABLE} WHERE session_hash = $1`,
      [requireSha256(sessionSha256)],
    );
    if (row === null) return "unknown";
    if (row.status === "active") return "active";
    if (row.status === "disabled") return "disabled";
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
    createdAt: iso(row.created_at),
  };
}

function mapThrottle(row: ThrottleRow): IdentityLoginThrottleRecord {
  return {
    keyHash: row.key_hash,
    failures: Number(row.failures),
    windowStartedAt: iso(row.window_started_at),
    ...(row.locked_until === null ? {} : { lockedUntil: iso(row.locked_until) }),
  };
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
