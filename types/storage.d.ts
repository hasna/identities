import type { BrowserPlanCoverageOptions, ListBrowserPlanProfilesOptions } from "./browserplan.js";
import type { BrowserPlanCoverageReport, BrowserPlanIdentityProfile, BrowserPlanProfileReservationInput, CreateIdentityInput, EmailAddress, Identity, IdentityContactCard, InstructionSource, InstructionSourceInput, InstructionSourceValidationResult, IdentityMachineAssignmentInput, PhoneNumber, UpdateIdentityInput } from "./types.js";
export interface IdentityStoreOptions {
    filePath?: string;
    auditPath?: string;
    /** Pluggable persistence backend. Defaults to a local JSON file backend. */
    backend?: StorageBackend;
}
export interface ListByMachineOptions {
    purpose?: string;
}
export interface IdentityStoreFile {
    version: 1;
    identities: Identity[];
    instructionSources?: InstructionSource[];
}
/** Opaque optimistic-concurrency token round-tripped between read and write. */
export type StorageToken = unknown;
export interface StorageSnapshot {
    store: IdentityStoreFile;
    token?: StorageToken;
}
/**
 * Persistence backend for {@link IdentityStore}. The file backend (default) and
 * the cloud Postgres backend both implement this. All mutation/normalization
 * logic lives in {@link IdentityStore} and the core lib; a backend only does IO.
 */
export interface StorageBackend {
    read(): Promise<StorageSnapshot>;
    /** Persist the whole store. `token` (if given) enables optimistic CAS. */
    write(store: IdentityStoreFile, token?: StorageToken): Promise<void>;
    appendAudit(action: string, target: string): Promise<void>;
}
/** Thrown by a backend when an optimistic-concurrency write loses a race. */
export declare class StorageConflictError extends Error {
    constructor(message?: string);
}
export interface ListInstructionSourceOptions {
    identityTarget?: string;
    includeIdentityDocuments?: boolean;
}
export interface ReplaceAllOptions {
    instructionSources?: Array<InstructionSourceInput | InstructionSource>;
}
export declare function getIdentityDataDir(): string;
export declare function getIdentityStorePath(): string;
export declare function getIdentityAuditPath(): string;
export declare class IdentityStore {
    readonly filePath: string;
    readonly auditPath: string;
    private readonly backend;
    private mutationQueue;
    constructor(options?: IdentityStoreOptions);
    list(): Promise<Identity[]>;
    listCards(): Promise<IdentityContactCard[]>;
    listInstructionSources(options?: ListInstructionSourceOptions): Promise<InstructionSource[]>;
    listStoreInstructionSources(): Promise<InstructionSource[]>;
    getInstructionSource(id: string): Promise<InstructionSource | undefined>;
    requireInstructionSource(id: string): Promise<InstructionSource>;
    setInstructionSource(input: InstructionSourceInput | InstructionSource): Promise<InstructionSource>;
    replaceInstructionSources(sources: Array<InstructionSourceInput | InstructionSource>, options?: {
        identityTarget?: string;
    }): Promise<InstructionSource[]>;
    validateInstructionSources(options?: ListInstructionSourceOptions): Promise<InstructionSourceValidationResult>;
    listByMachine(machineId: string, options?: ListByMachineOptions): Promise<Identity[]>;
    listBrowserPlanProfilesByMachine(machineId: string, options?: ListBrowserPlanProfilesOptions): Promise<BrowserPlanIdentityProfile[]>;
    getBrowserPlanCoverage(options?: BrowserPlanCoverageOptions): Promise<BrowserPlanCoverageReport>;
    get(target: string): Promise<Identity | undefined>;
    require(target: string): Promise<Identity>;
    create(input: CreateIdentityInput): Promise<Identity>;
    update(target: string, input: UpdateIdentityInput): Promise<Identity>;
    delete(target: string): Promise<boolean>;
    replaceAll(identities: Identity[], options?: ReplaceAllOptions): Promise<void>;
    validate(): Promise<{
        valid: true;
        count: number;
    }>;
    linkEmail(target: string, email: EmailAddress | string): Promise<Identity>;
    linkPhone(target: string, phone: PhoneNumber | string): Promise<Identity>;
    assignMachine(target: string, assignment: IdentityMachineAssignmentInput): Promise<Identity>;
    reserveBrowserPlanProfile(target: string, reservation: BrowserPlanProfileReservationInput): Promise<Identity>;
    private readStore;
    private writeStore;
    private writeAuditEvent;
    private updateUnlocked;
    private withMutation;
}
export declare function createIdentityStore(options?: IdentityStoreOptions): IdentityStore;
/** Default backend: an atomic (temp-file + rename) local JSON store + JSONL audit log. */
export declare class FileStorageBackend implements StorageBackend {
    private readonly filePath;
    private readonly auditPath;
    constructor(filePath: string, auditPath: string);
    read(): Promise<StorageSnapshot>;
    write(store: IdentityStoreFile): Promise<void>;
    appendAudit(action: string, target: string): Promise<void>;
}
