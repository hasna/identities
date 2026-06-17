export {
  OPEN_IDENTITIES_SCHEME,
  addEmail,
  addPhone,
  createDefaultDocuments,
  createIdentity,
  createOpenIdentityId,
  findPrimaryEmail,
  findPrimaryPhone,
  identityToContactCard,
  identityIdentifierToString,
  identityToAgentManifest,
  normalizeEmail,
  normalizeIdentifier,
  normalizePhone,
  nowIso,
  publicIdentityIdentifier,
  renderIdentityInstructions,
  updateIdentity,
} from "./core.js";
export { createIdentityStore, getIdentityDataDir, getIdentityStorePath, IdentityStore } from "./storage.js";
export { createAgentIdentityRef, createEcosystemRegistrationManifest } from "./ecosystem.js";
export { listEveDocumentKeys, writeEveAgent } from "./eve.js";
export { applyContactPointSyncResults, syncIdentityContactPoints, syncIdentityContactPointsAndUpdate } from "./integrations.js";
export { identityDocumentKeys } from "./types.js";
export type {
  AgentIdentityRef,
  EcosystemRegistrationManifest,
  EcosystemTarget,
} from "./ecosystem.js";
export type {
  EveExportOptions,
  EveExportResult,
} from "./eve.js";
export type {
  ContactPointSyncResult,
  IdentitySyncAdapters,
  MaileryIdentityAdapter,
  MaileryIdentitySyncInput,
  TelephonyIdentityAdapter,
  TelephonyIdentitySyncInput,
} from "./integrations.js";
export type {
  AgentProfile,
  AgentRegistrationManifest,
  CreateIdentityInput,
  EmailAddress,
  Identity,
  IdentityContactCard,
  IdentityDocumentKey,
  IdentityDocumentSet,
  IdentityIdentifier,
  IdentityKind,
  PhoneNumber,
  SyncRef,
  SyncStatus,
  UpdateIdentityInput,
  VerificationStatus,
} from "./types.js";
