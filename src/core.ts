import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  AgentRegistrationManifest,
  CreateIdentityInput,
  EmailAddress,
  Identity,
  IdentityContactCard,
  IdentityDocumentSet,
  IdentityIdentifier,
  PhoneNumber,
  UpdateIdentityInput,
} from "./types.js";
import { identityDocumentKeys } from "./types.js";

export const OPEN_IDENTITIES_SCHEME = "open-identities";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  return {
    ...identity,
    kind: input.kind ?? identity.kind,
    fullName: input.fullName === undefined ? identity.fullName : requiredTrimmed(input.fullName, "fullName"),
    displayName: input.displayName?.trim() ?? identity.displayName,
    uniqueIdentifier,
    identifiers,
    emails: input.emails ? ensureSinglePrimary(input.emails.map(normalizeEmail)) : identity.emails,
    phones: input.phones ? ensureSinglePrimary(input.phones.map(normalizePhone)) : identity.phones,
    documents: input.documents ? { ...identity.documents, ...input.documents } : identity.documents,
    agent: input.agent ? normalizeAgentProfile(input.agent, identity.agent) : identity.agent,
    traits: input.traits ? { ...identity.traits, ...input.traits } : identity.traits,
    metadata: input.metadata ? { ...identity.metadata, ...input.metadata } : identity.metadata,
    updatedAt: nowIso(),
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
    documents: identity.documents,
    metadata: {
      ...identity.metadata,
      openIdentitiesId: identity.id,
      uniqueIdentifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    },
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

  return `${lines.join("\n").trim()}\n`;
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

function normalizeStringList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
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

function appendDocumentSection(lines: string[], title: string, content: string | undefined): void {
  const value = content?.trim();
  if (!value) return;
  lines.push("", `## ${title}`, "", value);
}
