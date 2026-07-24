import { afterEach, describe, expect, test } from "bun:test";
import {
  CloudHttpError,
  CloudHttpIdentityStore,
  resolveCloudHttpConfig,
  resolveIdentityStore,
} from "./http-store.js";
import { IdentityStore } from "./storage.js";

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (call: RecordedCall) => { status?: number; json?: unknown }) {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) for (const [k, v] of Object.entries(h)) headers[k] = v;
    const call: RecordedCall = {
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status = 200, json } = handler(call);
    return new Response(json === undefined ? "" : JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const CONFIG = { apiUrl: "https://identities.your-deployment.example", apiKey: "test-key-abc" };
const SAMPLE = { id: "agent:demo", kind: "agent", fullName: "Demo Agent", identifiers: [], emails: [], phones: [] };

let active: { restore(): void } | undefined;
afterEach(() => {
  active?.restore();
  active = undefined;
  delete process.env["HASNA_IDENTITIES_API_URL"];
  delete process.env["HASNA_IDENTITIES_API_KEY"];
});

describe("resolveCloudHttpConfig", () => {
  test("returns null when neither var is set", () => {
    expect(resolveCloudHttpConfig({})).toBeNull();
  });

  test("returns config when both vars are set", () => {
    expect(
      resolveCloudHttpConfig({
        HASNA_IDENTITIES_API_URL: "https://identities.your-deployment.example",
        HASNA_IDENTITIES_API_KEY: "k",
      }),
    ).toEqual({ apiUrl: "https://identities.your-deployment.example", apiKey: "k" });
  });

  test("throws when only one var is set (no silent local drift)", () => {
    expect(() => resolveCloudHttpConfig({ HASNA_IDENTITIES_API_URL: "https://x" })).toThrow();
    expect(() => resolveCloudHttpConfig({ HASNA_IDENTITIES_API_KEY: "k" })).toThrow();
  });
});

describe("resolveIdentityStore", () => {
  test("uses local file store when env is unset", () => {
    const store = resolveIdentityStore();
    expect(store).toBeInstanceOf(IdentityStore);
    expect(store).not.toBeInstanceOf(CloudHttpIdentityStore);
  });

  test("uses cloud store when both env vars are set", () => {
    process.env["HASNA_IDENTITIES_API_URL"] = "https://identities.your-deployment.example";
    process.env["HASNA_IDENTITIES_API_KEY"] = "k";
    const store = resolveIdentityStore();
    expect(store).toBeInstanceOf(CloudHttpIdentityStore);
  });

  test("preferLocal forces the local store even when env is set", () => {
    process.env["HASNA_IDENTITIES_API_URL"] = "https://identities.your-deployment.example";
    process.env["HASNA_IDENTITIES_API_KEY"] = "k";
    const store = resolveIdentityStore({ preferLocal: true });
    expect(store).not.toBeInstanceOf(CloudHttpIdentityStore);
  });
});

describe("CloudHttpIdentityStore CRUD mapping", () => {
  test("list -> GET /v1/identities with bearer auth", async () => {
    const m = mockFetch(() => ({ json: { identities: [SAMPLE], count: 1 } }));
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(m.calls[0].url).toBe("https://identities.your-deployment.example/v1/identities");
    expect(m.calls[0].method).toBe("GET");
    expect(m.calls[0].headers["Authorization"]).toBe("Bearer test-key-abc");
  });

  test("get -> GET /v1/identities/:id; 404 resolves to undefined", async () => {
    const m = mockFetch((c) =>
      c.url.endsWith("/missing") ? { status: 404, json: { error: "not_found" } } : { json: SAMPLE },
    );
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    expect(await store.get("agent:demo")).toMatchObject({ id: "agent:demo" });
    expect(await store.get("missing")).toBeUndefined();
  });

  test("create -> POST with Idempotency-Key", async () => {
    const m = mockFetch(() => ({ status: 201, json: SAMPLE }));
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    const created = await store.create({ kind: "agent", fullName: "Demo Agent" });
    expect(created.id).toBe("agent:demo");
    expect(m.calls[0].method).toBe("POST");
    expect(m.calls[0].url).toBe("https://identities.your-deployment.example/v1/identities");
    expect(m.calls[0].headers["Idempotency-Key"]).toBeTruthy();
  });

  test("update -> PATCH /v1/identities/:id with delta body", async () => {
    const m = mockFetch(() => ({ json: { ...SAMPLE, displayName: "Renamed" } }));
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    const updated = await store.update("agent:demo", { displayName: "Renamed" });
    expect(updated.displayName).toBe("Renamed");
    expect(m.calls[0].method).toBe("PATCH");
    expect(m.calls[0].body).toEqual({ displayName: "Renamed" });
  });

  test("delete -> DELETE; returns boolean; 404 -> false", async () => {
    const m = mockFetch((c) =>
      c.url.endsWith("/gone") ? { status: 404 } : { json: { deleted: true, target: "agent:demo" } },
    );
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    expect(await store.delete("agent:demo")).toBe(true);
    expect(await store.delete("gone")).toBe(false);
  });

  test("linkEmail -> POST /:id/emails; string coerced to {address}", async () => {
    const m = mockFetch(() => ({ json: SAMPLE }));
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    await store.linkEmail("agent:demo", "demo@hasna.com");
    expect(m.calls[0].url).toBe("https://identities.your-deployment.example/v1/identities/agent%3Ademo/emails");
    expect(m.calls[0].body).toEqual({ address: "demo@hasna.com" });
  });

  test("non-2xx surfaces CloudHttpError with status", async () => {
    const m = mockFetch(() => ({ status: 401, json: { error: "unauthorized" } }));
    active = m;
    const store = new CloudHttpIdentityStore(CONFIG);
    await expect(store.list()).rejects.toBeInstanceOf(CloudHttpError);
  });

  test("store-level instruction sources are rejected in cloud mode", async () => {
    const store = new CloudHttpIdentityStore(CONFIG);
    await expect(
      store.setInstructionSource({ owner: { kind: "global" }, kind: "global-rules", title: "x", content: "y" } as never),
    ).rejects.toThrow(/not supported/i);
  });
});
