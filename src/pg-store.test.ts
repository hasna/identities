import { describe, expect, spyOn, test } from "bun:test";
import { inspect } from "node:util";
import {
  PgStorageBackend,
  cloudHealth,
  cloudReady,
  createCloudIdentityStore,
  runIdentitiesMigrations,
} from "./pg-store.js";
import { PgIdentityLifecycleStore } from "./pg-user-lifecycle.js";
import { IdentityStore, StorageConflictError, type IdentityStoreFile } from "./storage.js";
import type { PoolQueryClient } from "./generated/storage-kit/query.js";

// Minimal fake query client that emulates the identity_store JSONB row + rev.
function fakeClient(initial?: { rev: number; doc: IdentityStoreFile }) {
  const state: { rev: number; doc: IdentityStoreFile } | null = initial ?? null;
  let current = state;
  const audits: Array<unknown[]> = [];
  return {
    audits,
    peek: () => current,
    async get<T>(sql: string): Promise<T | null> {
      if (/FROM identity_store/i.test(sql)) {
        return current ? ({ rev: current.rev, doc: current.doc } as unknown as T) : null;
      }
      return null;
    },
    async many<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      if (/UPDATE identity_store/i.test(sql)) {
        const [, doc, expected] = params as [string, string, number];
        if (!current || current.rev !== Number(expected)) return [];
        current = { rev: current.rev + 1, doc: JSON.parse(doc) };
        return [{ rev: current.rev } as unknown as T];
      }
      return [];
    },
    async execute(sql: string, params?: readonly unknown[]): Promise<void> {
      if (/INSERT INTO identity_store/i.test(sql)) {
        const [, doc] = params as [string, string];
        current = { rev: (current?.rev ?? 0) + 1, doc: JSON.parse(doc) };
      } else if (/INSERT INTO identity_audit/i.test(sql)) {
        audits.push(params as unknown[]);
      }
    },
  };
}

describe("PgStorageBackend", () => {
  test("read returns empty store when no row exists", async () => {
    const client = fakeClient();
    const backend = new PgStorageBackend(client as any);
    const snap = await backend.read();
    expect(snap.store.identities).toEqual([]);
    expect(snap.token).toBeNull();
  });

  test("full CRUD through IdentityStore on the pg backend", async () => {
    const client = fakeClient();
    const store = new IdentityStore({ backend: new PgStorageBackend(client as any) });

    const created = await store.create({ kind: "agent", fullName: "PG Agent", uniqueIdentifier: "agent:pg" });
    expect(created.fullName).toBe("PG Agent");
    expect(client.peek()?.rev).toBe(1);

    const fetched = await store.get("agent:pg");
    expect(fetched?.id).toBe(created.id);

    const updated = await store.update(created.id, { displayName: "PG" });
    expect(updated.displayName).toBe("PG");
    expect(client.peek()?.rev).toBe(2);

    const deleted = await store.delete(created.id);
    expect(deleted).toBe(true);
    expect((await store.list()).length).toBe(0);
    // create + update + delete each write + are audited
    expect(client.audits.length).toBeGreaterThanOrEqual(3);
  });

  test("write throws StorageConflictError on rev mismatch", async () => {
    const client = fakeClient({ rev: 5, doc: { version: 1, identities: [], instructionSources: [] } });
    const backend = new PgStorageBackend(client as any);
    await expect(
      backend.write({ version: 1, identities: [], instructionSources: [] }, 4),
    ).rejects.toBeInstanceOf(StorageConflictError);
  });

  test("createCloudIdentityStore keeps connection credentials outside the public object graph", async () => {
    const passwordMarker = "identity-password-marker";
    const databaseMarker = "identity-database-marker";
    const databaseUrl =
      `postgresql://identity-user:${passwordMarker}@127.0.0.1:1/${databaseMarker}`;
    const processDatabaseUrl = process.env["HASNA_IDENTITIES_DATABASE_URL"];
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    });

    try {
      const cloud = createCloudIdentityStore({
        env: {
          HASNA_IDENTITIES_STORAGE_MODE: "cloud",
          HASNA_IDENTITIES_DATABASE_URL: databaseUrl,
        },
        applicationName: "identities-explicit-env-test",
        connectionTimeoutMillis: 50,
      });
      expect(cloud.connectionSource).toBe("HASNA_IDENTITIES_DATABASE_URL");
      expect(process.env["HASNA_IDENTITIES_DATABASE_URL"]).toBe(processDatabaseUrl);
      expect(Object.keys(cloud.client).sort()).toEqual([
        "execute",
        "get",
        "many",
        "one",
        "query",
        "transaction",
      ]);
      expect("pool" in cloud.client).toBe(false);
      expect("close" in cloud.client).toBe(false);

      let queryError = "";
      try {
        await cloud.client.query("SELECT 1");
      } catch (error) {
        queryError = String(error);
      }

      for (const marker of [databaseUrl, passwordMarker, databaseMarker]) {
        expect(objectGraphContains(cloud, marker), `object graph leaked ${marker}`).toBe(false);
        expect(JSON.stringify(cloud), `JSON leaked ${marker}`).not.toContain(marker);
        expect(inspect(cloud, { depth: 12, showHidden: true }), `inspect leaked ${marker}`).not.toContain(marker);
        expect(queryError, `query error leaked ${marker}`).not.toContain(marker);
        expect(output.join("\n"), `console leaked ${marker}`).not.toContain(marker);
      }

      await cloud.close();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  test("createCloudIdentityStore redacts an unreadable CA certificate path", () => {
    const pathMarker = "identity-ca-path-marker";
    const caCertPath = `/tmp/${pathMarker}.pem`;

    let caught: unknown;
    try {
      createCloudIdentityStore({
        env: {
          HASNA_IDENTITIES_STORAGE_MODE: "cloud",
          HASNA_IDENTITIES_DATABASE_URL:
            "postgresql://identity-user:identity-password-marker@127.0.0.1:1/identity?sslmode=verify-full",
        },
        caCertPath,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain(pathMarker);
    expect(String(caught)).not.toContain(caCertPath);
    expect((caught as Error).cause).toBeUndefined();
    expect((caught as NodeJS.ErrnoException).path).toBeUndefined();
  });

  test("direct public store constructors also restrict raw pool-bearing clients", () => {
    const marker = "identity-direct-pool-marker";
    const rawClient = {
      ...fakeClient(),
      pool: { options: { connectionString: marker } },
      async query() {
        return { rowCount: 0, rows: [] };
      },
      async one() {
        throw new Error("not used");
      },
      async transaction<T>(fn: (client: PoolQueryClient) => Promise<T>): Promise<T> {
        return fn(rawClient as unknown as PoolQueryClient);
      },
      async close() {},
    } as unknown as PoolQueryClient;

    expect(objectGraphContains(new PgStorageBackend(rawClient), marker)).toBe(false);
    expect(objectGraphContains(new PgIdentityLifecycleStore(rawClient), marker)).toBe(false);
  });

  const liveDatabaseUrl = process.env["TEST_DATABASE_URL"];
  const liveTest = liveDatabaseUrl === undefined ? test.skip : test;

  liveTest("public cloud client supports real query, transaction, migrations, readiness, and close", async () => {
    const cloud = createCloudIdentityStore({
      env: {
        HASNA_IDENTITIES_STORAGE_MODE: "cloud",
        HASNA_IDENTITIES_DATABASE_URL: liveDatabaseUrl,
      },
      applicationName: "identities-public-cloud-client-test",
    });

    try {
      const principal = await cloud.client.one<{ principal: string }>(
        "SELECT current_user AS principal",
      );
      expect(typeof principal.principal).toBe("string");
      expect(principal.principal.length).toBeGreaterThan(0);
      expect(
        await cloud.client.transaction((tx) => tx.one<{ value: number }>("SELECT 2 AS value")),
      ).toEqual({ value: 2 });
      await runIdentitiesMigrations(cloud.client);
      expect((await cloudHealth(cloud.client)).ok).toBe(true);
      const readiness = await cloudReady(cloud.client);
      expect(readiness.ok).toBe(true);
      expect(readiness.pendingMigrations).toEqual([]);
    } finally {
      await cloud.close();
    }
  }, 30_000);
});

function objectGraphContains(
  value: unknown,
  marker: string,
  depth = 12,
  seen = new Set<object>(),
): boolean {
  if (typeof value === "string") return value.includes(marker);
  if ((typeof value !== "object" && typeof value !== "function") || value === null || depth === 0) {
    return false;
  }
  if (seen.has(value)) return false;
  seen.add(value);

  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor && objectGraphContains(descriptor.value, marker, depth - 1, seen)) {
      return true;
    }
  }
  return false;
}
