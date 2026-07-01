import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createBrowserPlanCoverageReport, listBrowserPlanProfiles } from "./browserplan.js";
import {
  addEmail,
  addPhone,
  assignMachine,
  createIdentity,
  identityHasMachineAssignment,
  identityToContactCard,
  normalizeMachineId,
  normalizePersistedIdentity,
  reserveBrowserPlanProfile,
  updateIdentity,
} from "./core.js";
import {
  listIdentityInstructionSources,
  normalizeInstructionSource,
  normalizeInstructionSources,
  sortInstructionSources,
  validateInstructionSources,
} from "./instructions.js";
import type {
  BrowserPlanCoverageOptions,
  ListBrowserPlanProfilesOptions,
} from "./browserplan.js";
import type {
  BrowserPlanCoverageReport,
  BrowserPlanIdentityProfile,
  BrowserPlanProfileReservationInput,
  CreateIdentityInput,
  EmailAddress,
  Identity,
  IdentityAssetInput,
  IdentityContactCard,
  IdentityIdentifier,
  InstructionSource,
  InstructionSourceInput,
  InstructionSourceValidationResult,
  IdentityMachineAssignmentInput,
  PhoneNumber,
  UpdateIdentityInput,
} from "./types.js";

export interface IdentityStoreOptions {
  filePath?: string;
  auditPath?: string;
}

export interface ListByMachineOptions {
  purpose?: string;
}

interface IdentityStoreFile {
  version: 1;
  identities: Identity[];
  instructionSources?: InstructionSource[];
}

export interface ListInstructionSourceOptions {
  identityTarget?: string;
  includeIdentityDocuments?: boolean;
}

export interface ReplaceAllOptions {
  instructionSources?: Array<InstructionSourceInput | InstructionSource>;
}

export function getIdentityDataDir(): string {
  return join(homedir(), ".hasna", "identities");
}

export function getIdentityStorePath(): string {
  return process.env["OPEN_IDENTITIES_STORE"] || join(getIdentityDataDir(), "identities.json");
}

export function getIdentityAuditPath(): string {
  return process.env["OPEN_IDENTITIES_AUDIT"] || join(getIdentityDataDir(), "audit.jsonl");
}

export class IdentityStore {
  readonly filePath: string;
  readonly auditPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: IdentityStoreOptions = {}) {
    this.filePath = options.filePath ?? getIdentityStorePath();
    this.auditPath = options.auditPath ?? getIdentityAuditPath();
  }

  async list(): Promise<Identity[]> {
    return (await this.readStore()).identities;
  }

  async listCards(): Promise<IdentityContactCard[]> {
    return (await this.list()).map(identityToContactCard);
  }

  async listInstructionSources(options: ListInstructionSourceOptions = {}): Promise<InstructionSource[]> {
    const store = await this.readStore();
    return listInstructionSourcesFromStore(store, options);
  }

  async listStoreInstructionSources(): Promise<InstructionSource[]> {
    return normalizeInstructionSources((await this.readStore()).instructionSources);
  }

  async getInstructionSource(id: string): Promise<InstructionSource | undefined> {
    return (await this.listInstructionSources()).find((source) => source.id === id);
  }

  async requireInstructionSource(id: string): Promise<InstructionSource> {
    const source = await this.getInstructionSource(id);
    if (!source) throw new Error(`Instruction source not found: ${id}`);
    return source;
  }

  async setInstructionSource(input: InstructionSourceInput | InstructionSource): Promise<InstructionSource> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const normalized = normalizeInstructionSource(input);
      if (normalized.owner.kind === "identity" || normalized.owner.kind === "persona") {
        const identity = requireIdentityFromList(store.identities, normalized.owner.id);
        const source = normalizeInstructionSource({
          ...normalized,
          owner: {
            ...normalized.owner,
            id: identity.id,
            name: normalized.owner.name ?? identity.displayName ?? identity.fullName,
          },
        }, { identityId: identity.id });
        const nextIdentities = store.identities.map((candidate) => candidate.id === identity.id
          ? { ...candidate, instructionSources: upsertInstructionSource(candidate.instructionSources, source) }
          : candidate);
        assertValidInstructionSourceGraph({ ...store, identities: nextIdentities });
        store.identities = nextIdentities;
        await this.writeStore(store);
        await this.writeAuditEvent("set-instruction-source", source.id);
        return source;
      }

      const nextStoreSources = upsertInstructionSource(store.instructionSources ?? [], normalized);
      assertValidInstructionSourceGraph({ ...store, instructionSources: nextStoreSources });
      store.instructionSources = nextStoreSources;
      await this.writeStore(store);
      await this.writeAuditEvent("set-instruction-source", normalized.id);
      return normalized;
    });
  }

  async replaceInstructionSources(
    sources: Array<InstructionSourceInput | InstructionSource>,
    options: { identityTarget?: string } = {},
  ): Promise<InstructionSource[]> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      if (options.identityTarget) {
        const identity = requireIdentityFromList(store.identities, options.identityTarget);
        const nextSources = normalizeInstructionSources(sources, { identityId: identity.id });
        const nextIdentities = store.identities.map((candidate) => candidate.id === identity.id
          ? { ...candidate, instructionSources: nextSources }
          : candidate);
        assertValidInstructionSourceGraph({ ...store, identities: nextIdentities });
        store.identities = nextIdentities;
        await this.writeStore(store);
        await this.writeAuditEvent("replace-identity-instruction-sources", identity.id);
        return nextSources;
      }

      const nextStoreSources = normalizeInstructionSources(sources);
      assertValidInstructionSourceGraph({ ...store, instructionSources: nextStoreSources });
      store.instructionSources = nextStoreSources;
      await this.writeStore(store);
      await this.writeAuditEvent("replace-instruction-sources", `${store.instructionSources.length}`);
      return store.instructionSources;
    });
  }

  async validateInstructionSources(options: ListInstructionSourceOptions = {}): Promise<InstructionSourceValidationResult> {
    return validateInstructionSources(await this.listInstructionSources(options));
  }

  async listByMachine(machineId: string, options: ListByMachineOptions = {}): Promise<Identity[]> {
    const normalizedMachineId = normalizeMachineId(machineId);
    return (await this.list()).filter((identity) => {
      return identityHasMachineAssignment(identity, normalizedMachineId, options.purpose);
    });
  }

  async listBrowserPlanProfilesByMachine(
    machineId: string,
    options: ListBrowserPlanProfilesOptions = {},
  ): Promise<BrowserPlanIdentityProfile[]> {
    return listBrowserPlanProfiles(await this.list(), machineId, options);
  }

  async getBrowserPlanCoverage(options: BrowserPlanCoverageOptions = {}): Promise<BrowserPlanCoverageReport> {
    return createBrowserPlanCoverageReport(await this.list(), options);
  }

  async get(target: string): Promise<Identity | undefined> {
    const identities = await this.list();
    return identities.find((identity) => matchesIdentity(identity, target));
  }

  async require(target: string): Promise<Identity> {
    const identity = await this.get(target);
    if (!identity) throw new Error(`Identity not found: ${target}`);
    return identity;
  }

  async create(input: CreateIdentityInput): Promise<Identity> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const identity = createIdentity(input);
      assertNoDuplicate(store.identities, identity);
      store.identities.push(identity);
      await this.writeStore(store);
      await this.writeAuditEvent("create", identity.id);
      return identity;
    });
  }

  async update(target: string, input: UpdateIdentityInput): Promise<Identity> {
    return this.withMutation(async () => {
      return await this.updateUnlocked(target, input);
    });
  }

  async delete(target: string): Promise<boolean> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const next = store.identities.filter((identity) => !matchesIdentity(identity, target));
      if (next.length === store.identities.length) return false;
      await this.writeStore({ ...store, identities: next });
      await this.writeAuditEvent("delete", target);
      return true;
    });
  }

  async replaceAll(identities: Identity[], options: ReplaceAllOptions = {}): Promise<void> {
    return this.withMutation(async () => {
      const current = await this.readStore();
      const normalized = identities.map((identity) => updateIdentity(identity, {}));
      for (const identity of normalized) {
        assertNoDuplicate(normalized, identity, identity.id);
      }
      const instructionSources = options.instructionSources === undefined
        ? current.instructionSources
        : normalizeInstructionSources(options.instructionSources);
      const nextStore = { version: 1 as const, identities: normalized, instructionSources };
      assertValidInstructionSourceGraph(nextStore);
      await this.writeStore(nextStore);
      await this.writeAuditEvent("replace-all", `${normalized.length}`);
    });
  }

  async validate(): Promise<{ valid: true; count: number }> {
    const identities = await this.list();
    for (const identity of identities) {
      assertNoDuplicate(identities, identity, identity.id);
    }
    return { valid: true, count: identities.length };
  }

  async linkEmail(target: string, email: EmailAddress | string): Promise<Identity> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const index = store.identities.findIndex((identity) => matchesIdentity(identity, target));
      if (index === -1) throw new Error(`Identity not found: ${target}`);

      const updated = addEmail(store.identities[index], email);
      assertNoDuplicate(store.identities, updated, store.identities[index].id);
      store.identities[index] = updated;
      await this.writeStore(store);
      await this.writeAuditEvent("update", updated.id);
      return updated;
    });
  }

  async linkPhone(target: string, phone: PhoneNumber | string): Promise<Identity> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const index = store.identities.findIndex((identity) => matchesIdentity(identity, target));
      if (index === -1) throw new Error(`Identity not found: ${target}`);

      const updated = addPhone(store.identities[index], phone);
      assertNoDuplicate(store.identities, updated, store.identities[index].id);
      store.identities[index] = updated;
      await this.writeStore(store);
      await this.writeAuditEvent("update", updated.id);
      return updated;
    });
  }

  async assignMachine(target: string, assignment: IdentityMachineAssignmentInput): Promise<Identity> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const index = store.identities.findIndex((identity) => matchesIdentity(identity, target));
      if (index === -1) throw new Error(`Identity not found: ${target}`);

      const updated = assignMachine(store.identities[index], assignment);
      assertNoDuplicate(store.identities, updated, store.identities[index].id);
      store.identities[index] = updated;
      await this.writeStore(store);
      await this.writeAuditEvent("assign-machine", updated.id);
      return updated;
    });
  }

  async reserveBrowserPlanProfile(
    target: string,
    reservation: BrowserPlanProfileReservationInput,
  ): Promise<Identity> {
    return this.withMutation(async () => {
      const store = await this.readStore();
      const index = store.identities.findIndex((identity) => matchesIdentity(identity, target));
      if (index === -1) throw new Error(`Identity not found: ${target}`);

      const updated = reserveBrowserPlanProfile(store.identities[index], reservation);
      assertNoDuplicate(store.identities, updated, store.identities[index].id);
      store.identities[index] = updated;
      await this.writeStore(store);
      await this.writeAuditEvent("reserve-browserplan-profile", updated.id);
      return updated;
    });
  }

  private async readStore(): Promise<IdentityStoreFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as IdentityStoreFile;
      return {
        version: 1,
        identities: (parsed.identities ?? []).map(normalizePersistedIdentity),
        instructionSources: normalizeInstructionSources(parsed.instructionSources),
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return { version: 1, identities: [], instructionSources: [] };
      }
      throw error;
    }
  }

  private async writeStore(store: IdentityStoreFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  private async writeAuditEvent(action: string, target: string): Promise<void> {
    await mkdir(dirname(this.auditPath), { recursive: true, mode: 0o700 });
    await appendFile(
      this.auditPath,
      `${JSON.stringify({ action, target, at: new Date().toISOString(), store: this.filePath })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  private async updateUnlocked(target: string, input: UpdateIdentityInput): Promise<Identity> {
    const store = await this.readStore();
    const index = store.identities.findIndex((identity) => matchesIdentity(identity, target));
    if (index === -1) throw new Error(`Identity not found: ${target}`);

    const mergedAssets: IdentityAssetInput[] | undefined = input.assets
      ? [...store.identities[index].assets, ...input.assets]
      : undefined;
    const updated = updateIdentity(store.identities[index], {
      ...input,
      assets: mergedAssets,
    });
    assertNoDuplicate(store.identities, updated, store.identities[index].id);
    store.identities[index] = updated;
    await this.writeStore(store);
    await this.writeAuditEvent("update", updated.id);
    return updated;
  }

  private async withMutation<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function createIdentityStore(options?: IdentityStoreOptions): IdentityStore {
  return new IdentityStore(options);
}

function matchesIdentity(identity: Identity, target: string): boolean {
  const normalizedTarget = target.toLowerCase();
  return (
    identity.id === target ||
    identifierMatches(identity.uniqueIdentifier, target) ||
    identity.identifiers.some((identifier) => identifierMatches(identifier, target)) ||
    identity.emails.some((email) => email.address.toLowerCase() === normalizedTarget) ||
    identity.phones.some((phone) => phone.number === target)
  );
}

function requireIdentityFromList(identities: Identity[], target: string): Identity {
  const identity = identities.find((candidate) => matchesIdentity(candidate, target));
  if (!identity) throw new Error(`Identity not found: ${target}`);
  return identity;
}

function upsertInstructionSource(sources: InstructionSource[], source: InstructionSource): InstructionSource[] {
  return sortInstructionSources([
    ...sources.filter((candidate) => candidate.id !== source.id),
    source,
  ]);
}

function listInstructionSourcesFromStore(
  store: IdentityStoreFile,
  options: ListInstructionSourceOptions = {},
): InstructionSource[] {
  const identities = options.identityTarget
    ? [requireIdentityFromList(store.identities, options.identityTarget)]
    : store.identities;
  const storeSources = options.identityTarget ? [] : normalizeInstructionSources(store.instructionSources);
  const identitySources = identities.flatMap((identity) => listIdentityInstructionSources(identity, {
    includeDocuments: options.includeIdentityDocuments,
  }));
  return sortInstructionSources([...storeSources, ...identitySources]);
}

function assertValidInstructionSourceGraph(store: IdentityStoreFile): void {
  const result = validateInstructionSources(listInstructionSourcesFromStore(store));
  if (result.valid) return;
  const errors = result.issues.filter((issue) => issue.severity === "error");
  const summary = errors.map((issue) => {
    const source = issue.sourceId ? ` ${issue.sourceId}` : "";
    return `${issue.code}${source}: ${issue.message}`;
  }).join("; ");
  throw new Error(`Invalid instruction source graph: ${summary}`);
}

function identifierMatches(identifier: IdentityIdentifier, target: string): boolean {
  return identifier.value === target || `${identifier.scheme}:${identifier.value}` === target;
}

function assertNoDuplicate(identities: Identity[], identity: Identity, existingId?: string): void {
  const duplicate = identities.find((candidate) => {
    if (existingId && candidate.id === existingId) return false;
    return (
      candidate.id === identity.id ||
      identifierKey(candidate.uniqueIdentifier) === identifierKey(identity.uniqueIdentifier) ||
      candidate.identifiers.some((candidateIdentifier) => identity.identifiers.some((identifier) => identifierKey(candidateIdentifier) === identifierKey(identifier))) ||
      candidate.emails.some((candidateEmail) => identity.emails.some((email) => candidateEmail.address.toLowerCase() === email.address.toLowerCase())) ||
      candidate.phones.some((candidatePhone) => identity.phones.some((phone) => candidatePhone.number === phone.number)) ||
      hasDuplicateMachineSlot(candidate, identity) ||
      hasDuplicateBrowserPlanProfile(candidate, identity)
    );
  });

  if (duplicate) {
    throw new Error(`Identity conflicts with existing record: ${duplicate.id}`);
  }
}

function identifierKey(identifier: IdentityIdentifier): string {
  return `${identifier.scheme}:${identifier.value}`;
}

function hasDuplicateMachineSlot(candidate: Identity, identity: Identity): boolean {
  return (candidate.machineAssignments ?? []).some((candidateAssignment) => {
    if (candidateAssignment.status === "released" || !candidateAssignment.slot) return false;
    return (identity.machineAssignments ?? []).some((assignment) => {
      if (assignment.status === "released" || !assignment.slot) return false;
      return (
        candidateAssignment.machineId === assignment.machineId &&
        machineAssignmentPurpose(candidateAssignment) === machineAssignmentPurpose(assignment) &&
        candidateAssignment.slot === assignment.slot
      );
    });
  });
}

function hasDuplicateBrowserPlanProfile(candidate: Identity, identity: Identity): boolean {
  return (candidate.browserPlanProfiles ?? []).some((candidateProfile) => {
    if (candidateProfile.status === "released") return false;
    return (identity.browserPlanProfiles ?? []).some((profile) => {
      if (profile.status === "released") return false;
      const sameMachine = candidateProfile.machineId === profile.machineId;
      const sameEmail = candidateProfile.email.toLowerCase() === profile.email.toLowerCase();
      const sameSlot = Boolean(candidateProfile.slot && profile.slot && candidateProfile.slot === profile.slot);
      return sameMachine && (sameEmail || sameSlot);
    });
  });
}

function machineAssignmentPurpose(assignment: { purpose?: string }): string {
  return assignment.purpose ?? "browserplan";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
