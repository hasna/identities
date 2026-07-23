import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  IdentityAccessTokenVerifier,
  IdentityAuthError,
  IdentityAccessTokenIssuer,
  hashOpaqueClaim,
  type IdentityAccessTokenClaims,
  type IdentitySessionFamilyStatus,
  type IdentityTokenStateStore,
} from "./identity-auth.js";
import { checksumSql } from "./generated/storage-kit/migrations.js";

export const IDENTITY_USER_LIFECYCLE_SCHEMA_VERSION = "hasna.identity-user-lifecycle/v1" as const;
export const IDENTITY_USERS_TABLE = "identity_users";
export const IDENTITY_TENANTS_TABLE = "identity_tenants";
export const IDENTITY_MEMBERSHIPS_TABLE = "identity_memberships";
export const IDENTITY_LOGIN_IDENTIFIERS_TABLE = "identity_login_identifiers";
export const IDENTITY_PASSWORD_CREDENTIALS_TABLE = "identity_password_credentials";
export const IDENTITY_INVITES_TABLE = "identity_invites";
export const IDENTITY_SESSION_FAMILIES_TABLE = "identity_session_families";
export const IDENTITY_REFRESH_TOKENS_TABLE = "identity_refresh_tokens";
export const IDENTITY_JTI_REVOCATIONS_TABLE = "identity_jti_revocations";
export const IDENTITY_ONE_TIME_TOKENS_TABLE = "identity_one_time_tokens";
export const IDENTITY_LOGIN_THROTTLE_TABLE = "identity_login_throttle";

export type RegistrationPolicy = "disabled" | "invite" | "open";
export type LoginIdentifierKind = "email" | "username";
export type IdentityUserStatus = "active" | "disabled" | "deleted";
export type IdentityMembershipRole = "owner" | "admin" | "member";
export type SessionFamilyStatus = "active" | "revoked" | "disabled" | "deleted";
export type OneTimeTokenKind = "verification" | "recovery";

export interface LoginIdentifierInput {
  kind: LoginIdentifierKind;
  value: string;
}

export interface IdentityUserRecord {
  id: string;
  status: IdentityUserStatus;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  disabledAt?: string;
  deletedAt?: string;
}

export interface IdentityTenantRecord {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface IdentityMembershipRecord {
  id: string;
  tenantId: string;
  userId: string;
  role: IdentityMembershipRole;
  scopes: string[];
  createdAt: string;
}

export interface IdentityLoginIdentifierRecord {
  id: string;
  userId: string;
  kind: LoginIdentifierKind;
  normalizedValue: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface IdentityPasswordCredentialRecord {
  id: string;
  userId: string;
  passwordHash: string;
  algorithm: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityInviteRecord {
  id: string;
  tenantId: string;
  tokenHash: string;
  identifierKind?: LoginIdentifierKind;
  normalizedIdentifier?: string;
  role: IdentityMembershipRole;
  scopes: string[];
  expiresAt: string;
  consumedAt?: string;
  consumedByUserId?: string;
  createdByUserId: string;
  createdAt: string;
}

export interface IdentitySessionFamilyRecord {
  id: string;
  userId: string;
  tenantId: string;
  scopes: string[];
  status: SessionFamilyStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface IdentityRefreshTokenRecord {
  id: string;
  familyId: string;
  tokenHash: string;
  generation: number;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface IdentityOneTimeTokenRecord {
  id: string;
  userId: string;
  identifierId?: string;
  kind: OneTimeTokenKind;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
}

export interface IdentityLoginThrottleRecord {
  keyHash: string;
  failures: number;
  windowStartedAt: string;
  lockedUntil?: string;
}

export interface IdentityJtiRevocationRecord {
  jtiHash: string;
  userId: string;
  expiresAt: string;
  revokedAt: string;
}

export interface IdentityLifecycleSnapshot {
  users: IdentityUserRecord[];
  tenants: IdentityTenantRecord[];
  memberships: IdentityMembershipRecord[];
  loginIdentifiers: IdentityLoginIdentifierRecord[];
  credentials: IdentityPasswordCredentialRecord[];
  invites: IdentityInviteRecord[];
  sessionFamilies: IdentitySessionFamilyRecord[];
  refreshTokens: IdentityRefreshTokenRecord[];
  oneTimeTokens: IdentityOneTimeTokenRecord[];
  loginThrottles: IdentityLoginThrottleRecord[];
  jtiRevocations: IdentityJtiRevocationRecord[];
}

export interface IdentityAuthSession {
  schemaVersion: typeof IDENTITY_USER_LIFECYCLE_SCHEMA_VERSION;
  user: IdentityUserRecord;
  tenant: IdentityTenantRecord;
  membership: IdentityMembershipRecord;
  scopes: string[];
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface IdentityPasswordHasher {
  readonly algorithm: string;
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  dummyHash(): Promise<string>;
}

export interface IdentityLifecycleHooks {
  deliverVerification?: (input: {
    userId: string;
    identifier: LoginIdentifierInput;
    token: string;
    expiresAt: string;
  }) => void | Promise<void>;
  deliverRecovery?: (input: {
    userId: string;
    identifier: LoginIdentifierInput;
    token: string;
    expiresAt: string;
  }) => void | Promise<void>;
  userDisabled?: (input: { userId: string; at: string }) => void | Promise<void>;
  userDeleted?: (input: { userId: string; at: string }) => void | Promise<void>;
  userRestored?: (input: { userId: string; at: string }) => void | Promise<void>;
}

export class IdentityLifecycleError extends Error {
  constructor(
    readonly reason:
      | "invalid_request"
      | "registration_disabled"
      | "duplicate_identifier"
      | "bootstrap_complete"
      | "invite_invalid"
      | "invalid_credentials"
      | "rate_limited"
      | "invalid_scope"
      | "refresh_invalid"
      | "refresh_replay"
      | "verification_invalid"
      | "recovery_invalid"
      | "forbidden"
      | "not_found"
      | "invalid_configuration",
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 500,
  ) {
    super(message);
    this.name = "IdentityLifecycleError";
  }
}

export class Argon2idIdentityPasswordHasher implements IdentityPasswordHasher {
  readonly algorithm = "argon2id";
  private readonly memoryCost: number;
  private readonly timeCost: number;
  private dummyHashPromise?: Promise<string>;

  constructor(options: { memoryCost?: number; timeCost?: number } = {}) {
    this.memoryCost = boundedInteger(options.memoryCost ?? 65_536, "memoryCost", 32_768, 1_048_576);
    this.timeCost = boundedInteger(options.timeCost ?? 3, "timeCost", 2, 10);
  }

  hash(password: string): Promise<string> {
    validatePassword(password);
    return Bun.password.hash(password, {
      algorithm: "argon2id",
      memoryCost: this.memoryCost,
      timeCost: this.timeCost,
    });
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    if (typeof password !== "string" || typeof encoded !== "string") return false;
    try {
      return await Bun.password.verify(password, encoded, "argon2id");
    } catch {
      return false;
    }
  }

  dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hash(randomToken());
    return this.dummyHashPromise;
  }
}

export interface RegistrationMutation {
  bootstrapOnly: boolean;
  policy: RegistrationPolicy;
  bootstrapTenant: { slug: string; name: string };
  user: IdentityUserRecord;
  identifier: IdentityLoginIdentifierRecord;
  credential: IdentityPasswordCredentialRecord;
  inviteTokenHash?: string;
  personalTenant: IdentityTenantRecord;
  ownerMembership: IdentityMembershipRecord;
  verification: IdentityOneTimeTokenRecord;
}

export interface RegistrationResult {
  user: IdentityUserRecord;
  tenant: IdentityTenantRecord;
  membership: IdentityMembershipRecord;
  identifier: IdentityLoginIdentifierRecord;
}

export interface LoginCandidate {
  user: IdentityUserRecord;
  identifier: IdentityLoginIdentifierRecord;
  credential: IdentityPasswordCredentialRecord;
  memberships: IdentityMembershipRecord[];
  tenants: IdentityTenantRecord[];
}

export interface CreateSessionMutation {
  family: IdentitySessionFamilyRecord;
  refresh: IdentityRefreshTokenRecord;
}

export type RefreshRotationResult =
  | {
      kind: "rotated";
      family: IdentitySessionFamilyRecord;
      user: IdentityUserRecord;
      tenant: IdentityTenantRecord;
      membership: IdentityMembershipRecord;
    }
  | { kind: "replay" }
  | { kind: "invalid" };

export interface IdentityLifecycleStore extends IdentityTokenStateStore {
  register(input: RegistrationMutation): Promise<RegistrationResult>;
  findLoginCandidate(kind: LoginIdentifierKind, normalizedValue: string): Promise<LoginCandidate | null>;
  getLoginThrottle(keyHash: string, now: Date): Promise<IdentityLoginThrottleRecord | null>;
  recordLoginFailure(
    keyHash: string,
    now: Date,
    policy: { maxFailures: number; windowSeconds: number; lockSeconds: number },
  ): Promise<void>;
  clearLoginFailures(keyHash: string): Promise<void>;
  createInvite(invite: IdentityInviteRecord): Promise<void>;
  createSession(input: CreateSessionMutation): Promise<void>;
  rotateRefreshToken(input: {
    currentTokenHash: string;
    replacement: IdentityRefreshTokenRecord;
    now: Date;
  }): Promise<RefreshRotationResult>;
  revokeSessionFamily(familyId: string, reason: string, now: Date): Promise<void>;
  revokeAllUserSessions(userId: string, reason: string, now: Date): Promise<void>;
  revokeJti(input: IdentityJtiRevocationRecord): Promise<void>;
  canAdminister(actorUserId: string, tenantId: string, targetUserId: string): Promise<boolean>;
  setUserStatus(userId: string, status: IdentityUserStatus, now: Date): Promise<IdentityUserRecord | null>;
  createOneTimeToken(token: IdentityOneTimeTokenRecord): Promise<void>;
  consumeVerification(tokenHash: string, now: Date): Promise<boolean>;
  completeRecovery(input: {
    tokenHash: string;
    passwordHash: string;
    algorithm: string;
    now: Date;
  }): Promise<string | null>;
}

function emptySnapshot(): IdentityLifecycleSnapshot {
  return {
    users: [],
    tenants: [],
    memberships: [],
    loginIdentifiers: [],
    credentials: [],
    invites: [],
    sessionFamilies: [],
    refreshTokens: [],
    oneTimeTokens: [],
    loginThrottles: [],
    jtiRevocations: [],
  };
}

export class InMemoryIdentityLifecycleStore implements IdentityLifecycleStore {
  private readonly state = emptySnapshot();
  private tail: Promise<void> = Promise.resolve();

  snapshot(): IdentityLifecycleSnapshot {
    return structuredClone(this.state);
  }

  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    let release = () => {};
    const predecessor = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async register(input: RegistrationMutation): Promise<RegistrationResult> {
    return this.exclusive(() => {
      if (
        this.state.loginIdentifiers.some(
          (identifier) =>
            identifier.kind === input.identifier.kind &&
            identifier.normalizedValue === input.identifier.normalizedValue,
        )
      ) {
        throw lifecycleError("duplicate_identifier");
      }

      const isFirstUser = this.state.users.length === 0;
      if (input.bootstrapOnly && !isFirstUser) throw lifecycleError("bootstrap_complete");
      if (!input.bootstrapOnly && input.policy === "disabled") throw lifecycleError("registration_disabled");
      if (!input.bootstrapOnly && isFirstUser && input.policy === "invite") {
        throw lifecycleError("invite_invalid");
      }

      let tenant: IdentityTenantRecord;
      let membership: IdentityMembershipRecord;
      let invite: IdentityInviteRecord | undefined;
      if (isFirstUser) {
        tenant = {
          id: `ten_${randomUUID()}`,
          slug: normalizeTenantSlug(input.bootstrapTenant.slug),
          name: requiredText(input.bootstrapTenant.name, "bootstrap tenant name", 160),
          createdAt: input.user.createdAt,
        };
        membership = {
          ...input.ownerMembership,
          tenantId: tenant.id,
          userId: input.user.id,
          role: "owner",
        };
      } else if (input.policy === "invite" && !input.bootstrapOnly) {
        invite = this.state.invites.find((candidate) => candidate.tokenHash === input.inviteTokenHash);
        if (
          invite === undefined ||
          invite.consumedAt !== undefined ||
          new Date(invite.expiresAt).getTime() <= new Date(input.user.createdAt).getTime() ||
          (invite.identifierKind !== undefined &&
            (invite.identifierKind !== input.identifier.kind ||
              invite.normalizedIdentifier !== input.identifier.normalizedValue))
        ) {
          throw lifecycleError("invite_invalid");
        }
        const invitedTenant = this.state.tenants.find((candidate) => candidate.id === invite!.tenantId);
        if (invitedTenant === undefined) throw lifecycleError("invite_invalid");
        tenant = invitedTenant;
        membership = {
          ...input.ownerMembership,
          tenantId: tenant.id,
          userId: input.user.id,
          role: invite.role,
          scopes: [...invite.scopes],
        };
      } else {
        tenant = input.personalTenant;
        membership = {
          ...input.ownerMembership,
          tenantId: tenant.id,
          userId: input.user.id,
          role: "owner",
        };
      }

      this.state.users.push(input.user);
      this.state.loginIdentifiers.push(input.identifier);
      this.state.credentials.push(input.credential);
      if (!this.state.tenants.some((candidate) => candidate.id === tenant.id)) {
        if (this.state.tenants.some((candidate) => candidate.slug === tenant.slug)) {
          throw lifecycleError("duplicate_identifier");
        }
        this.state.tenants.push(tenant);
      }
      this.state.memberships.push(membership);
      this.state.oneTimeTokens.push(input.verification);
      if (invite !== undefined) {
        invite.consumedAt = input.user.createdAt;
        invite.consumedByUserId = input.user.id;
      }
      return structuredClone({ user: input.user, tenant, membership, identifier: input.identifier });
    });
  }

  async findLoginCandidate(
    kind: LoginIdentifierKind,
    normalizedValue: string,
  ): Promise<LoginCandidate | null> {
    return this.exclusive(() => {
      const identifier = this.state.loginIdentifiers.find(
        (candidate) => candidate.kind === kind && candidate.normalizedValue === normalizedValue,
      );
      if (identifier === undefined) return null;
      const user = this.state.users.find((candidate) => candidate.id === identifier.userId);
      const credential = this.state.credentials.find((candidate) => candidate.userId === identifier.userId);
      if (user === undefined || credential === undefined) return null;
      const memberships = this.state.memberships.filter((candidate) => candidate.userId === user.id);
      const tenantIds = new Set(memberships.map((membership) => membership.tenantId));
      const tenants = this.state.tenants.filter((tenant) => tenantIds.has(tenant.id));
      return structuredClone({ user, identifier, credential, memberships, tenants });
    });
  }

  async getLoginThrottle(keyHash: string, now: Date): Promise<IdentityLoginThrottleRecord | null> {
    return this.exclusive(() => {
      const throttle = this.state.loginThrottles.find((candidate) => candidate.keyHash === keyHash);
      if (throttle === undefined) return null;
      if (throttle.lockedUntil !== undefined && new Date(throttle.lockedUntil) <= now) {
        this.state.loginThrottles = this.state.loginThrottles.filter(
          (candidate) => candidate.keyHash !== keyHash,
        );
        return null;
      }
      return structuredClone(throttle);
    });
  }

  async recordLoginFailure(
    keyHash: string,
    now: Date,
    policy: { maxFailures: number; windowSeconds: number; lockSeconds: number },
  ): Promise<void> {
    await this.exclusive(() => {
      const current = this.state.loginThrottles.find((candidate) => candidate.keyHash === keyHash);
      const windowCutoff = now.getTime() - policy.windowSeconds * 1_000;
      if (current === undefined || new Date(current.windowStartedAt).getTime() < windowCutoff) {
        this.state.loginThrottles = this.state.loginThrottles.filter(
          (candidate) => candidate.keyHash !== keyHash,
        );
        this.state.loginThrottles.push({
          keyHash,
          failures: 1,
          windowStartedAt: now.toISOString(),
        });
        return;
      }
      current.failures += 1;
      if (current.failures >= policy.maxFailures) {
        current.lockedUntil = new Date(now.getTime() + policy.lockSeconds * 1_000).toISOString();
      }
    });
  }

  async clearLoginFailures(keyHash: string): Promise<void> {
    await this.exclusive(() => {
      this.state.loginThrottles = this.state.loginThrottles.filter(
        (candidate) => candidate.keyHash !== keyHash,
      );
    });
  }

  async createInvite(invite: IdentityInviteRecord): Promise<void> {
    await this.exclusive(() => {
      const tenant = this.state.tenants.find((candidate) => candidate.id === invite.tenantId);
      const actor = this.state.memberships.find(
        (membership) =>
          membership.tenantId === invite.tenantId &&
          membership.userId === invite.createdByUserId &&
          (membership.role === "owner" || membership.role === "admin"),
      );
      if (tenant === undefined || actor === undefined) throw lifecycleError("forbidden");
      this.state.invites.push(structuredClone(invite));
    });
  }

  async createSession(input: CreateSessionMutation): Promise<void> {
    await this.exclusive(() => {
      const user = this.state.users.find((candidate) => candidate.id === input.family.userId);
      const membership = this.state.memberships.find(
        (candidate) =>
          candidate.userId === input.family.userId && candidate.tenantId === input.family.tenantId,
      );
      if (user?.status !== "active" || membership === undefined) throw lifecycleError("invalid_credentials");
      this.state.sessionFamilies.push(structuredClone(input.family));
      this.state.refreshTokens.push(structuredClone(input.refresh));
    });
  }

  async rotateRefreshToken(input: {
    currentTokenHash: string;
    replacement: IdentityRefreshTokenRecord;
    now: Date;
  }): Promise<RefreshRotationResult> {
    return this.exclusive(() => {
      const current = this.state.refreshTokens.find(
        (candidate) => candidate.tokenHash === input.currentTokenHash,
      );
      if (current === undefined) return { kind: "invalid" };
      const family = this.state.sessionFamilies.find((candidate) => candidate.id === current.familyId);
      if (family === undefined) return { kind: "invalid" };
      if (current.usedAt !== undefined || current.revokedAt !== undefined) {
        if (family.status === "active") {
          revokeFamilyState(this.state, family, "refresh_replay", input.now);
        }
        return { kind: "replay" };
      }
      const user = this.state.users.find((candidate) => candidate.id === family.userId);
      const tenant = this.state.tenants.find((candidate) => candidate.id === family.tenantId);
      const membership = this.state.memberships.find(
        (candidate) => candidate.userId === family.userId && candidate.tenantId === family.tenantId,
      );
      if (
        family.status !== "active" ||
        user?.status !== "active" ||
        tenant === undefined ||
        membership === undefined ||
        new Date(current.expiresAt) <= input.now ||
        new Date(family.expiresAt) <= input.now
      ) {
        return { kind: "invalid" };
      }
      current.usedAt = input.now.toISOString();
      input.replacement.familyId = family.id;
      input.replacement.generation = current.generation + 1;
      if (new Date(input.replacement.expiresAt) > new Date(family.expiresAt)) {
        input.replacement.expiresAt = family.expiresAt;
      }
      this.state.refreshTokens.push(structuredClone(input.replacement));
      family.updatedAt = input.now.toISOString();
      return {
        kind: "rotated",
        family: structuredClone(family),
        user: structuredClone(user),
        tenant: structuredClone(tenant),
        membership: structuredClone(membership),
      };
    });
  }

  async revokeSessionFamily(familyId: string, reason: string, now: Date): Promise<void> {
    await this.exclusive(() => {
      const family = this.state.sessionFamilies.find((candidate) => candidate.id === familyId);
      if (family !== undefined) revokeFamilyState(this.state, family, reason, now);
    });
  }

  async revokeAllUserSessions(userId: string, reason: string, now: Date): Promise<void> {
    await this.exclusive(() => {
      for (const family of this.state.sessionFamilies) {
        if (family.userId === userId) revokeFamilyState(this.state, family, reason, now);
      }
    });
  }

  async revokeJti(input: IdentityJtiRevocationRecord): Promise<void> {
    await this.exclusive(() => {
      if (!this.state.jtiRevocations.some((candidate) => candidate.jtiHash === input.jtiHash)) {
        this.state.jtiRevocations.push(structuredClone(input));
      }
    });
  }

  async canAdminister(actorUserId: string, tenantId: string, targetUserId: string): Promise<boolean> {
    return this.exclusive(() => {
      const actor = this.state.memberships.find(
        (membership) =>
          membership.userId === actorUserId &&
          membership.tenantId === tenantId &&
          (membership.role === "owner" || membership.role === "admin"),
      );
      const target = this.state.memberships.find(
        (membership) => membership.userId === targetUserId && membership.tenantId === tenantId,
      );
      return actor !== undefined && target !== undefined;
    });
  }

  async setUserStatus(
    userId: string,
    status: IdentityUserStatus,
    now: Date,
  ): Promise<IdentityUserRecord | null> {
    return this.exclusive(() => {
      const user = this.state.users.find((candidate) => candidate.id === userId);
      if (user === undefined) return null;
      user.status = status;
      user.updatedAt = now.toISOString();
      if (status === "disabled") user.disabledAt = now.toISOString();
      if (status === "deleted") user.deletedAt = now.toISOString();
      if (status === "active") {
        delete user.disabledAt;
        delete user.deletedAt;
      }
      return structuredClone(user);
    });
  }

  async createOneTimeToken(token: IdentityOneTimeTokenRecord): Promise<void> {
    await this.exclusive(() => {
      for (const existing of this.state.oneTimeTokens) {
        if (
          existing.userId === token.userId &&
          existing.kind === token.kind &&
          existing.consumedAt === undefined
        ) {
          existing.consumedAt = token.createdAt;
        }
      }
      this.state.oneTimeTokens.push(structuredClone(token));
    });
  }

  async consumeVerification(tokenHash: string, now: Date): Promise<boolean> {
    return this.exclusive(() => {
      const token = this.state.oneTimeTokens.find(
        (candidate) => candidate.kind === "verification" && candidate.tokenHash === tokenHash,
      );
      if (
        token === undefined ||
        token.consumedAt !== undefined ||
        new Date(token.expiresAt) <= now ||
        token.identifierId === undefined
      ) {
        return false;
      }
      const identifier = this.state.loginIdentifiers.find(
        (candidate) => candidate.id === token.identifierId && candidate.userId === token.userId,
      );
      if (identifier === undefined) return false;
      token.consumedAt = now.toISOString();
      identifier.verifiedAt = now.toISOString();
      return true;
    });
  }

  async completeRecovery(input: {
    tokenHash: string;
    passwordHash: string;
    algorithm: string;
    now: Date;
  }): Promise<string | null> {
    return this.exclusive(() => {
      const token = this.state.oneTimeTokens.find(
        (candidate) => candidate.kind === "recovery" && candidate.tokenHash === input.tokenHash,
      );
      if (token === undefined || token.consumedAt !== undefined || new Date(token.expiresAt) <= input.now) {
        return null;
      }
      const user = this.state.users.find(
        (candidate) => candidate.id === token.userId && candidate.status === "active",
      );
      const credential = this.state.credentials.find((candidate) => candidate.userId === token.userId);
      if (user === undefined || credential === undefined) return null;
      token.consumedAt = input.now.toISOString();
      credential.passwordHash = input.passwordHash;
      credential.algorithm = input.algorithm;
      credential.updatedAt = input.now.toISOString();
      for (const family of this.state.sessionFamilies) {
        if (family.userId === user.id) revokeFamilyState(this.state, family, "password_recovery", input.now);
      }
      return user.id;
    });
  }

  async isJtiRevoked(jtiSha256: string): Promise<boolean> {
    const hash = requireSha256(jtiSha256);
    return this.exclusive(() => this.state.jtiRevocations.some((candidate) => candidate.jtiHash === hash));
  }

  async getSessionFamilyStatus(sessionSha256: string): Promise<IdentitySessionFamilyStatus> {
    const hash = requireSha256(sessionSha256);
    return this.exclusive(() => {
      const family = this.state.sessionFamilies.find(
        (candidate) => hashOpaqueClaim(candidate.id) === hash,
      );
      if (family === undefined) return "unknown";
      if (family.status === "active") return "active";
      if (family.status === "disabled") return "disabled";
      return "deleted";
    });
  }
}

export interface IdentityLifecycleServiceOptions {
  store: IdentityLifecycleStore;
  registrationPolicy: RegistrationPolicy;
  bootstrapTenant: { slug: string; name: string };
  tokenIssuer: IdentityAccessTokenIssuer;
  tokenVerifier: IdentityAccessTokenVerifier;
  passwordHasher?: IdentityPasswordHasher;
  defaultScopes: readonly string[];
  now?: () => Date;
  hooks?: IdentityLifecycleHooks;
  refreshTokenTtlSeconds?: number;
  inviteTtlSeconds?: number;
  verificationTtlSeconds?: number;
  recoveryTtlSeconds?: number;
  loginThrottle?: {
    maxFailures: number;
    windowSeconds: number;
    lockSeconds: number;
  };
}

export class IdentityLifecycleService {
  private readonly store: IdentityLifecycleStore;
  private readonly registrationPolicy: RegistrationPolicy;
  private readonly bootstrapTenant: { slug: string; name: string };
  private readonly tokenIssuer: IdentityAccessTokenIssuer;
  private readonly tokenVerifier: IdentityAccessTokenVerifier;
  private readonly passwordHasher: IdentityPasswordHasher;
  private readonly defaultScopes: string[];
  private readonly now: () => Date;
  private readonly hooks: IdentityLifecycleHooks;
  private readonly refreshTokenTtlSeconds: number;
  private readonly inviteTtlSeconds: number;
  private readonly verificationTtlSeconds: number;
  private readonly recoveryTtlSeconds: number;
  private readonly loginThrottle: {
    maxFailures: number;
    windowSeconds: number;
    lockSeconds: number;
  };

  constructor(options: IdentityLifecycleServiceOptions) {
    this.store = options.store;
    this.registrationPolicy = normalizeRegistrationPolicy(options.registrationPolicy);
    this.bootstrapTenant = {
      slug: normalizeTenantSlug(options.bootstrapTenant.slug),
      name: requiredText(options.bootstrapTenant.name, "bootstrap tenant name", 160),
    };
    this.tokenIssuer = options.tokenIssuer;
    this.tokenVerifier = options.tokenVerifier;
    if (!options.tokenVerifier.isBoundToJwksRegistry(options.tokenIssuer.registry)) {
      throw lifecycleError("invalid_configuration");
    }
    this.passwordHasher = options.passwordHasher ?? new Argon2idIdentityPasswordHasher();
    this.defaultScopes = normalizeScopes(options.defaultScopes);
    if (this.defaultScopes.length === 0) {
      throw new IdentityLifecycleError(
        "invalid_configuration",
        "default scopes cannot be empty",
        500,
      );
    }
    this.now = options.now ?? (() => new Date());
    this.hooks = options.hooks ?? {};
    this.refreshTokenTtlSeconds = boundedInteger(
      options.refreshTokenTtlSeconds ?? 2_592_000,
      "refreshTokenTtlSeconds",
      300,
      31_536_000,
    );
    this.inviteTtlSeconds = boundedInteger(options.inviteTtlSeconds ?? 86_400, "inviteTtlSeconds", 60, 2_592_000);
    this.verificationTtlSeconds = boundedInteger(
      options.verificationTtlSeconds ?? 86_400,
      "verificationTtlSeconds",
      60,
      604_800,
    );
    this.recoveryTtlSeconds = boundedInteger(
      options.recoveryTtlSeconds ?? 1_800,
      "recoveryTtlSeconds",
      60,
      86_400,
    );
    this.loginThrottle = {
      maxFailures: boundedInteger(options.loginThrottle?.maxFailures ?? 8, "maxFailures", 2, 100),
      windowSeconds: boundedInteger(options.loginThrottle?.windowSeconds ?? 900, "windowSeconds", 60, 86_400),
      lockSeconds: boundedInteger(options.loginThrottle?.lockSeconds ?? 900, "lockSeconds", 60, 86_400),
    };
  }

  bootstrapFirstAdmin(input: {
    identifier: LoginIdentifierInput;
    password: string;
    displayName: string;
  }): Promise<IdentityAuthSession> {
    return this.register(input, true);
  }

  signup(input: {
    identifier: LoginIdentifierInput;
    password: string;
    displayName: string;
    inviteToken?: string;
  }): Promise<IdentityAuthSession> {
    return this.register(input, false);
  }

  private async register(
    input: {
      identifier: LoginIdentifierInput;
      password: string;
      displayName: string;
      inviteToken?: string;
    },
    bootstrapOnly: boolean,
  ): Promise<IdentityAuthSession> {
    if (!bootstrapOnly && this.registrationPolicy === "disabled") {
      throw lifecycleError("registration_disabled");
    }
    const now = this.now();
    const normalized = normalizeLoginIdentifier(input.identifier);
    validatePassword(input.password);
    const passwordHash = await this.passwordHasher.hash(input.password);
    const userId = `usr_${randomUUID()}`;
    const verificationToken = randomToken();
    const user: IdentityUserRecord = {
      id: userId,
      status: "active",
      displayName: requiredText(input.displayName, "displayName", 160),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const identifier: IdentityLoginIdentifierRecord = {
      id: `lid_${randomUUID()}`,
      userId,
      kind: normalized.kind,
      normalizedValue: normalized.value,
      createdAt: now.toISOString(),
    };
    const credential: IdentityPasswordCredentialRecord = {
      id: `pwd_${randomUUID()}`,
      userId,
      passwordHash,
      algorithm: this.passwordHasher.algorithm,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const personalTenant: IdentityTenantRecord = {
      id: `ten_${randomUUID()}`,
      slug: `personal-${userId.slice(4, 16).toLowerCase()}`,
      name: `${user.displayName}'s workspace`,
      createdAt: now.toISOString(),
    };
    const ownerMembership: IdentityMembershipRecord = {
      id: `mem_${randomUUID()}`,
      tenantId: personalTenant.id,
      userId,
      role: "owner",
      scopes: [...this.defaultScopes],
      createdAt: now.toISOString(),
    };
    const verification: IdentityOneTimeTokenRecord = {
      id: `ott_${randomUUID()}`,
      userId,
      identifierId: identifier.id,
      kind: "verification",
      tokenHash: hashSecret(verificationToken),
      expiresAt: addSeconds(now, this.verificationTtlSeconds).toISOString(),
      createdAt: now.toISOString(),
    };
    const result = await this.store.register({
      bootstrapOnly,
      policy: this.registrationPolicy,
      bootstrapTenant: this.bootstrapTenant,
      user,
      identifier,
      credential,
      inviteTokenHash: input.inviteToken === undefined ? undefined : hashSecret(input.inviteToken),
      personalTenant,
      ownerMembership,
      verification,
    });
    if (this.hooks.deliverVerification !== undefined) {
      await this.hooks.deliverVerification({
        userId,
        identifier: { kind: normalized.kind, value: normalized.value },
        token: verificationToken,
        expiresAt: verification.expiresAt,
      });
    }
    return this.createSession(result);
  }

  async login(input: {
    identifier: LoginIdentifierInput;
    password: string;
    tenantId?: string;
    scopes?: readonly string[];
    throttleKey?: string;
  }): Promise<IdentityAuthSession> {
    const now = this.now();
    const normalized = normalizeLoginIdentifier(input.identifier);
    const throttleKey = hashSecret(
      `${normalized.kind}:${normalized.value}:${requiredText(input.throttleKey ?? "default", "throttleKey", 512)}`,
    );
    const throttle = await this.store.getLoginThrottle(throttleKey, now);
    if (throttle?.lockedUntil !== undefined && new Date(throttle.lockedUntil) > now) {
      throw lifecycleError("rate_limited");
    }

    const candidate = await this.store.findLoginCandidate(normalized.kind, normalized.value);
    const encoded = candidate?.credential.passwordHash ?? (await this.passwordHasher.dummyHash());
    const passwordValid = await this.passwordHasher.verify(input.password, encoded);
    if (candidate === null || !passwordValid || candidate.user.status !== "active") {
      await this.store.recordLoginFailure(throttleKey, now, this.loginThrottle);
      throw lifecycleError("invalid_credentials");
    }

    const membership = selectMembership(candidate, input.tenantId);
    if (membership === null) {
      await this.store.recordLoginFailure(throttleKey, now, this.loginThrottle);
      throw lifecycleError("invalid_credentials");
    }
    const tenant = candidate.tenants.find((item) => item.id === membership.tenantId);
    if (tenant === undefined) {
      await this.store.recordLoginFailure(throttleKey, now, this.loginThrottle);
      throw lifecycleError("invalid_credentials");
    }
    const scopes = input.scopes === undefined ? [...membership.scopes] : normalizeScopes(input.scopes);
    const allowed = new Set(membership.scopes);
    if (scopes.length === 0 || scopes.some((scope) => !allowed.has(scope))) {
      throw lifecycleError("invalid_scope");
    }
    await this.store.clearLoginFailures(throttleKey);
    return this.createSession({
      user: candidate.user,
      tenant,
      membership,
      identifier: candidate.identifier,
    }, scopes);
  }

  async createInvite(input: {
    actorAccessToken: string;
    tenantId: string;
    identifier?: LoginIdentifierInput;
    role: IdentityMembershipRole;
    scopes: readonly string[];
    expiresInSeconds?: number;
  }): Promise<{ id: string; token: string; expiresAt: string }> {
    const actor = await this.verifyAccessToken(input.actorAccessToken, {
      tenant: input.tenantId,
    });
    const token = randomToken();
    const now = this.now();
    const normalized = input.identifier === undefined ? undefined : normalizeLoginIdentifier(input.identifier);
    const expiresInSeconds = boundedInteger(
      input.expiresInSeconds ?? this.inviteTtlSeconds,
      "expiresInSeconds",
      60,
      2_592_000,
    );
    const invite: IdentityInviteRecord = {
      id: `inv_${randomUUID()}`,
      tenantId: input.tenantId,
      tokenHash: hashSecret(token),
      identifierKind: normalized?.kind,
      normalizedIdentifier: normalized?.value,
      role: normalizeRole(input.role),
      scopes: normalizeScopes(input.scopes),
      expiresAt: addSeconds(now, expiresInSeconds).toISOString(),
      createdByUserId: actor.sub,
      createdAt: now.toISOString(),
    };
    if (invite.scopes.length === 0) throw lifecycleError("invalid_scope");
    await this.store.createInvite(invite);
    return { id: invite.id, token, expiresAt: invite.expiresAt };
  }

  async refresh(input: { refreshToken: string }): Promise<IdentityAuthSession> {
    const currentTokenHash = hashSecret(requireOpaqueToken(input.refreshToken, "refresh token"));
    const now = this.now();
    const replacementToken = randomToken();
    const replacement: IdentityRefreshTokenRecord = {
      id: `rft_${randomUUID()}`,
      familyId: "pending",
      tokenHash: hashSecret(replacementToken),
      generation: 0,
      expiresAt: addSeconds(now, this.refreshTokenTtlSeconds).toISOString(),
      createdAt: now.toISOString(),
    };
    const rotated = await this.store.rotateRefreshToken({
      currentTokenHash,
      replacement,
      now,
    });
    if (rotated.kind === "replay") throw lifecycleError("refresh_replay");
    if (rotated.kind === "invalid") throw lifecycleError("refresh_invalid");
      const issue = await this.tokenIssuer.issue({
      subject: rotated.user.id,
      tenant: rotated.tenant.id,
      session: rotated.family.id,
      scopes: rotated.family.scopes,
      now,
    });
    return {
      schemaVersion: IDENTITY_USER_LIFECYCLE_SCHEMA_VERSION,
      user: rotated.user,
      tenant: rotated.tenant,
      membership: { ...rotated.membership, scopes: [...rotated.family.scopes] },
      scopes: [...rotated.family.scopes],
      accessToken: issue.token,
      accessTokenExpiresAt: new Date(issue.expiresAt * 1_000).toISOString(),
      refreshToken: replacementToken,
      refreshTokenExpiresAt: replacement.expiresAt,
    };
  }

  async logout(input: { accessToken: string; refreshToken?: string }): Promise<{ loggedOut: true }> {
    const claims = await this.verifyAccessToken(input.accessToken);
    const now = this.now();
    await this.store.revokeJti({
      jtiHash: hashOpaqueClaim(claims.jti),
      userId: claims.sub,
      expiresAt: new Date(claims.exp * 1_000).toISOString(),
      revokedAt: now.toISOString(),
    });
    await this.store.revokeSessionFamily(claims.session, "logout", now);
    return { loggedOut: true };
  }

  async logoutAll(input: { accessToken: string }): Promise<{ loggedOutAll: true }> {
    const claims = await this.verifyAccessToken(input.accessToken);
    await this.store.revokeAllUserSessions(claims.sub, "logout_all", this.now());
    return { loggedOutAll: true };
  }

  async disableUser(input: {
    actorAccessToken: string;
    userId: string;
  }): Promise<IdentityUserRecord> {
    const actor = await this.verifyAccessToken(input.actorAccessToken);
    if (!(await this.store.canAdminister(actor.sub, actor.tenant, input.userId))) {
      throw lifecycleError("forbidden");
    }
    const now = this.now();
    const user = await this.store.setUserStatus(requiredText(input.userId, "userId"), "disabled", now);
    if (user === null) throw lifecycleError("not_found");
    await this.store.revokeAllUserSessions(user.id, "user_disabled", now);
    await this.hooks.userDisabled?.({ userId: user.id, at: now.toISOString() });
    return user;
  }

  async softDeleteUser(input: {
    actorAccessToken: string;
    userId: string;
  }): Promise<IdentityUserRecord> {
    const actor = await this.verifyAccessToken(input.actorAccessToken);
    if (!(await this.store.canAdminister(actor.sub, actor.tenant, input.userId))) {
      throw lifecycleError("forbidden");
    }
    const now = this.now();
    const user = await this.store.setUserStatus(requiredText(input.userId, "userId"), "deleted", now);
    if (user === null) throw lifecycleError("not_found");
    await this.store.revokeAllUserSessions(user.id, "user_deleted", now);
    await this.hooks.userDeleted?.({ userId: user.id, at: now.toISOString() });
    return user;
  }

  async restoreUser(input: { userId: string }): Promise<IdentityUserRecord> {
    const now = this.now();
    const user = await this.store.setUserStatus(requiredText(input.userId, "userId"), "active", now);
    if (user === null) throw lifecycleError("not_found");
    await this.hooks.userRestored?.({ userId: user.id, at: now.toISOString() });
    return user;
  }

  async verifyIdentifier(input: { token: string }): Promise<{ verified: true }> {
    const verified = await this.store.consumeVerification(
      hashSecret(requireOpaqueToken(input.token, "verification token")),
      this.now(),
    );
    if (!verified) throw lifecycleError("verification_invalid");
    return { verified: true };
  }

  async beginRecovery(input: { identifier: LoginIdentifierInput }): Promise<{ accepted: true }> {
    const normalized = normalizeLoginIdentifier(input.identifier);
    const candidate = await this.store.findLoginCandidate(normalized.kind, normalized.value);
    if (candidate === null || candidate.user.status !== "active") return { accepted: true };
    const now = this.now();
    const token = randomToken();
    const record: IdentityOneTimeTokenRecord = {
      id: `ott_${randomUUID()}`,
      userId: candidate.user.id,
      identifierId: candidate.identifier.id,
      kind: "recovery",
      tokenHash: hashSecret(token),
      expiresAt: addSeconds(now, this.recoveryTtlSeconds).toISOString(),
      createdAt: now.toISOString(),
    };
    await this.store.createOneTimeToken(record);
    await this.hooks.deliverRecovery?.({
      userId: candidate.user.id,
      identifier: { kind: normalized.kind, value: normalized.value },
      token,
      expiresAt: record.expiresAt,
    });
    return { accepted: true };
  }

  async completeRecovery(input: {
    token: string;
    newPassword: string;
  }): Promise<{ recovered: true }> {
    validatePassword(input.newPassword);
    const passwordHash = await this.passwordHasher.hash(input.newPassword);
    const userId = await this.store.completeRecovery({
      tokenHash: hashSecret(requireOpaqueToken(input.token, "recovery token")),
      passwordHash,
      algorithm: this.passwordHasher.algorithm,
      now: this.now(),
    });
    if (userId === null) throw lifecycleError("recovery_invalid");
    return { recovered: true };
  }

  private async createSession(
    registration: RegistrationResult,
    scopes: readonly string[] = registration.membership.scopes,
  ): Promise<IdentityAuthSession> {
    const now = this.now();
    const family: IdentitySessionFamilyRecord = {
      id: `ses_${randomUUID()}`,
      userId: registration.user.id,
      tenantId: registration.tenant.id,
      scopes: [...scopes],
      status: "active",
      expiresAt: addSeconds(now, this.refreshTokenTtlSeconds).toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const refreshToken = randomToken();
    const refresh: IdentityRefreshTokenRecord = {
      id: `rft_${randomUUID()}`,
      familyId: family.id,
      tokenHash: hashSecret(refreshToken),
      generation: 0,
      expiresAt: family.expiresAt,
      createdAt: now.toISOString(),
    };
    await this.store.createSession({ family, refresh });
    const issue = await this.tokenIssuer.issue({
      subject: registration.user.id,
      tenant: registration.tenant.id,
      session: family.id,
      scopes,
      now,
    });
    return {
      schemaVersion: IDENTITY_USER_LIFECYCLE_SCHEMA_VERSION,
      user: registration.user,
      tenant: registration.tenant,
      membership: { ...registration.membership, scopes: [...scopes] },
      scopes: [...scopes],
      accessToken: issue.token,
      accessTokenExpiresAt: new Date(issue.expiresAt * 1_000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refresh.expiresAt,
    };
  }

  private async verifyAccessToken(
    token: string,
    requirements: { tenant?: string; scopes?: readonly string[] } = {},
  ): Promise<IdentityAccessTokenClaims> {
    try {
      return await this.tokenVerifier.verify(requireOpaqueToken(token, "access token"), requirements);
    } catch (error) {
      if (error instanceof IdentityAuthError) {
        throw new IdentityLifecycleError("forbidden", "access denied", error.status === 500 ? 500 : error.status);
      }
      throw lifecycleError("forbidden");
    }
  }
}

export const loginIdentifierSchema = z.object({
  kind: z.enum(["email", "username"]),
  value: z.string().min(1).max(320),
}).strict();

export const identitySignupSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(12).max(1_024),
  displayName: z.string().min(1).max(160),
  inviteToken: z.string().min(32).max(512).optional(),
}).strict();

export const identityLoginSchema = z.object({
  identifier: loginIdentifierSchema,
  password: z.string().min(1).max(1_024),
  tenantId: z.string().min(1).max(160).optional(),
  scopes: z.array(z.string().min(1).max(160)).max(100).optional(),
}).strict();

export const identityRefreshSchema = z.object({
  refreshToken: z.string().min(32).max(512),
}).strict();

export const identityRecoveryStartSchema = z.object({
  identifier: loginIdentifierSchema,
}).strict();

export const identityRecoveryCompleteSchema = z.object({
  token: z.string().min(32).max(512),
  newPassword: z.string().min(12).max(1_024),
}).strict();

export const identityVerificationSchema = z.object({
  token: z.string().min(32).max(512),
}).strict();

export interface IdentityLifecycleApi {
  handle(request: Request): Promise<Response>;
}

export function createIdentityLifecycleApi(options: {
  service: IdentityLifecycleService;
  throttleKey?: (request: Request) => string | undefined;
}): IdentityLifecycleApi {
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      try {
        if (request.method === "POST" && url.pathname === "/v1/auth/signup") {
          return lifecycleJson(await options.service.signup(identitySignupSchema.parse(await readJson(request))), 201);
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/login") {
          const input = identityLoginSchema.parse(await readJson(request));
          return lifecycleJson(await options.service.login({
            ...input,
            throttleKey: options.throttleKey?.(request),
          }));
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/refresh") {
          return lifecycleJson(await options.service.refresh(identityRefreshSchema.parse(await readJson(request))));
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
          return lifecycleJson(await options.service.logout({
            accessToken: bearerAccessToken(request),
          }));
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/logout-all") {
          return lifecycleJson(await options.service.logoutAll({
            accessToken: bearerAccessToken(request),
          }));
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/verification/complete") {
          return lifecycleJson(
            await options.service.verifyIdentifier(identityVerificationSchema.parse(await readJson(request))),
          );
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/recovery/start") {
          return lifecycleJson(
            await options.service.beginRecovery(identityRecoveryStartSchema.parse(await readJson(request))),
            202,
          );
        }
        if (request.method === "POST" && url.pathname === "/v1/auth/recovery/complete") {
          return lifecycleJson(
            await options.service.completeRecovery(identityRecoveryCompleteSchema.parse(await readJson(request))),
          );
        }
        return lifecycleJson({ error: "not_found" }, 404);
      } catch (error) {
        if (error instanceof IdentityLifecycleError) {
          return lifecycleJson({
            error: publicLifecycleError(error),
            reason: error.reason,
          }, error.status);
        }
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
          return lifecycleJson({ error: "invalid_request", reason: "invalid_request" }, 400);
        }
        return lifecycleJson({ error: "internal_error", reason: "invalid_configuration" }, 500);
      }
    },
  };
}

export interface IdentityLifecycleMigration {
  id: string;
  up: string;
  down: string;
  checksum: string;
}

export function identityLifecycleMigrations(): IdentityLifecycleMigration[] {
  const definitions = [
    {
      id: "identities_0004_user_tenancy",
      up: `
        CREATE TABLE IF NOT EXISTS identity_users (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('active','disabled','deleted')),
          display_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          disabled_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS identity_tenants (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identity_memberships (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES identity_tenants(id),
          user_id TEXT NOT NULL REFERENCES identity_users(id),
          role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
          scopes JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          UNIQUE (tenant_id, user_id)
        )`,
      down: `
        DROP TABLE IF EXISTS identity_memberships;
        DROP TABLE IF EXISTS identity_tenants;
        DROP TABLE IF EXISTS identity_users`,
    },
    {
      id: "identities_0005_user_credentials",
      up: `
        CREATE TABLE IF NOT EXISTS identity_login_identifiers (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES identity_users(id),
          kind TEXT NOT NULL CHECK (kind IN ('email','username')),
          normalized_value TEXT NOT NULL,
          verified_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL,
          UNIQUE (kind, normalized_value)
        );
        CREATE TABLE IF NOT EXISTS identity_password_credentials (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL UNIQUE REFERENCES identity_users(id),
          password_hash TEXT NOT NULL,
          algorithm TEXT NOT NULL CHECK (algorithm = 'argon2id'),
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identity_invites (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES identity_tenants(id),
          token_hash TEXT NOT NULL UNIQUE,
          identifier_kind TEXT,
          normalized_identifier TEXT,
          role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
          scopes JSONB NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ,
          consumed_by_user_id TEXT REFERENCES identity_users(id),
          created_by_user_id TEXT NOT NULL REFERENCES identity_users(id),
          created_at TIMESTAMPTZ NOT NULL
        )`,
      down: `
        DROP TABLE IF EXISTS identity_invites;
        DROP TABLE IF EXISTS identity_password_credentials;
        DROP TABLE IF EXISTS identity_login_identifiers`,
    },
    {
      id: "identities_0006_user_sessions",
      up: `
        CREATE TABLE IF NOT EXISTS identity_session_families (
          id TEXT PRIMARY KEY,
          session_hash TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL REFERENCES identity_users(id),
          tenant_id TEXT NOT NULL REFERENCES identity_tenants(id),
          scopes JSONB NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active','revoked','disabled','deleted')),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          revoke_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS identity_refresh_tokens (
          id TEXT PRIMARY KEY,
          family_id TEXT NOT NULL REFERENCES identity_session_families(id),
          token_hash TEXT NOT NULL UNIQUE,
          generation INTEGER NOT NULL CHECK (generation >= 0),
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS identity_jti_revocations (
          jti_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES identity_users(id),
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS identity_session_families_user_idx
          ON identity_session_families (user_id, status);
        CREATE INDEX IF NOT EXISTS identity_refresh_tokens_family_idx
          ON identity_refresh_tokens (family_id, generation DESC)`,
      down: `
        DROP TABLE IF EXISTS identity_jti_revocations;
        DROP TABLE IF EXISTS identity_refresh_tokens;
        DROP TABLE IF EXISTS identity_session_families`,
    },
    {
      id: "identities_0007_user_verification_recovery",
      up: `
        CREATE TABLE IF NOT EXISTS identity_one_time_tokens (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES identity_users(id),
          identifier_id TEXT REFERENCES identity_login_identifiers(id),
          kind TEXT NOT NULL CHECK (kind IN ('verification','recovery')),
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          consumed_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS identity_one_time_tokens_user_kind_idx
          ON identity_one_time_tokens (user_id, kind, created_at DESC)`,
      down: `DROP TABLE IF EXISTS identity_one_time_tokens`,
    },
    {
      id: "identities_0008_user_login_throttle",
      up: `
        CREATE TABLE IF NOT EXISTS identity_login_throttle (
          key_hash TEXT PRIMARY KEY,
          failures INTEGER NOT NULL CHECK (failures >= 0),
          window_started_at TIMESTAMPTZ NOT NULL,
          locked_until TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS identity_login_throttle_locked_idx
          ON identity_login_throttle (locked_until)`,
      down: `DROP TABLE IF EXISTS identity_login_throttle`,
    },
  ];
  return definitions.map((definition) => ({
    ...definition,
    up: definition.up.trim(),
    down: definition.down.trim(),
    checksum: checksumSql(definition.up),
  }));
}

function revokeFamilyState(
  state: IdentityLifecycleSnapshot,
  family: IdentitySessionFamilyRecord,
  reason: string,
  now: Date,
): void {
  if (family.status !== "active") return;
  family.status = "revoked";
  family.revokedAt = now.toISOString();
  family.updatedAt = now.toISOString();
  family.revokeReason = requiredText(reason, "revoke reason", 160);
  for (const refresh of state.refreshTokens) {
    if (refresh.familyId === family.id && refresh.revokedAt === undefined) {
      refresh.revokedAt = now.toISOString();
    }
  }
}

function selectMembership(
  candidate: LoginCandidate,
  tenantId: string | undefined,
): IdentityMembershipRecord | null {
  if (tenantId !== undefined) {
    return candidate.memberships.find((membership) => membership.tenantId === tenantId) ?? null;
  }
  if (candidate.memberships.length !== 1) return null;
  return candidate.memberships[0] ?? null;
}

function normalizeRegistrationPolicy(value: string): RegistrationPolicy {
  if (value === "disabled" || value === "invite" || value === "open") return value;
  throw new IdentityLifecycleError(
    "invalid_configuration",
    "registration policy must be disabled, invite, or open",
    500,
  );
}

function normalizeRole(value: IdentityMembershipRole): IdentityMembershipRole {
  if (value === "owner" || value === "admin" || value === "member") return value;
  throw lifecycleError("invalid_request");
}

export function normalizeLoginIdentifier(input: LoginIdentifierInput): LoginIdentifierInput {
  const kind = input.kind;
  if (kind !== "email" && kind !== "username") throw lifecycleError("invalid_request");
  const normalized = requiredText(input.value, "login identifier", 320).normalize("NFKC").toLowerCase();
  if (kind === "email") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw lifecycleError("invalid_request");
  } else if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalized)) {
    throw lifecycleError("invalid_request");
  }
  return { kind, value: normalized };
}

function normalizeTenantSlug(value: string): string {
  const normalized = requiredText(value, "tenant slug", 80).normalize("NFKC").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(normalized)) {
    throw lifecycleError("invalid_request");
  }
  return normalized;
}

function normalizeScopes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => requiredText(value, "scope", 160)))].sort();
}

function validatePassword(password: string): void {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1_024 ||
    password.trim().length < 12
  ) {
    throw lifecycleError("invalid_request");
  }
}

function requireOpaqueToken(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 16_384 ||
    /\s/.test(value)
  ) {
    throw lifecycleError("invalid_request");
  }
  return value;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw lifecycleError("invalid_request");
  return value;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new IdentityLifecycleError(
      "invalid_configuration",
      `${label} must be an integer between ${minimum} and ${maximum}`,
      500,
    );
  }
  return value;
}

function requiredText(value: unknown, label: string, maximum = 1_024): string {
  if (typeof value !== "string") throw lifecycleError("invalid_request");
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw lifecycleError("invalid_request");
  }
  return normalized;
}

function lifecycleError(reason: IdentityLifecycleError["reason"]): IdentityLifecycleError {
  switch (reason) {
    case "registration_disabled":
      return new IdentityLifecycleError(reason, "registration is not available", 403);
    case "duplicate_identifier":
      return new IdentityLifecycleError(reason, "registration could not be completed", 409);
    case "bootstrap_complete":
      return new IdentityLifecycleError(reason, "initial administrator already exists", 409);
    case "invite_invalid":
      return new IdentityLifecycleError(reason, "invite is invalid or expired", 400);
    case "invalid_credentials":
      return new IdentityLifecycleError(reason, "authentication failed", 401);
    case "rate_limited":
      return new IdentityLifecycleError(reason, "authentication temporarily unavailable", 429);
    case "invalid_scope":
      return new IdentityLifecycleError(reason, "requested scope is not allowed", 403);
    case "refresh_invalid":
    case "refresh_replay":
      return new IdentityLifecycleError(reason, "session refresh failed", 401);
    case "verification_invalid":
      return new IdentityLifecycleError(reason, "verification token is invalid or expired", 400);
    case "recovery_invalid":
      return new IdentityLifecycleError(reason, "recovery token is invalid or expired", 400);
    case "forbidden":
      return new IdentityLifecycleError(reason, "access denied", 403);
    case "not_found":
      return new IdentityLifecycleError(reason, "record not found", 404);
    case "invalid_configuration":
      return new IdentityLifecycleError(reason, "identity lifecycle is not configured", 500);
    default:
      return new IdentityLifecycleError("invalid_request", "request is invalid", 400);
  }
}

function publicLifecycleError(error: IdentityLifecycleError): string {
  if (error.reason === "invalid_credentials") return "authentication_failed";
  if (error.reason === "refresh_invalid" || error.reason === "refresh_replay") return "session_refresh_failed";
  if (error.reason === "duplicate_identifier") return "registration_failed";
  return error.reason;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length === 0 || text.length > 65_536) throw lifecycleError("invalid_request");
  return JSON.parse(text);
}

function bearerAccessToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  if (match === null) throw lifecycleError("forbidden");
  return match[1]!;
}

function lifecycleJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      "x-content-type-options": "nosniff",
    },
  });
}
