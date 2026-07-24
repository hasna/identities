import { IdentityStore, type IdentityStoreFile, type StorageBackend, type StorageSnapshot, type StorageToken } from "./storage.js";
import { type HealthResult, type PoolQueryClient, type ReadyResult, type TypedQueryClient } from "./generated/storage-kit/index.js";
export declare const IDENTITIES_APP_NAME = "identities";
/** JSONB-document backend guarded by an optimistic-concurrency `rev`. */
export declare class PgStorageBackend implements StorageBackend {
    private readonly client;
    private readonly storeId;
    constructor(client: TypedQueryClient, storeId?: string);
    read(): Promise<StorageSnapshot>;
    write(store: IdentityStoreFile, token?: StorageToken): Promise<void>;
    appendAudit(action: string, target: string): Promise<void>;
}
export interface CloudIdentityStore {
    store: IdentityStore;
    client: PoolQueryClient;
    connectionSource: string;
    close: () => Promise<void>;
}
/**
 * Build an {@link IdentityStore} backed by the shared cloud Postgres. Throws if
 * storage mode is not `cloud` or the database URL is missing (see kit contract).
 */
export declare function createCloudIdentityStore(options?: {
    storeId?: string;
    applicationName?: string;
}): CloudIdentityStore;
/** Apply all pending cloud migrations (identity store + api keys). */
export declare function runIdentitiesMigrations(client: TypedQueryClient, opts?: {
    dryRun?: boolean;
}): Promise<import("./generated/storage-kit/migrations.js").MigrationResult>;
export declare function cloudHealth(client: TypedQueryClient): Promise<HealthResult>;
export declare function cloudReady(client: TypedQueryClient): Promise<ReadyResult>;
