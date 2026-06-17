export const identityDocumentKeys = [
  "bio",
  "prompt",
  "soul",
  "personality",
  "ethos",
  "capabilities",
  "boundaries",
  "tools",
  "relationships",
  "goals",
  "context",
  "memory",
  "consent",
  "voice",
] as const;

export type IdentityDocumentKey = (typeof identityDocumentKeys)[number];

export type IdentityKind = "human" | "agent" | "organization" | "service";

export type VerificationStatus = "unverified" | "pending" | "verified" | "revoked";

export type SyncStatus = "local" | "pending" | "synced" | "failed";

export interface SyncRef {
  provider: string;
  externalId?: string;
  status: SyncStatus;
  syncedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface IdentityIdentifier {
  scheme: string;
  value: string;
  issuer?: string;
  country?: string;
  sensitive?: boolean;
  status?: VerificationStatus;
  issuedAt?: string;
  expiresAt?: string;
}

export interface EmailAddress {
  address: string;
  label?: string;
  primary?: boolean;
  verified?: boolean;
  maileryId?: string;
  sync?: SyncRef;
}

export interface PhoneNumber {
  number: string;
  label?: string;
  primary?: boolean;
  verified?: boolean;
  telephonyId?: string;
  sync?: SyncRef;
}

export type IdentityDocumentSet = Partial<Record<IdentityDocumentKey, string>> & Record<string, string | undefined>;

export interface Identity {
  id: string;
  kind: IdentityKind;
  fullName: string;
  displayName?: string;
  uniqueIdentifier: IdentityIdentifier;
  identifiers: IdentityIdentifier[];
  emails: EmailAddress[];
  phones: PhoneNumber[];
  documents: IdentityDocumentSet;
  agent?: AgentProfile;
  traits: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  role?: string;
  model?: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  channels: string[];
  schedules: string[];
  subagents: string[];
  identityProvider?: string;
}

export interface CreateIdentityInput {
  id?: string;
  kind: IdentityKind;
  fullName: string;
  displayName?: string;
  uniqueIdentifier?: IdentityIdentifier | string;
  identifiers?: Array<IdentityIdentifier | string>;
  emails?: Array<EmailAddress | string>;
  phones?: Array<PhoneNumber | string>;
  documents?: IdentityDocumentSet;
  agent?: Partial<AgentProfile>;
  traits?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateIdentityInput {
  kind?: IdentityKind;
  fullName?: string;
  displayName?: string;
  uniqueIdentifier?: IdentityIdentifier | string;
  identifiers?: Array<IdentityIdentifier | string>;
  emails?: Array<EmailAddress | string>;
  phones?: Array<PhoneNumber | string>;
  documents?: IdentityDocumentSet;
  agent?: Partial<AgentProfile>;
  traits?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface IdentityContactCard {
  id: string;
  kind: IdentityKind;
  fullName: string;
  displayName?: string;
  identifier: string;
  primaryEmail?: string;
  primaryPhone?: string;
}

export interface AgentRegistrationManifest {
  identityId: string;
  kind: IdentityKind;
  name: string;
  identifier: string;
  displayName?: string;
  role?: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  channels: string[];
  schedules: string[];
  subagents: string[];
  documents: IdentityDocumentSet;
  metadata: Record<string, unknown>;
}
