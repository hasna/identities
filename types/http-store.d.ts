import { IdentityStore, type IdentityStoreOptions, type ListInstructionSourceOptions, type ReplaceAllOptions } from "./storage.js";
import type { BrowserPlanProfileReservationInput, CreateIdentityInput, EmailAddress, Identity, IdentityMachineAssignmentInput, InstructionSource, InstructionSourceInput, PhoneNumber, UpdateIdentityInput } from "./types.js";
export interface CloudHttpConfig {
    /** Base URL, e.g. https://identities.your-deployment.example (the `/v1` prefix is appended). */
    apiUrl: string;
    /** Bearer API key (never logged). */
    apiKey: string;
    /** Per-request timeout in ms (default 30000). */
    timeoutMs?: number;
}
export declare class CloudHttpError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(status: number, message: string, body?: unknown | undefined);
}
/** Client transport selected by the environment. */
export type StorageTransport = "api" | "local";
/**
 * Environment variable map accepted by the resolvers below.
 *
 * Declared structurally instead of using the Node ambient process-env type so the
 * published declarations never force `@types/node` on a consumer. `process.env`
 * is assignable to it.
 */
export type EnvironmentVariables = Record<string, string | undefined>;
/**
 * Resolve the cloud HTTP config from the environment.
 * - both vars set   -> returns config (api transport; self_hosted or cloud)
 * - neither set     -> returns null (local file store)
 * - exactly one set -> throws (misconfigured; never silently fall back to local)
 */
export declare function resolveCloudHttpConfig(env?: EnvironmentVariables): CloudHttpConfig | null;
/**
 * Resolve which client transport to use from the environment.
 *
 * Selection (matches the shared self-host storage standard):
 *  - `HASNA_IDENTITIES_STORAGE_MODE` wins when set:
 *      `local`                              -> local file store
 *      `api` | `cloud` | `self_hosted`      -> api transport (requires URL + KEY)
 *  - otherwise the presence of both API_URL + API_KEY selects `api`; else `local`.
 *
 * The only tier words are `local` | `self_hosted` | `cloud` (`api`/`http` are
 * plain transport aliases). `remote` and `hybrid` are NOT tier words and are
 * rejected. The raw RDS DSN is NEVER a client transport — `self_hosted` and
 * `cloud` both mean "route to the HTTPS `/v1` API with a bearer key". Only the
 * server process (src/server) talks to Postgres directly.
 */
export declare function resolveStorageTransport(env?: EnvironmentVariables): StorageTransport;
/**
 * Resolve the storage backend for the identities CLI / MCP / SDK.
 * Returns an {@link CloudHttpIdentityStore} (api transport) when the environment
 * selects `api`, otherwise a local {@link IdentityStore}. Pass `preferLocal`
 * (e.g. when `--store` is given) to force the local file store regardless of env.
 */
export declare function resolveIdentityStore(options?: IdentityStoreOptions & {
    preferLocal?: boolean;
}): IdentityStore;
export declare class CloudHttpIdentityStore extends IdentityStore {
    private readonly base;
    private readonly apiKey;
    private readonly timeoutMs;
    constructor(config: CloudHttpConfig, options?: IdentityStoreOptions);
    private request;
    private patchIdentity;
    list(): Promise<Identity[]>;
    get(target: string): Promise<Identity | undefined>;
    require(target: string): Promise<Identity>;
    listInstructionSources(options?: ListInstructionSourceOptions): Promise<InstructionSource[]>;
    listStoreInstructionSources(): Promise<InstructionSource[]>;
    setInstructionSource(input: InstructionSourceInput | InstructionSource): Promise<InstructionSource>;
    replaceInstructionSources(sources: Array<InstructionSourceInput | InstructionSource>, options?: {
        identityTarget?: string;
    }): Promise<InstructionSource[]>;
    create(input: CreateIdentityInput): Promise<Identity>;
    update(target: string, input: UpdateIdentityInput): Promise<Identity>;
    delete(target: string): Promise<boolean>;
    linkEmail(target: string, email: EmailAddress | string): Promise<Identity>;
    linkPhone(target: string, phone: PhoneNumber | string): Promise<Identity>;
    assignMachine(target: string, assignment: IdentityMachineAssignmentInput): Promise<Identity>;
    reserveBrowserPlanProfile(target: string, reservation: BrowserPlanProfileReservationInput): Promise<Identity>;
    replaceAll(identities: Identity[], options?: ReplaceAllOptions): Promise<void>;
}
