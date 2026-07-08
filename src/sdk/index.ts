// Public SDK surface for @hasna/identities.
//
// The typed client (client.ts) is generated from the serve OpenAPI document and
// is a standalone, dependency-free HTTP client for the `/v1` API — the same
// shape the reference apps (conversations, mementos) publish under `/sdk`.
//
// `createIdentitiesClientFromEnv` wires the LOCKED fleet convention:
//   HASNA_IDENTITIES_API_URL + HASNA_IDENTITIES_API_KEY  (never a DSN in the
// client). These MUST match the env vars the CLI/MCP/http-store read so an SDK
// consumer that sets the standard fleet vars is picked up.

export * from "./client.js";
import { IdentitiesClient, type IdentitiesClientOptions } from "./client.js";

// Kept in sync with IDENTITIES_API_URL_ENV / IDENTITIES_API_KEY_ENV in
// ../http-store.ts. Duplicated (not imported) so the published SDK stays a
// zero-dependency client and does not pull in the local storage graph.
const IDENTITIES_API_URL_ENV = "HASNA_IDENTITIES_API_URL";
const IDENTITIES_API_KEY_ENV = "HASNA_IDENTITIES_API_KEY";

export interface FromEnvOptions extends Partial<IdentitiesClientOptions> {
  env?: Record<string, string | undefined>;
}

/** Build a client from HASNA_IDENTITIES_API_URL + HASNA_IDENTITIES_API_KEY. */
export function createIdentitiesClientFromEnv(options: FromEnvOptions = {}): IdentitiesClient {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl ?? env[IDENTITIES_API_URL_ENV];
  if (!baseUrl) {
    throw new Error(`createIdentitiesClientFromEnv requires ${IDENTITIES_API_URL_ENV} (or options.baseUrl).`);
  }
  const apiKey = options.apiKey ?? env[IDENTITIES_API_KEY_ENV];
  return new IdentitiesClient({
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
