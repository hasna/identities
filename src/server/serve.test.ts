import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mintApiKey } from "@hasna/contracts/auth";
import { IdentityStore, type IdentityStoreFile, type StorageBackend, type StorageSnapshot } from "../storage.js";
import type { AuthSession } from "../sdk/client.js";
import { createFetchHandler } from "./serve.js";
import type { CloudIdentityStore } from "../pg-store.js";

const SIGNING_SECRET = "test-signing-secret-for-identities-serve";

// In-memory backend: mirrors the JSONB single-doc cloud backend semantics.
class MemoryBackend implements StorageBackend {
  private doc: IdentityStoreFile = { version: 1, identities: [], instructionSources: [] };
  private rev = 0;
  readonly audit: Array<{ action: string; target: string }> = [];

  async read(): Promise<StorageSnapshot> {
    return { store: JSON.parse(JSON.stringify(this.doc)), token: this.rev };
  }
  async write(store: IdentityStoreFile): Promise<void> {
    this.doc = JSON.parse(JSON.stringify(store));
    this.rev += 1;
  }
  async appendAudit(action: string, target: string): Promise<void> {
    this.audit.push({ action, target });
  }
}

// Shim query client for ApiKeyStore.isRevoked + readiness (no real DB).
const shimClient = {
  async many() {
    return [] as any[];
  },
  async get() {
    return null as any;
  },
  async execute() {},
  pool: {} as any,
  async transaction<T>(fn: (c: any) => Promise<T>): Promise<T> {
    return fn(shimClient);
  },
  async close() {},
};

function fakeCloud(store: IdentityStore): CloudIdentityStore {
  return {
    store,
    client: shimClient as any,
    connectionSource: "test",
    close: async () => {},
  };
}

describe("identities serve", () => {
  let fetchHandler: (req: Request) => Promise<Response>;
  let apiKey: string;

  beforeAll(async () => {
    const store = new IdentityStore({ backend: new MemoryBackend() });
    const built = await createFetchHandler({ cloud: fakeCloud(store), signingSecret: SIGNING_SECRET });
    fetchHandler = built.fetch;
    apiKey = mintApiKey({ app: "identities", scopes: ["identities:*"], signingSecret: SIGNING_SECRET }).token;
  });

  test("GET /health returns ok status/version/mode", async () => {
    const res = await fetchHandler(new Request("http://x/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.mode).toBe("cloud");
    expect(typeof body.version).toBe("string");
  });

  test("GET /version returns version shape", async () => {
    const res = await fetchHandler(new Request("http://x/version"));
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("mode", "cloud");
  });

  test("GET /openapi.json returns the spec with paths", async () => {
    const res = await fetchHandler(new Request("http://x/openapi.json"));
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.paths["/v1/identities"]).toBeDefined();
    expect(spec.components.schemas.AuthSession.properties.accessToken).toMatchObject({
      type: "string",
      readOnly: true,
    });
    expect(spec.components.schemas.AuthSession.properties.accessToken.writeOnly).toBeUndefined();
    expect(spec.components.schemas.AuthSession.properties.refreshToken).toMatchObject({
      type: "string",
      readOnly: true,
    });
    expect(spec.components.schemas.AuthSession.properties.refreshToken.writeOnly).toBeUndefined();
    expect(spec.components.schemas.RefreshInput.properties.refreshToken.writeOnly).toBe(true);
    const sdkResponseTokens: Pick<AuthSession, "accessToken" | "refreshToken"> = {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
    };
    expect(Object.keys(sdkResponseTokens).sort()).toEqual(["accessToken", "refreshToken"]);
  });

  test("/v1 requires an API key", async () => {
    const res = await fetchHandler(new Request("http://x/v1/identities"));
    expect(res.status).toBe(401);
  });

  test("authenticated CRUD roundtrip", async () => {
    const headers = { "x-api-key": apiKey, "content-type": "application/json" };

    // create
    const createRes = await fetchHandler(
      new Request("http://x/v1/identities", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "agent", fullName: "Test Agent", uniqueIdentifier: "agent:test-serve" }),
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.fullName).toBe("Test Agent");
    const id = created.id;

    // list
    const listRes = await fetchHandler(new Request("http://x/v1/identities", { headers }));
    const list = await listRes.json();
    expect(list.count).toBe(1);

    // get by identifier
    const getRes = await fetchHandler(new Request("http://x/v1/identities/agent:test-serve", { headers }));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).id).toBe(id);

    // update
    const patchRes = await fetchHandler(
      new Request(`http://x/v1/identities/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ displayName: "Renamed" }),
      }),
    );
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).displayName).toBe("Renamed");

    // link email
    const emailRes = await fetchHandler(
      new Request(`http://x/v1/identities/${id}/emails`, {
        method: "POST",
        headers,
        body: JSON.stringify({ address: "agent@example.com", primary: true }),
      }),
    );
    expect(emailRes.status).toBe(200);
    expect((await emailRes.json()).emails[0].address).toBe("agent@example.com");

    // delete
    const delRes = await fetchHandler(new Request(`http://x/v1/identities/${id}`, { method: "DELETE", headers }));
    expect(delRes.status).toBe(200);
    expect((await delRes.json()).deleted).toBe(true);

    // gone
    const goneRes = await fetchHandler(new Request(`http://x/v1/identities/${id}`, { headers }));
    expect(goneRes.status).toBe(404);
  });

  test("read scope rejects a write when key lacks it", async () => {
    const readOnly = mintApiKey({ app: "identities", scopes: ["identities:read"], signingSecret: SIGNING_SECRET }).token;
    const res = await fetchHandler(
      new Request("http://x/v1/identities", {
        method: "POST",
        headers: { "x-api-key": readOnly, "content-type": "application/json" },
        body: JSON.stringify({ kind: "agent", fullName: "Nope" }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
