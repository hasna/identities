import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { identityDocumentKeys, type Identity, type IdentityKind } from "./types.js";
import { getIdentityAuditPath, getIdentityStorePath, IdentityStore } from "./storage.js";
import {
  HASNA_COMPANY_AGENT_ROSTER_VERSION,
  deprecatedHasnaCompanyAgentIdentifiers,
  hasnaCompanyAgentSpecs,
} from "./roster.js";
import {
  identityIdentifierToString,
  projectIdentityAsset,
  projectProfileImage,
  projectVoiceProfile,
  publicIdentityIdentifier,
} from "./core.js";

const PACKAGE_NAME = "@hasna/identities";
const FALLBACK_PACKAGE_VERSION = "0.1.4";
const IDENTITY_KINDS: IdentityKind[] = ["human", "agent", "organization", "service"];

export interface IdentityStatusRef {
  refId: string;
  kind: IdentityKind;
  hasAgentProfile: boolean;
  hasSensitiveIdentifiers: boolean;
  contactRefs: {
    emails: number;
    phones: number;
  };
  documentRefs: {
    populated: number;
    total: number;
  };
}

export interface IdentityReferenceStatus {
  service: "identities";
  schemaVersion: "1.0";
  package: {
    name: typeof PACKAGE_NAME;
    version: string;
  };
  dataDir: string;
  store: {
    path: string;
    exists: boolean;
    records: number;
  };
  audit: {
    path: string;
    exists: boolean;
  };
  env: {
    store: {
      name: "OPEN_IDENTITIES_STORE";
      active: boolean;
      includesRawValue: false;
    };
    audit: {
      name: "OPEN_IDENTITIES_AUDIT";
      active: boolean;
      includesRawValue: false;
    };
  };
  counts: {
    identities: number;
    byKind: Record<IdentityKind, number>;
    identifiers: number;
    sensitiveIdentifiers: number;
    emails: number;
    phones: number;
    agentProfiles: number;
    agentRoles: number;
    uniqueAgentRoles: number;
    toolRefs: number;
    skillRefs: number;
    channelRefs: number;
    scheduleRefs: number;
    subagentRefs: number;
    machineAssignments: number;
    browserPlanProfiles: number;
    documentSlots: number;
    populatedDocuments: number;
    maileryRefs: number;
    telephonyRefs: number;
    roster: {
      builtInVersion: number;
      builtInAgents: number;
      seededCurrentVersion: number;
      seededOtherVersion: number;
      deprecatedRefsPresent: number;
    };
  };
  refs: {
    identities: IdentityStatusRef[];
    rawIdentityIdsIncluded: false;
    rawIdentifiersIncluded: false;
  };
  documentKeys: typeof identityDocumentKeys;
  safety: {
    includesNames: false;
    includesContactValues: false;
    includesCredentialValues: false;
    includesDocumentBodies: false;
    includesSensitiveIdentifiers: false;
    includesPrivateKeys: false;
    includesGitHubAppPrivateData: false;
    includesRawEnvValues: false;
    statusOutputIsMetadataOnly: true;
  };
}

export type IdentityStoreStatus = IdentityReferenceStatus;

export async function getIdentityReferenceStatus(store = new IdentityStore()): Promise<IdentityReferenceStatus> {
  const identities = await store.list();
  const byKind = Object.fromEntries(IDENTITY_KINDS.map((kind) => [kind, 0])) as Record<IdentityKind, number>;
  const roles = new Set<string>();
  const deprecatedRefs = new Set<string>(deprecatedHasnaCompanyAgentIdentifiers);

  let identifiers = 0;
  let sensitiveIdentifiers = 0;
  let emails = 0;
  let phones = 0;
  let agentProfiles = 0;
  let agentRoles = 0;
  let toolRefs = 0;
  let skillRefs = 0;
  let channelRefs = 0;
  let scheduleRefs = 0;
  let subagentRefs = 0;
  let machineAssignments = 0;
  let browserPlanProfiles = 0;
  let populatedDocuments = 0;
  let maileryRefs = 0;
  let telephonyRefs = 0;
  let seededCurrentVersion = 0;
  let seededOtherVersion = 0;
  let deprecatedRefsPresent = 0;

  for (const identity of identities) {
    byKind[identity.kind] += 1;
    identifiers += identity.identifiers.length;
    sensitiveIdentifiers += identity.identifiers.filter((identifier) => identifier.sensitive).length;
    emails += identity.emails.length;
    phones += identity.phones.length;
    maileryRefs += identity.emails.filter((email) => Boolean(email.maileryId || email.sync?.provider === "mailery")).length;
    telephonyRefs += identity.phones.filter((phone) => Boolean(phone.telephonyId || phone.sync?.provider === "telephony")).length;
    machineAssignments += identity.machineAssignments?.filter((assignment) => assignment.status !== "released").length ?? 0;
    browserPlanProfiles += identity.browserPlanProfiles?.filter((profile) => profile.status !== "released").length ?? 0;
    populatedDocuments += populatedDocumentCount(identity);
    if (identity.agent) {
      agentProfiles += 1;
      if (identity.agent.role?.trim()) {
        agentRoles += 1;
        roles.add(identity.agent.role.trim());
      }
      toolRefs += identity.agent.tools.length;
      skillRefs += identity.agent.skills.length;
      channelRefs += identity.agent.channels.length;
      scheduleRefs += identity.agent.schedules.length;
      subagentRefs += identity.agent.subagents.length;
    }
    if (identity.metadata?.["seed"] === "hasna-company-agents") {
      if (identity.metadata["rosterVersion"] === HASNA_COMPANY_AGENT_ROSTER_VERSION) seededCurrentVersion += 1;
      else seededOtherVersion += 1;
    }
    if (identity.identifiers.some((identifier) => deprecatedRefs.has(`${identifier.scheme}:${identifier.value}`))) {
      deprecatedRefsPresent += 1;
    }
  }

  return {
    service: "identities",
    schemaVersion: "1.0",
    package: {
      name: PACKAGE_NAME,
      version: packageVersion(),
    },
    dataDir: redactStorePath(dirname(store.filePath || getIdentityStorePath()), "dataDir"),
    store: {
      path: redactStorePath(store.filePath || getIdentityStorePath(), "store"),
      exists: existsSync(store.filePath || getIdentityStorePath()),
      records: identities.length,
    },
    audit: {
      path: redactStorePath(store.auditPath || getIdentityAuditPath(), "audit"),
      exists: existsSync(store.auditPath || getIdentityAuditPath()),
    },
    env: {
      store: {
        name: "OPEN_IDENTITIES_STORE",
        active: Boolean(process.env["OPEN_IDENTITIES_STORE"]),
        includesRawValue: false,
      },
      audit: {
        name: "OPEN_IDENTITIES_AUDIT",
        active: Boolean(process.env["OPEN_IDENTITIES_AUDIT"]),
        includesRawValue: false,
      },
    },
    counts: {
      identities: identities.length,
      byKind,
      identifiers,
      sensitiveIdentifiers,
      emails,
      phones,
      agentProfiles,
      agentRoles,
      uniqueAgentRoles: roles.size,
      toolRefs,
      skillRefs,
      channelRefs,
      scheduleRefs,
      subagentRefs,
      machineAssignments,
      browserPlanProfiles,
      documentSlots: identities.length * identityDocumentKeys.length,
      populatedDocuments,
      maileryRefs,
      telephonyRefs,
      roster: {
        builtInVersion: HASNA_COMPANY_AGENT_ROSTER_VERSION,
        builtInAgents: hasnaCompanyAgentSpecs.length,
        seededCurrentVersion,
        seededOtherVersion,
        deprecatedRefsPresent,
      },
    },
    refs: {
      identities: identities.map(identityStatusRef),
      rawIdentityIdsIncluded: false,
      rawIdentifiersIncluded: false,
    },
    documentKeys: identityDocumentKeys,
    safety: {
      includesNames: false,
      includesContactValues: false,
      includesCredentialValues: false,
      includesDocumentBodies: false,
      includesSensitiveIdentifiers: false,
      includesPrivateKeys: false,
      includesGitHubAppPrivateData: false,
      includesRawEnvValues: false,
      statusOutputIsMetadataOnly: true,
    },
  };
}

export const getIdentityStoreStatus = getIdentityReferenceStatus;

export function projectIdentityMediaStatus(identity: Identity): {
  identityId: string;
  identifier: string;
  kind: IdentityKind;
  name: string;
  voice?: ReturnType<typeof projectVoiceProfile>;
  profileImage?: ReturnType<typeof projectProfileImage>;
  assets: {
    count: number;
    byKind: Record<"voice" | "profile-image", number>;
    items: ReturnType<typeof projectIdentityAsset>[];
  };
} {
  const assets = identity.assets ?? [];
  return {
    identityId: identity.id,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    kind: identity.kind,
    name: identity.displayName ?? identity.fullName,
    voice: projectVoiceProfile(identity.voice),
    profileImage: projectProfileImage(identity.profileImage),
    assets: {
      count: assets.length,
      byKind: {
        voice: assets.filter((asset) => asset.kind === "voice").length,
        "profile-image": assets.filter((asset) => asset.kind === "profile-image").length,
      },
      items: assets.map(projectIdentityAsset),
    },
  };
}

export function projectIdentityMediaSummary(identity: Identity): {
  identityId: string;
  identifier: string;
  kind: IdentityKind;
  name: string;
  assets: number;
  hasVoice: boolean;
  hasProfileImage: boolean;
} {
  return {
    identityId: identity.id,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    kind: identity.kind,
    name: identity.displayName ?? identity.fullName,
    assets: identity.assets?.length ?? 0,
    hasVoice: Boolean(identity.voice),
    hasProfileImage: Boolean(identity.profileImage),
  };
}

function identityStatusRef(identity: Identity): IdentityStatusRef {
  return {
    refId: opaqueRef(identity.id),
    kind: identity.kind,
    hasAgentProfile: Boolean(identity.agent),
    hasSensitiveIdentifiers: identity.identifiers.some((identifier) => identifier.sensitive),
    contactRefs: {
      emails: identity.emails.length,
      phones: identity.phones.length,
    },
    documentRefs: {
      populated: populatedDocumentCount(identity),
      total: identityDocumentKeys.length,
    },
  };
}

function populatedDocumentCount(identity: Identity): number {
  return identityDocumentKeys.filter((key) => Boolean(identity.documents[key]?.trim())).length;
}

function redactStorePath(path: string, kind: "dataDir" | "store" | "audit"): string {
  const defaultDataDir = join(homedir(), ".hasna", "identities");
  const defaultStorePath = join(defaultDataDir, "identities.json");
  const defaultAuditPath = join(defaultDataDir, "audit.jsonl");
  if (kind === "dataDir" && path === defaultDataDir && !process.env["OPEN_IDENTITIES_STORE"]) return "~/.hasna/identities";
  if (kind === "store" && path === defaultStorePath && !process.env["OPEN_IDENTITIES_STORE"]) return "~/.hasna/identities/identities.json";
  if (kind === "audit" && path === defaultAuditPath && !process.env["OPEN_IDENTITIES_AUDIT"]) return "~/.hasna/identities/audit.jsonl";
  return kind === "dataDir" ? "<custom-data-dir>" : kind === "store" ? "<custom-store-path>" : "<custom-audit-path>";
}

function opaqueRef(value: string): string {
  return `identity_${createHash("sha256").update(`open-identities:${value}`).digest("hex").slice(0, 16)}`;
}

function packageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (const relativePath of ["../package.json", "../../package.json"]) {
    try {
      const parsed = JSON.parse(readFileSync(join(currentDir, relativePath), "utf8")) as { version?: string };
      if (parsed.version) return parsed.version;
    } catch {
      // Try the next packaged/source layout before falling back.
    }
  }
  return FALLBACK_PACKAGE_VERSION;
}
