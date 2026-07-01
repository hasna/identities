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

export const instructionSourceKinds = [
  "global-rules",
  "provider-rules",
  "global-system-prompt",
  "provider-system-prompt",
  "identity-doc",
  "persona-doc",
  "account-overlay",
  "machine-overlay",
  "project-overlay",
  "session-overlay",
] as const;

export type InstructionSourceKind = (typeof instructionSourceKinds)[number];

export const instructionOwnerKinds = [
  "global",
  "provider",
  "identity",
  "persona",
  "account",
  "machine",
  "project",
  "session",
] as const;

export type InstructionSourceOwnerKind = (typeof instructionOwnerKinds)[number];

export const instructionSensitivityLevels = ["public", "internal", "confidential", "secret"] as const;

export type InstructionSensitivity = (typeof instructionSensitivityLevels)[number];

export const instructionMergePolicies = ["append", "replace"] as const;

export type InstructionMergePolicy = (typeof instructionMergePolicies)[number];

export const instructionSafetyClasses = ["standard", "safety", "non-overridable-safety"] as const;

export type InstructionSafetyClass = (typeof instructionSafetyClasses)[number];

export const instructionProviderStrategies = [
  "native",
  "import",
  "managed-block",
  "rendered",
  "unsupported",
] as const;

export type InstructionProviderStrategy = (typeof instructionProviderStrategies)[number];

export interface InstructionSourceOwner {
  kind: InstructionSourceOwnerKind;
  id: string;
  name?: string;
}

export interface InstructionSourcePath {
  path: string;
  editable: boolean;
  required?: boolean;
  format?: "markdown" | "text" | "json" | "yaml";
  hash?: string;
  label?: string;
}

export interface InstructionProviderCompatibility {
  provider: string;
  supported: boolean;
  strategy: InstructionProviderStrategy;
  nativePaths?: string[];
  notes?: string;
  minVersion?: string;
}

export interface InstructionSourceProvenance {
  createdAt: string;
  updatedAt: string;
  source?: string;
  importedFrom?: string;
}

export interface InstructionSource {
  id: string;
  kind: InstructionSourceKind;
  title: string;
  content?: string;
  owner: InstructionSourceOwner;
  sensitivity: InstructionSensitivity;
  precedence: number;
  mergePolicy: InstructionMergePolicy;
  replacementScope?: string;
  safety: InstructionSafetyClass;
  nonOverridable: boolean;
  ruleIds: string[];
  targetProviders: string[];
  providerCompatibility: InstructionProviderCompatibility[];
  sourcePaths: InstructionSourcePath[];
  globs: string[];
  hash: string;
  pathHash?: string;
  provenance: InstructionSourceProvenance;
  metadata: Record<string, unknown>;
}

export type InstructionSourceInput = Partial<Omit<InstructionSource, "kind" | "owner" | "provenance">> & {
  kind: InstructionSourceKind;
  owner?: Partial<InstructionSourceOwner>;
  provenance?: Partial<InstructionSourceProvenance>;
};

export interface InstructionSourceValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  sourceId?: string;
  ruleId?: string;
}

export interface InstructionSourceValidationResult {
  valid: boolean;
  sourceCount: number;
  issues: InstructionSourceValidationIssue[];
  effectiveHash: string;
  nonOverridableSafetyRules: string[];
}

export interface InstructionSourceExport {
  version: 1;
  package: "@hasna/identities";
  exportedAt: string;
  sources: InstructionSource[];
  validation: InstructionSourceValidationResult;
  metadata: Record<string, unknown>;
}

export type ConfigsInstructionLayer = "global" | "tool" | "account" | "agent" | "project" | "local";

export interface ConfigsInstructionRule {
  id: string;
  label?: string;
  path?: string;
  content?: string;
  globs: string[];
  hash?: string;
  metadata?: Record<string, unknown>;
}

export interface ConfigsInstructionSource {
  id: string;
  label: string;
  layer: ConfigsInstructionLayer;
  merge: InstructionMergePolicy;
  order: number;
  content?: string;
  targetProviders: string[];
  owner: InstructionSourceOwner;
  sourcePaths: InstructionSourcePath[];
  globs: string[];
  hash: string;
  nonOverridable: boolean;
  replacementScope?: string;
  rules: ConfigsInstructionRule[];
  provenance: InstructionSourceProvenance;
  metadata: Record<string, unknown>;
}

export interface ConfigsInstructionSourceExport {
  contract: "hasna.identities.configs-instructions/v1";
  version: 1;
  package: "@hasna/identities";
  exportedAt: string;
  sources: ConfigsInstructionSource[];
  validation: InstructionSourceValidationResult;
  metadata: Record<string, unknown>;
}

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
  instructionSources: InstructionSource[];
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
  instructionSources?: InstructionSourceInput[];
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
  instructionSources?: InstructionSourceInput[];
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
