import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  AgentRegistrationManifest,
  BrowserPlanIdentityProfile,
  BrowserPlanProfileReservation,
  BrowserPlanProfileReservationInput,
  CreateIdentityInput,
  EmailAddress,
  Identity,
  IdentityAsset,
  IdentityAssetInput,
  IdentityContactCard,
  IdentityDocumentSet,
  IdentityIdentifier,
  IdentityMachineAssignment,
  IdentityMachineAssignmentInput,
  PhoneNumber,
  ProfileImage,
  UpdateIdentityInput,
  VoiceProfile,
} from "./types.js";
import { identityDocumentKeys } from "./types.js";

export const OPEN_IDENTITIES_SCHEME = "open-identities";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MACHINE_ID_PATTERN = /^[a-z][a-z0-9-]*[a-z0-9]$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createOpenIdentityId(): string {
  return `oid_${randomUUID()}`;
}

export function createDefaultDocuments(): IdentityDocumentSet {
  return Object.fromEntries(identityDocumentKeys.map((key) => [key, ""])) as IdentityDocumentSet;
}

export function normalizeIdentifier(identifier: IdentityIdentifier | string): IdentityIdentifier {
  if (typeof identifier !== "string") {
    const scheme = requiredTrimmed(identifier.scheme, "identifier scheme");
    const value = requiredTrimmed(identifier.value, "identifier value");
    return {
      status: "unverified",
      sensitive: false,
      ...identifier,
      scheme,
      value,
    };
  }

  const raw = requiredTrimmed(identifier, "identifier");
  const separator = raw.indexOf(":");
  if (separator > 0) {
    const scheme = requiredTrimmed(raw.slice(0, separator), "identifier scheme");
    const value = requiredTrimmed(raw.slice(separator + 1), "identifier value");
    return {
      scheme,
      value,
      status: "unverified",
      sensitive: false,
    };
  }

  return {
    scheme: "custom",
    value: raw,
    status: "unverified",
    sensitive: false,
  };
}

export function normalizeEmail(email: EmailAddress | string): EmailAddress {
  if (typeof email === "string") {
    return { address: normalizeEmailAddress(email), verified: false };
  }

  return {
    ...email,
    address: normalizeEmailAddress(email.address),
    verified: email.verified ?? false,
  };
}

export function normalizePhone(phone: PhoneNumber | string): PhoneNumber {
  if (typeof phone === "string") {
    return { number: normalizePhoneNumber(phone), verified: false };
  }

  return {
    ...phone,
    number: normalizePhoneNumber(phone.number),
    verified: phone.verified ?? false,
  };
}

export function createIdentity(input: CreateIdentityInput): Identity {
  const timestamp = input.createdAt ?? nowIso();
  const uniqueIdentifier = normalizeIdentifier(
    input.uniqueIdentifier ?? {
      scheme: OPEN_IDENTITIES_SCHEME,
      value: input.id ?? createOpenIdentityId(),
      status: "verified",
      sensitive: false,
    },
  );
  const id = input.id ?? (uniqueIdentifier.scheme === OPEN_IDENTITIES_SCHEME ? uniqueIdentifier.value : createOpenIdentityId());
  const identifiers = dedupeIdentifiers([uniqueIdentifier, ...(input.identifiers ?? []).map(normalizeIdentifier)]);
  const emails = ensureSinglePrimary((input.emails ?? []).map(normalizeEmail));
  const phones = ensureSinglePrimary((input.phones ?? []).map(normalizePhone));
  const fullName = requiredTrimmed(input.fullName, "fullName");
  const machineAssignments = normalizeMachineAssignments(input.machineAssignments);
  const browserPlanProfiles = normalizeBrowserPlanProfiles(input.browserPlanProfiles, emails, {
    defaultProfileName: input.displayName?.trim() || fullName,
  });
  assertBrowserPlanProfilesHaveAssignments(machineAssignments, browserPlanProfiles);

  return {
    id,
    kind: input.kind,
    fullName,
    displayName: input.displayName?.trim(),
    uniqueIdentifier,
    identifiers,
    emails,
    phones,
    documents: { ...createDefaultDocuments(), ...(input.documents ?? {}) },
    voice: input.voice ? normalizeVoiceProfile(input.voice) : undefined,
    profileImage: input.profileImage ? normalizeProfileImage(input.profileImage) : undefined,
    assets: normalizeIdentityAssets(input.assets),
    machineAssignments,
    browserPlanProfiles,
    agent: input.kind === "agent" ? normalizeAgentProfile(input.agent) : input.agent ? normalizeAgentProfile(input.agent) : undefined,
    traits: input.traits ?? {},
    metadata: input.metadata ?? {},
    createdAt: timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  };
}

export function updateIdentity(identity: Identity, input: UpdateIdentityInput): Identity {
  const uniqueIdentifier = input.uniqueIdentifier ? normalizeIdentifier(input.uniqueIdentifier) : identity.uniqueIdentifier;
  const identifiers = input.identifiers
    ? dedupeIdentifiers([uniqueIdentifier, ...input.identifiers.map(normalizeIdentifier)])
    : dedupeIdentifiers([uniqueIdentifier, ...identity.identifiers]);
  const emails = input.emails ? ensureSinglePrimary(input.emails.map(normalizeEmail)) : identity.emails;
  const machineAssignments = input.machineAssignments
    ? normalizeMachineAssignments(input.machineAssignments)
    : normalizeMachineAssignments(identity.machineAssignments ?? []);
  const browserPlanProfiles = input.browserPlanProfiles
    ? normalizeBrowserPlanProfiles(input.browserPlanProfiles, emails, {
        defaultProfileName: input.displayName?.trim() ?? identity.displayName ?? input.fullName?.trim() ?? identity.fullName,
      })
    : normalizeBrowserPlanProfiles(identity.browserPlanProfiles ?? [], emails, {
        defaultProfileName: input.displayName?.trim() ?? identity.displayName ?? input.fullName?.trim() ?? identity.fullName,
      });
  assertBrowserPlanProfilesHaveAssignments(machineAssignments, browserPlanProfiles);

  return {
    ...identity,
    kind: input.kind ?? identity.kind,
    fullName: input.fullName === undefined ? identity.fullName : requiredTrimmed(input.fullName, "fullName"),
    displayName: input.displayName?.trim() ?? identity.displayName,
    uniqueIdentifier,
    identifiers,
    emails,
    phones: input.phones ? ensureSinglePrimary(input.phones.map(normalizePhone)) : identity.phones,
    documents: input.documents ? { ...identity.documents, ...input.documents } : identity.documents,
    voice:
      input.voice === null ? undefined : input.voice ? normalizeVoiceProfile(input.voice, identity.voice) : identity.voice,
    profileImage:
      input.profileImage === null
        ? undefined
        : input.profileImage
          ? normalizeProfileImage(input.profileImage, identity.profileImage)
          : identity.profileImage,
    assets: input.assets ? normalizeIdentityAssets(input.assets) : normalizeIdentityAssets(identity.assets ?? []),
    machineAssignments,
    browserPlanProfiles,
    agent: input.agent ? normalizeAgentProfile(input.agent, identity.agent) : identity.agent,
    traits: input.traits ? { ...identity.traits, ...input.traits } : identity.traits,
    metadata: input.metadata ? { ...identity.metadata, ...input.metadata } : identity.metadata,
    updatedAt: nowIso(),
  };
}

export function normalizePersistedIdentity(identity: Identity): Identity {
  const timestamp = identity.createdAt ?? nowIso();
  const uniqueIdentifier = normalizeIdentifier(identity.uniqueIdentifier);
  const emails = ensureSinglePrimary((identity.emails ?? []).map(normalizeEmail));
  const machineAssignments = normalizeMachineAssignments(identity.machineAssignments ?? []);
  const browserPlanProfiles = normalizeBrowserPlanProfiles(identity.browserPlanProfiles ?? [], emails, {
    defaultProfileName: identity.displayName ?? identity.fullName,
  });
  assertBrowserPlanProfilesHaveAssignments(machineAssignments, browserPlanProfiles);
  return {
    ...identity,
    id: identity.id,
    kind: identity.kind,
    fullName: requiredTrimmed(identity.fullName, "fullName"),
    displayName: identity.displayName?.trim(),
    uniqueIdentifier,
    identifiers: dedupeIdentifiers([uniqueIdentifier, ...(identity.identifiers ?? []).map(normalizeIdentifier)]),
    emails,
    phones: ensureSinglePrimary((identity.phones ?? []).map(normalizePhone)),
    documents: { ...createDefaultDocuments(), ...(identity.documents ?? {}) },
    voice: identity.voice ? normalizeVoiceProfile(identity.voice) : undefined,
    profileImage: identity.profileImage ? normalizeProfileImage(identity.profileImage) : undefined,
    assets: normalizeIdentityAssets(identity.assets ?? []),
    machineAssignments,
    browserPlanProfiles,
    agent: identity.agent ? normalizeAgentProfile(identity.agent) : undefined,
    traits: identity.traits ?? {},
    metadata: identity.metadata ?? {},
    createdAt: timestamp,
    updatedAt: identity.updatedAt ?? timestamp,
  };
}

export function addEmail(identity: Identity, email: EmailAddress | string): Identity {
  const nextEmail = normalizeEmail(email);
  const withoutExisting = identity.emails.filter((item) => item.address !== nextEmail.address);
  const nextEmails = ensureSinglePrimary([...withoutExisting, nextEmail]);
  return updateIdentity(identity, { emails: nextEmails });
}

export function addPhone(identity: Identity, phone: PhoneNumber | string): Identity {
  const nextPhone = normalizePhone(phone);
  const withoutExisting = identity.phones.filter((item) => item.number !== nextPhone.number);
  const nextPhones = ensureSinglePrimary([...withoutExisting, nextPhone]);
  return updateIdentity(identity, { phones: nextPhones });
}

export function assignMachine(identity: Identity, assignment: IdentityMachineAssignmentInput): Identity {
  const nextAssignment = normalizeMachineAssignment(assignment);
  const assignments = normalizeMachineAssignments([
    ...(identity.machineAssignments ?? []).filter((item) => machineAssignmentKey(item) !== machineAssignmentKey(nextAssignment)),
    nextAssignment,
  ]);
  return updateIdentity(identity, { machineAssignments: assignments });
}

export function reserveBrowserPlanProfile(
  identity: Identity,
  reservation: BrowserPlanProfileReservationInput,
): Identity {
  const nextReservation = normalizeBrowserPlanProfile(reservation, identity.emails, {
    defaultProfileName: identity.displayName ?? identity.fullName,
  });
  const hasAssignment = (identity.machineAssignments ?? []).some((assignment) => {
    return (
      assignment.machineId === nextReservation.machineId &&
      assignment.status !== "released" &&
      (!assignment.purpose || assignment.purpose === "browserplan")
    );
  });
  if (!hasAssignment) {
    throw new Error(`Identity is not assigned to BrowserPlan machine: ${nextReservation.machineId}`);
  }

  const reservations = normalizeBrowserPlanProfiles([
    ...(identity.browserPlanProfiles ?? []).filter((item) => !matchesBrowserPlanProfileReservation(item, nextReservation)),
    nextReservation,
  ], identity.emails, { defaultProfileName: identity.displayName ?? identity.fullName });
  return updateIdentity(identity, { browserPlanProfiles: reservations });
}

export function listIdentityMachineAssignments(identity: Identity, machineId?: string): IdentityMachineAssignment[] {
  const normalizedMachineId = machineId ? normalizeMachineId(machineId) : undefined;
  return (identity.machineAssignments ?? []).filter((assignment) => {
    return assignment.status !== "released" && (!normalizedMachineId || assignment.machineId === normalizedMachineId);
  });
}

export function identityHasMachineAssignment(identity: Identity, machineId: string, purpose?: string): boolean {
  const normalizedMachineId = normalizeMachineId(machineId);
  const normalizedPurpose = purpose?.trim().toLowerCase();
  return (identity.machineAssignments ?? []).some((assignment) => {
    return (
      assignment.machineId === normalizedMachineId &&
      assignment.status !== "released" &&
      (normalizedPurpose === undefined || assignmentPurposeKey(assignment) === normalizedPurpose)
    );
  });
}

export function identityToBrowserPlanProfile(
  identity: Identity,
  reservation: BrowserPlanProfileReservation,
): BrowserPlanIdentityProfile {
  const email = findEmail(identity, reservation.email);
  if (!email) throw new Error(`BrowserPlan reservation email is not attached to identity: ${reservation.email}`);
  return {
    identityId: identity.id,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    kind: identity.kind,
    fullName: identity.fullName,
    displayName: identity.displayName,
    machineId: reservation.machineId,
    profileName: reservation.profileName,
    email: email.address,
    emailVerified: email.verified ?? false,
    emailReady: isBrowserPlanEmailReady(email),
    maileryId: email.maileryId ?? email.sync?.externalId,
    reservationId: reservation.id,
    reservationStatus: reservation.status,
    slot: reservation.slot,
  };
}

export function listBrowserPlanProfilesForIdentity(identity: Identity, machineId?: string): BrowserPlanIdentityProfile[] {
  const normalizedMachineId = machineId ? normalizeMachineId(machineId) : undefined;
  return (identity.browserPlanProfiles ?? [])
    .filter((reservation) => {
      return reservation.status !== "released" && (!normalizedMachineId || reservation.machineId === normalizedMachineId);
    })
    .map((reservation) => identityToBrowserPlanProfile(identity, reservation));
}

export function findPrimaryEmail(identity: Identity): EmailAddress | undefined {
  return identity.emails.find((email) => email.primary) ?? identity.emails[0];
}

export function findPrimaryPhone(identity: Identity): PhoneNumber | undefined {
  return identity.phones.find((phone) => phone.primary) ?? identity.phones[0];
}

export function identityToContactCard(identity: Identity): IdentityContactCard {
  return {
    id: identity.id,
    kind: identity.kind,
    fullName: identity.fullName,
    displayName: identity.displayName,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    primaryEmail: findPrimaryEmail(identity)?.address,
    primaryPhone: findPrimaryPhone(identity)?.number,
  };
}

export function identityIdentifierToString(identifier: IdentityIdentifier): string {
  return `${identifier.scheme}:${identifier.value}`;
}

export function publicIdentityIdentifier(identity: Identity): IdentityIdentifier {
  if (!identity.uniqueIdentifier.sensitive) return identity.uniqueIdentifier;
  return {
    scheme: OPEN_IDENTITIES_SCHEME,
    value: identity.id,
    status: "verified",
    sensitive: false,
  };
}

export function identityToAgentManifest(identity: Identity): AgentRegistrationManifest {
  return {
    identityId: identity.id,
    kind: identity.kind,
    name: identity.displayName ?? identity.fullName,
    displayName: identity.displayName,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    role: identity.agent?.role,
    capabilities: identity.agent?.capabilities ?? [],
    tools: identity.agent?.tools ?? [],
    skills: identity.agent?.skills ?? [],
    channels: identity.agent?.channels ?? [],
    schedules: identity.agent?.schedules ?? [],
    subagents: identity.agent?.subagents ?? [],
    documents: createDefaultDocuments(),
    voice: projectVoiceProfile(identity.voice),
    profileImage: projectProfileImage(identity.profileImage),
    assets: (identity.assets ?? []).map(projectIdentityAsset),
    metadata: {
      openIdentitiesId: identity.id,
      uniqueIdentifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    },
  };
}

export function projectIdentityAsset(asset: IdentityAsset): IdentityAsset {
  return {
    id: asset.id,
    kind: asset.kind,
    provider: asset.provider,
    status: asset.status,
    source: asset.source,
    mediaType: asset.mediaType,
    bytes: asset.bytes,
    checksum: asset.checksum,
    model: asset.model,
    generatedAt: asset.generatedAt,
    error: asset.error,
  };
}

export function projectVoiceProfile(voice: VoiceProfile | undefined): VoiceProfile | undefined {
  if (!voice) return undefined;
  return {
    provider: voice.provider,
    voiceId: voice.voiceId,
    generatedVoiceId: voice.generatedVoiceId,
    name: voice.name,
    model: voice.model,
    outputFormat: voice.outputFormat,
    assetId: voice.assetId,
    previewAssetId: voice.previewAssetId,
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt,
  };
}

export function projectProfileImage(profileImage: ProfileImage | undefined): ProfileImage | undefined {
  if (!profileImage) return undefined;
  return {
    provider: profileImage.provider,
    model: profileImage.model,
    aspectRatio: profileImage.aspectRatio,
    assetId: profileImage.assetId,
    createdAt: profileImage.createdAt,
    updatedAt: profileImage.updatedAt,
  };
}

export function renderIdentityInstructions(identity: Identity): string {
  const lines: string[] = [`# Identity`, "", `Name: ${identity.displayName ?? identity.fullName}`, `Identifier: ${identityIdentifierToString(publicIdentityIdentifier(identity))}`, `Kind: ${identity.kind}`];

  appendDocumentSection(lines, "Bio", identity.documents.bio);
  appendDocumentSection(lines, "System Prompt", identity.documents.prompt);
  appendDocumentSection(lines, "Soul", identity.documents.soul);
  appendDocumentSection(lines, "Personality", identity.documents.personality);
  appendDocumentSection(lines, "Ethos", identity.documents.ethos);
  appendDocumentSection(lines, "Capabilities", identity.documents.capabilities);
  appendDocumentSection(lines, "Boundaries", identity.documents.boundaries);
  appendDocumentSection(lines, "Tools", identity.documents.tools);
  appendDocumentSection(lines, "Goals", identity.documents.goals);
  appendDocumentSection(lines, "Context", identity.documents.context);
  appendDocumentSection(lines, "Consent", identity.documents.consent);
  appendDocumentSection(lines, "Voice", identity.documents.voice);

  if (identity.voice) {
    lines.push("", "## Voice Profile", "");
    lines.push(`Provider: ${identity.voice.provider}`);
    if (identity.voice.voiceId) lines.push(`Voice ID: ${identity.voice.voiceId}`);
    if (identity.voice.generatedVoiceId) lines.push(`Generated Voice ID: ${identity.voice.generatedVoiceId}`);
    if (identity.voice.model) lines.push(`Model: ${identity.voice.model}`);
    if (identity.voice.assetId) lines.push(`Current Asset: ${identity.voice.assetId}`);
  }

  if (identity.profileImage) {
    lines.push("", "## Profile Image", "");
    lines.push(`Provider: ${identity.profileImage.provider}`);
    if (identity.profileImage.model) lines.push(`Model: ${identity.profileImage.model}`);
    if (identity.profileImage.aspectRatio) lines.push(`Aspect Ratio: ${identity.profileImage.aspectRatio}`);
    if (identity.profileImage.assetId) lines.push(`Current Asset: ${identity.profileImage.assetId}`);
  }

  return `${lines.join("\n").trim()}\n`;
}

export function normalizeIdentityAsset(asset: IdentityAssetInput): IdentityAsset {
  return {
    source: "generated",
    metadata: {},
    ...asset,
    id: asset.id?.trim() || `asset_${randomUUID()}`,
    kind: requireAssetKind(asset.kind),
    provider: requiredTrimmed(asset.provider, "asset provider"),
    status: asset.status ?? "generated",
    generatedAt: asset.generatedAt,
    prompt: asset.prompt?.trim(),
    model: asset.model?.trim(),
  };
}

export function normalizeIdentityAssets(assets: IdentityAssetInput[] | undefined): IdentityAsset[] {
  const seen = new Set<string>();
  const normalized: IdentityAsset[] = [];
  for (const asset of assets ?? []) {
    const next = normalizeIdentityAsset(asset);
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

export function normalizeMachineId(machineId: string): string {
  const normalized = requiredTrimmed(machineId, "machineId").toLowerCase();
  if (!MACHINE_ID_PATTERN.test(normalized)) throw new Error(`Invalid machineId: ${machineId}`);
  return normalized;
}

export function normalizeMachineAssignment(input: IdentityMachineAssignmentInput): IdentityMachineAssignment {
  const assignment = typeof input === "string" ? { machineId: input } : input;
  const status = assignment.status ?? "assigned";
  if (!isMachineAssignmentStatus(status)) throw new Error(`Invalid machine assignment status: ${status}`);
  return {
    ...assignment,
    machineId: normalizeMachineId(assignment.machineId),
    purpose: trimmedOptional(assignment.purpose)?.toLowerCase(),
    slot: trimmedOptional(assignment.slot),
    status,
    assignedAt: assignment.assignedAt ?? nowIso(),
    releasedAt: trimmedOptional(assignment.releasedAt),
    metadata: assignment.metadata ?? {},
  };
}

export function normalizeMachineAssignments(
  assignments: IdentityMachineAssignmentInput[] | undefined,
): IdentityMachineAssignment[] {
  const seen = new Set<string>();
  const normalized: IdentityMachineAssignment[] = [];
  for (const assignment of assignments ?? []) {
    const next = normalizeMachineAssignment(assignment);
    const key = machineAssignmentKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }
  return normalized;
}

export function normalizeBrowserPlanProfile(
  input: BrowserPlanProfileReservationInput,
  emails: Array<EmailAddress | string>,
  options: { defaultProfileName: string },
): BrowserPlanProfileReservation {
  const normalizedEmails = emails.map(normalizeEmail);
  const email = input.email ? normalizeEmailAddress(input.email) : findPrimaryNormalizedEmail(normalizedEmails)?.address;
  if (!email) throw new Error("BrowserPlan profile requires an email address");
  if (!normalizedEmails.some((candidate) => candidate.address === email)) {
    throw new Error(`BrowserPlan profile email is not attached to identity: ${email}`);
  }
  const status = input.status ?? "reserved";
  if (!isBrowserPlanProfileStatus(status)) throw new Error(`Invalid BrowserPlan profile status: ${status}`);
  const profileName = requiredTrimmed(input.profileName ?? options.defaultProfileName, "profileName");
  return {
    ...input,
    id: input.id?.trim() || `browserplan_${randomUUID()}`,
    machineId: normalizeMachineId(input.machineId),
    profileName,
    email,
    slot: trimmedOptional(input.slot),
    status,
    reservedAt: input.reservedAt ?? nowIso(),
    activatedAt: trimmedOptional(input.activatedAt),
    releasedAt: trimmedOptional(input.releasedAt),
    expiresAt: trimmedOptional(input.expiresAt),
    metadata: input.metadata ?? {},
  };
}

export function normalizeBrowserPlanProfiles(
  profiles: BrowserPlanProfileReservationInput[] | undefined,
  emails: Array<EmailAddress | string>,
  options: { defaultProfileName: string },
): BrowserPlanProfileReservation[] {
  const seen = new Set<string>();
  const seenMachineEmail = new Set<string>();
  const seenMachineSlot = new Set<string>();
  const normalized: BrowserPlanProfileReservation[] = [];
  for (const profile of profiles ?? []) {
    const next = normalizeBrowserPlanProfile(profile, emails, options);
    const key = browserPlanProfileKey(next);
    if (seen.has(key)) continue;
    seen.add(key);
    if (next.status !== "released") {
      const emailKey = `${next.machineId}:${next.email}`;
      if (seenMachineEmail.has(emailKey)) {
        throw new Error(`Duplicate BrowserPlan profile email for machine: ${next.machineId}`);
      }
      seenMachineEmail.add(emailKey);
      if (next.slot) {
        const slotKey = `${next.machineId}:${next.slot}`;
        if (seenMachineSlot.has(slotKey)) {
          throw new Error(`Duplicate BrowserPlan profile slot for machine: ${next.machineId}`);
        }
        seenMachineSlot.add(slotKey);
      }
    }
    normalized.push(next);
  }
  return normalized;
}

export function normalizeVoiceProfile(input: Partial<VoiceProfile>, existing?: VoiceProfile): VoiceProfile {
  const provider = input.provider ?? existing?.provider;
  if (!provider) throw new Error("voice provider cannot be empty");
  return {
    ...existing,
    ...input,
    provider: requiredTrimmed(provider, "voice provider"),
    voiceId: trimmedOptional(input.voiceId ?? existing?.voiceId),
    generatedVoiceId: trimmedOptional(input.generatedVoiceId ?? existing?.generatedVoiceId),
    name: trimmedOptional(input.name ?? existing?.name),
    description: trimmedOptional(input.description ?? existing?.description),
    model: trimmedOptional(input.model ?? existing?.model),
    outputFormat: trimmedOptional(input.outputFormat ?? existing?.outputFormat),
    sampleText: trimmedOptional(input.sampleText ?? existing?.sampleText),
    assetId: trimmedOptional(input.assetId ?? existing?.assetId),
    previewAssetId: trimmedOptional(input.previewAssetId ?? existing?.previewAssetId),
    metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
  };
}

export function normalizeProfileImage(input: Partial<ProfileImage>, existing?: ProfileImage): ProfileImage {
  const provider = input.provider ?? existing?.provider;
  if (!provider) throw new Error("profile image provider cannot be empty");
  return {
    ...existing,
    ...input,
    provider: requiredTrimmed(provider, "profile image provider"),
    model: trimmedOptional(input.model ?? existing?.model),
    prompt: trimmedOptional(input.prompt ?? existing?.prompt),
    aspectRatio: trimmedOptional(input.aspectRatio ?? existing?.aspectRatio),
    assetId: trimmedOptional(input.assetId ?? existing?.assetId),
    url: trimmedOptional(input.url ?? existing?.url),
    metadata: { ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) },
  };
}

function normalizeAgentProfile(input: Partial<AgentProfile> | undefined, existing?: AgentProfile): AgentProfile {
  return {
    role: input?.role ?? existing?.role,
    model: input?.model ?? existing?.model,
    capabilities: normalizeStringList(input?.capabilities ?? existing?.capabilities),
    tools: normalizeStringList(input?.tools ?? existing?.tools),
    skills: normalizeStringList(input?.skills ?? existing?.skills),
    channels: normalizeStringList(input?.channels ?? existing?.channels),
    schedules: normalizeStringList(input?.schedules ?? existing?.schedules),
    subagents: normalizeStringList(input?.subagents ?? existing?.subagents),
    identityProvider: input?.identityProvider ?? existing?.identityProvider,
  };
}

function findEmail(identity: Identity, address: string): EmailAddress | undefined {
  const normalized = normalizeEmailAddress(address);
  return identity.emails.find((email) => email.address === normalized);
}

function findPrimaryNormalizedEmail(emails: EmailAddress[]): EmailAddress | undefined {
  return emails.find((email) => email.primary) ?? emails[0];
}

function isBrowserPlanEmailReady(email: EmailAddress): boolean {
  return Boolean(
    email.verified &&
      (email.maileryId || (email.sync?.provider === "mailery" && email.sync.status === "synced" && email.sync.externalId)),
  );
}

function machineAssignmentKey(assignment: Pick<IdentityMachineAssignment, "machineId" | "purpose" | "slot">): string {
  return [assignment.machineId, assignment.purpose ?? "", assignment.slot ?? ""].join(":");
}

function browserPlanProfileKey(profile: Pick<BrowserPlanProfileReservation, "machineId" | "email" | "slot">): string {
  return [profile.machineId, profile.slot ?? "", profile.email].join(":");
}

function matchesBrowserPlanProfileReservation(
  current: BrowserPlanProfileReservation,
  next: BrowserPlanProfileReservation,
): boolean {
  if (current.id === next.id) return true;
  if (current.machineId !== next.machineId) return false;
  if (current.email === next.email) return true;
  return Boolean(current.slot && next.slot && current.slot === next.slot);
}

function assertBrowserPlanProfilesHaveAssignments(
  assignments: IdentityMachineAssignment[],
  profiles: BrowserPlanProfileReservation[],
): void {
  for (const profile of profiles) {
    if (profile.status === "released") continue;
    const hasAssignment = assignments.some((assignment) => {
      return (
        assignment.machineId === profile.machineId &&
        assignment.status !== "released" &&
        assignmentPurposeKey(assignment) === "browserplan"
      );
    });
    if (!hasAssignment) {
      throw new Error(`BrowserPlan profile requires machine assignment: ${profile.machineId}`);
    }
  }
}

function assignmentPurposeKey(assignment: Pick<IdentityMachineAssignment, "purpose">): string {
  return assignment.purpose ?? "browserplan";
}

function isMachineAssignmentStatus(value: string): value is NonNullable<IdentityMachineAssignment["status"]> {
  return value === "assigned" || value === "reserved" || value === "released";
}

function isBrowserPlanProfileStatus(value: string): value is BrowserPlanProfileReservation["status"] {
  return value === "reserved" || value === "active" || value === "released";
}

function normalizeStringList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function requireAssetKind(kind: string): IdentityAsset["kind"] {
  if (kind === "voice" || kind === "profile-image") return kind;
  throw new Error(`Invalid asset kind: ${kind}`);
}

function dedupeIdentifiers(identifiers: IdentityIdentifier[]): IdentityIdentifier[] {
  const seen = new Set<string>();
  const result: IdentityIdentifier[] = [];
  for (const identifier of identifiers) {
    const key = `${identifier.scheme}:${identifier.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(identifier);
  }
  return result;
}

function ensureSinglePrimary<T extends { primary?: boolean }>(items: T[]): T[] {
  if (items.length === 0) return [];
  const primaryIndex = items.findIndex((item) => item.primary);
  if (primaryIndex === -1) {
    return items.map((item, index) => ({ ...item, primary: index === 0 }));
  }
  return items.map((item, index) => ({ ...item, primary: index === primaryIndex }));
}

function normalizeEmailAddress(address: string): string {
  const normalized = requiredTrimmed(address, "email").toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) throw new Error(`Invalid email address: ${address}`);
  return normalized;
}

function normalizePhoneNumber(number: string): string {
  return requiredTrimmed(number, "phone number");
}

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} cannot be empty`);
  return trimmed;
}

function trimmedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function appendDocumentSection(lines: string[], title: string, content: string | undefined): void {
  const value = content?.trim();
  if (!value) return;
  lines.push("", `## ${title}`, "", value);
}
