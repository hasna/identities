import { describe, expect, spyOn, test } from "bun:test";
import { PgStorageBackend, createCloudIdentityStore } from "./pg-store.js";
import { IdentityStore, StorageConflictError, type IdentityStoreFile } from "./storage.js";

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

  test("createCloudIdentityStore honors an explicit env without logging the database URL", async () => {
    const databaseUrl = "postgresql://localhost:6543/identities_fixture";
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
      });
      expect(cloud.connectionSource).toBe("HASNA_IDENTITIES_DATABASE_URL");
      expect(process.env["HASNA_IDENTITIES_DATABASE_URL"]).toBe(processDatabaseUrl);
      await cloud.close();
      expect(output.join("\n")).not.toContain(databaseUrl);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
