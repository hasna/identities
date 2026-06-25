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

export type IdentityAssetKind = "voice" | "profile-image";

export type IdentityAssetStatus = "planned" | "generated" | "failed";

export type IdentityMediaSource = "generated" | "imported" | "external";

export type IdentityMachineAssignmentStatus = "assigned" | "reserved" | "released";

export interface IdentityMachineAssignment {
  machineId: string;
  purpose?: string;
  slot?: string;
  status?: IdentityMachineAssignmentStatus;
  assignedAt?: string;
  releasedAt?: string;
  metadata?: Record<string, unknown>;
}

export type IdentityMachineAssignmentInput =
  | string
  | (Omit<IdentityMachineAssignment, "status" | "assignedAt"> &
      Partial<Pick<IdentityMachineAssignment, "status" | "assignedAt">>);

export type BrowserPlanProfileStatus = "reserved" | "active" | "released";

export interface BrowserPlanProfileReservation {
  id: string;
  machineId: string;
  profileName: string;
  email: string;
  slot?: string;
  status: BrowserPlanProfileStatus;
  reservedAt: string;
  activatedAt?: string;
  releasedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export type BrowserPlanProfileReservationInput = Omit<
  BrowserPlanProfileReservation,
  "id" | "profileName" | "email" | "status" | "reservedAt"
> &
  Partial<Pick<BrowserPlanProfileReservation, "id" | "profileName" | "email" | "status" | "reservedAt">>;

export interface IdentityAsset {
  id: string;
  kind: IdentityAssetKind;
  provider: string;
  status: IdentityAssetStatus;
  source?: IdentityMediaSource;
  path?: string;
  url?: string;
  mediaType?: string;
  bytes?: number;
  checksum?: string;
  model?: string;
  prompt?: string;
  generatedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type IdentityAssetInput = Omit<IdentityAsset, "id" | "status"> & Partial<Pick<IdentityAsset, "id" | "status">>;

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

export interface VoiceProfile {
  provider: string;
  voiceId?: string;
  generatedVoiceId?: string;
  name?: string;
  description?: string;
  model?: string;
  outputFormat?: string;
  sampleText?: string;
  assetId?: string;
  previewAssetId?: string;
  sync?: SyncRef;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ProfileImage {
  provider: string;
  model?: string;
  prompt?: string;
  aspectRatio?: string;
  assetId?: string;
  url?: string;
  sync?: SyncRef;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
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
  voice?: VoiceProfile;
  profileImage?: ProfileImage;
  assets: IdentityAsset[];
  machineAssignments?: IdentityMachineAssignment[];
  browserPlanProfiles?: BrowserPlanProfileReservation[];
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
  voice?: Partial<VoiceProfile>;
  profileImage?: Partial<ProfileImage>;
  assets?: IdentityAssetInput[];
  machineAssignments?: IdentityMachineAssignmentInput[];
  browserPlanProfiles?: BrowserPlanProfileReservationInput[];
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
  voice?: Partial<VoiceProfile> | null;
  profileImage?: Partial<ProfileImage> | null;
  assets?: IdentityAssetInput[];
  machineAssignments?: IdentityMachineAssignmentInput[];
  browserPlanProfiles?: BrowserPlanProfileReservationInput[];
  agent?: Partial<AgentProfile>;
  traits?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface BrowserPlanIdentityProfile {
  identityId: string;
  identifier: string;
  kind: IdentityKind;
  fullName: string;
  displayName?: string;
  machineId: string;
  profileName: string;
  email: string;
  emailVerified: boolean;
  emailReady: boolean;
  maileryId?: string;
  reservationId: string;
  reservationStatus: BrowserPlanProfileStatus;
  slot?: string;
}

export interface BrowserPlanMachineCoverage {
  machineId: string;
  target: number;
  assigned: number;
  withEmail: number;
  reserved: number;
  ready: number;
  usable: number;
  missing: number;
}

export interface BrowserPlanCoverageReport {
  targetPerMachine: number;
  machines: BrowserPlanMachineCoverage[];
  excludedMachineIds: string[];
  totals: {
    machines: number;
    target: number;
    usable: number;
    missing: number;
  };
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
  voice?: VoiceProfile;
  profileImage?: ProfileImage;
  assets: IdentityAsset[];
  metadata: Record<string, unknown>;
}
