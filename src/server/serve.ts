// HTTP API for @hasna/identities (cloud / PURE REMOTE per Amendment A1).
//
// Surfaces:
//   GET  /health           liveness (process up)
//   GET  /ready            readiness (DB reachable + schema migrated)
//   GET  /version          { status, version, mode }
//   GET  /openapi.json     the OpenAPI document backing the generated SDK
//   /v1/*                  API-key-authenticated identity CRUD
//
// Auth uses the canonical @hasna/contracts API-key kit (verifyApiKey) so the
// serve process is framework-agnostic and runs on Bun.serve directly.

import { ApiKeyStore, verifyApiKey, type ApiKeyVerifier } from "@hasna/contracts/auth";
import type { IdentityStore } from "../storage.js";
import { createCloudIdentityStore, cloudHealth, cloudReady, type CloudIdentityStore } from "../pg-store.js";
import { getPackageVersion } from "../version.js";
import { buildOpenApiDocument } from "./openapi.js";

export const IDENTITIES_SERVE_APP = "identities";
const DEFAULT_PORT = 15455;

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Provide a pre-built cloud store (tests). Otherwise built from env. */
  cloud?: CloudIdentityStore;
  /** Override the HMAC signing secret. Defaults to env. */
  signingSecret?: string;
  /** Called on each auth decision for the AUDIT trail. */
  audit?: (event: unknown) => void;
}

export interface RunningServer {
  port: number;
  hostname: string;
  stop: () => Promise<void>;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function resolveSigningSecret(explicit?: string): string {
  const secret =
    explicit ||
    process.env["HASNA_IDENTITIES_API_SIGNING_KEY"] ||
    process.env["HASNA_API_SIGNING_KEY"];
  if (!secret) {
    throw new Error(
      "Missing API signing secret. Set HASNA_IDENTITIES_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}

interface Handler {
  store: IdentityStore;
  cloud: CloudIdentityStore;
  verifier: ApiKeyVerifier;
  keys: ApiKeyStore;
  version: string;
}

async function readJsonBody(req: Request): Promise<any> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string, public reason?: string) {
    super(message);
  }
}

async function authenticate(h: Handler, req: Request, requiredScopes: string[]): Promise<Response | null> {
  const url = new URL(req.url);
  const decision = await h.verifier.authenticate(req.headers, {
    method: req.method,
    path: url.pathname,
    requiredScopes,
  });
  if (decision.ok) return null;
  return json({ error: decision.message, reason: decision.reason }, decision.status);
}

async function handleV1(h: Handler, req: Request, url: URL): Promise<Response> {
  const method = req.method.toUpperCase();
  const segments = url.pathname.split("/").filter(Boolean); // ["v1", "identities", ...]
  const resource = segments[1];

  // Scope required: read for GET, write for mutations.
  const scope = method === "GET" ? "identities:read" : "identities:write";
  const authFailure = await authenticate(h, req, [scope]);
  if (authFailure) return authFailure;

  try {
    if (resource === "cards" && segments.length === 2 && method === "GET") {
      const cards = await h.store.listCards();
      return json({ cards, count: cards.length });
    }

    if (resource === "identities") {
      // /v1/identities
      if (segments.length === 2) {
        if (method === "GET") {
          const identities = await h.store.list();
          return json({ identities, count: identities.length });
        }
        if (method === "POST") {
          const body = await readJsonBody(req);
          const created = await h.store.create(body);
          return json(created, 201);
        }
        throw new HttpError(405, `Method ${method} not allowed on /v1/identities`);
      }

      // /v1/identities/:target[/emails|/phones]
      const target = decodeURIComponent(segments[2] ?? "");
      const sub = segments[3];

      if (!sub && segments.length === 3) {
        if (method === "GET") {
          const identity = await h.store.get(target);
          if (!identity) throw new HttpError(404, `Identity not found: ${target}`, "not_found");
          return json(identity);
        }
        if (method === "PATCH" || method === "PUT") {
          const body = await readJsonBody(req);
          const updated = await h.store.update(target, body);
          return json(updated);
        }
        if (method === "DELETE") {
          const deleted = await h.store.delete(target);
          return json({ deleted, target }, deleted ? 200 : 404);
        }
        throw new HttpError(405, `Method ${method} not allowed`);
      }

      if (sub === "emails" && method === "POST") {
        const body = await readJsonBody(req);
        const updated = await h.store.linkEmail(target, body);
        return json(updated);
      }
      if (sub === "phones" && method === "POST") {
        const body = await readJsonBody(req);
        const updated = await h.store.linkPhone(target, body);
        return json(updated);
      }
    }

    throw new HttpError(404, `No route for ${method} ${url.pathname}`, "not_found");
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, reason: error.reason }, error.status);
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : /conflict|already in use|conflicts with/i.test(message) ? 409 : 400;
    return json({ error: message }, status);
  }
}

export async function buildHandler(options: ServeOptions = {}): Promise<Handler> {
  const cloud = options.cloud ?? createCloudIdentityStore();
  const signingSecret = resolveSigningSecret(options.signingSecret);
  const keys = new ApiKeyStore(cloud.client);
  const verifier = verifyApiKey({
    app: IDENTITIES_SERVE_APP,
    signingSecret,
    isRevoked: keys.isRevoked,
    ...(options.audit ? { audit: options.audit as any } : {}),
  });
  return { store: cloud.store, cloud, verifier, keys, version: getPackageVersion() };
}

export async function createFetchHandler(options: ServeOptions = {}): Promise<{
  handler: Handler;
  fetch: (req: Request) => Promise<Response>;
}> {
  const handler = await buildHandler(options);
  const openapi = buildOpenApiDocument(handler.version);

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ status: "ok", version: handler.version, mode: "cloud" });
    }
    if (path === "/version") {
      return json({ status: "ok", version: handler.version, mode: "cloud" });
    }
    if (path === "/ready") {
      const ready = await cloudReady(handler.cloud.client);
      return json(
        {
          status: ready.ok ? "ok" : "degraded",
          version: handler.version,
          mode: "cloud",
          latencyMs: ready.latencyMs,
          pendingMigrations: ready.pendingMigrations,
          ...(ready.error ? { error: ready.error } : {}),
        },
        ready.ok ? 200 : 503,
      );
    }
    if (path === "/openapi.json") {
      return json(openapi);
    }
    if (path === "/" ) {
      return json({ name: "@hasna/identities", status: "ok", version: handler.version, mode: "cloud" });
    }
    if (path.startsWith("/v1/") || path === "/v1") {
      return handleV1(handler, req, url);
    }
    return json({ error: `Not found: ${path}` }, 404);
  };

  return { handler, fetch };
}

export async function startServer(options: ServeOptions = {}): Promise<RunningServer> {
  const port = options.port ?? (Number(process.env["PORT"]) || DEFAULT_PORT);
  const host = options.host ?? process.env["HOST"] ?? "0.0.0.0";
  const { fetch, handler } = await createFetchHandler(options);

  const server = Bun.serve({ port, hostname: host, fetch });
  // Prove the DB path early (does not block liveness).
  cloudHealth(handler.cloud.client).catch(() => undefined);

  return {
    port: server.port ?? port,
    hostname: host,
    stop: async () => {
      server.stop(true);
      await handler.cloud.close().catch(() => undefined);
    },
  };
}
