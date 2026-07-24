// Cloud (Postgres) persistence backend for @hasna/identities.
//
// PURE REMOTE per Amendment A1: every read/write hits the shared cloud Postgres
// directly through the vendored storage kit. The whole identity store lives in a
// single JSONB document row guarded by an optimistic-concurrency `rev`, so the
// existing core-lib mutation/validation logic runs unchanged (see storage.ts).

import { normalizePersistedIdentity } from "./core.js";
import { normalizeInstructionSources } from "./instructions.js";
import {
  IdentityStore,
  StorageConflictError,
  type IdentityStoreFile,
  type StorageBackend,
  type StorageSnapshot,
  type StorageToken,
} from "./storage.js";
import {
  MigrationLedger,
  checkHealth,
  checkReady,
  createCloudPoolFromEnv,
  type CreateCloudPoolFromEnvOptions,
  type HealthResult,
  type ReadyResult,
  type TypedQueryClient,
} from "./generated/storage-kit/index.js";
import { DEFAULT_STORE_ID, IDENTITY_AUDIT_TABLE, IDENTITY_STORE_TABLE, identitiesMigrations } from "./migrations.js";
import { PgIdentityLifecycleStore } from "./pg-user-lifecycle.js";
import {
  restrictTransactionalQueryClient,
  restrictTypedQueryClient,
  type TransactionalQueryClient,
} from "./transactional-query-client.js";

export const IDENTITIES_APP_NAME = "identities";

function emptyStore(): IdentityStoreFile {
  return { version: 1, identities: [], instructionSources: [] };
}

interface StoreRow {
  rev: string | number;
  doc: unknown;
}

/** JSONB-document backend guarded by an optimistic-concurrency `rev`. */
export class PgStorageBackend implements StorageBackend {
  private readonly client: TypedQueryClient;
  private readonly storeId: string;

  constructor(client: TypedQueryClient, storeId: string = DEFAULT_STORE_ID) {
    this.client = restrictTypedQueryClient(client);
    this.storeId = storeId;
  }

  async read(): Promise<StorageSnapshot> {
    const row = await this.client.get<StoreRow>(
      `SELECT rev, doc FROM ${IDENTITY_STORE_TABLE} WHERE id = $1`,
      [this.storeId],
    );
    if (!row) {
      return { store: emptyStore(), token: null };
    }
    const doc = (typeof row.doc === "string" ? JSON.parse(row.doc) : row.doc) as Partial<IdentityStoreFile>;
    return {
      store: {
        version: 1,
        identities: (doc.identities ?? []).map(normalizePersistedIdentity),
        instructionSources: normalizeInstructionSources(doc.instructionSources),
      },
      token: Number(row.rev),
    };
  }

  async write(store: IdentityStoreFile, token?: StorageToken): Promise<void> {
    const doc = JSON.stringify({
      version: 1,
      identities: store.identities,
      instructionSources: store.instructionSources ?? [],
    });

    if (token === null || token === undefined) {
      // Bootstrap / first write (no prior row observed). Upsert and bump rev.
      await this.client.execute(
        `INSERT INTO ${IDENTITY_STORE_TABLE} (id, rev, doc, updated_at)
           VALUES ($1, 1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE
           SET rev = ${IDENTITY_STORE_TABLE}.rev + 1, doc = EXCLUDED.doc, updated_at = now()`,
        [this.storeId, doc],
      );
      return;
    }

    const rows = await this.client.many<{ rev: number }>(
      `UPDATE ${IDENTITY_STORE_TABLE}
         SET rev = rev + 1, doc = $2::jsonb, updated_at = now()
       WHERE id = $1 AND rev = $3
       RETURNING rev`,
      [this.storeId, doc, Number(token)],
    );
    if (rows.length === 0) throw new StorageConflictError();
  }

  async appendAudit(action: string, target: string): Promise<void> {
    await this.client.execute(
      `INSERT INTO ${IDENTITY_AUDIT_TABLE} (store_id, action, target) VALUES ($1, $2, $3)`,
      [this.storeId, action, target],
    );
  }
}

export interface CloudIdentityStore {
  store: IdentityStore;
  lifecycleStore: PgIdentityLifecycleStore;
  client: TransactionalQueryClient;
  connectionSource: string;
  close: () => Promise<void>;
}

export interface CreateCloudIdentityStoreOptions extends CreateCloudPoolFromEnvOptions {
  storeId?: string;
}

/**
 * Build an {@link IdentityStore} backed by the shared cloud Postgres. Throws if
 * storage mode is not `cloud` or the database URL is missing (see kit contract).
 */
export function createCloudIdentityStore(options: CreateCloudIdentityStoreOptions = {}): CloudIdentityStore {
  const { storeId, ...poolOptions } = options;
  const { client: poolClient, connectionSource } = createIdentitiesCloudPool(poolOptions);
  const client = restrictTransactionalQueryClient(poolClient);
  const store = new IdentityStore({ backend: new PgStorageBackend(client, storeId) });
  return {
    store,
    lifecycleStore: new PgIdentityLifecycleStore(client),
    client,
    connectionSource,
    close: async () => {
      await poolClient.close();
    },
  };
}

function createIdentitiesCloudPool(options: CreateCloudPoolFromEnvOptions) {
  try {
    return createCloudPoolFromEnv(IDENTITIES_APP_NAME, {
      ...options,
      applicationName: options.applicationName ?? "identities-serve",
    });
  } catch (error) {
    if (isCertificateFileAccessError(error)) {
      throw new Error("Unable to load the configured identities database CA certificate.");
    }
    throw error;
  }
}

function isCertificateFileAccessError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") {
    return false;
  }
  return ["EACCES", "EISDIR", "ENOENT", "ENOTDIR"].includes(error.code);
}

/** Apply all pending cloud migrations (identity store + api keys). */
export async function runIdentitiesMigrations(
  client: TypedQueryClient,
  opts: { dryRun?: boolean } = {},
) {
  const ledger = new MigrationLedger(client, identitiesMigrations());
  return ledger.migrate(opts);
}

export async function cloudHealth(client: TypedQueryClient): Promise<HealthResult> {
  return checkHealth(client);
}

export async function cloudReady(client: TypedQueryClient): Promise<ReadyResult> {
  return checkReady(client, identitiesMigrations());
}
