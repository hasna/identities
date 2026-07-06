// Public SDK surface for @hasna/identities.
//
// The typed client (client.ts) is generated from the serve OpenAPI document.
// `createIdentitiesClientFromEnv` wires the self_hosted convention:
//   IDENTITIES_API_URL  + IDENTITIES_API_KEY   (never a DSN in the client).

export * from "./client.js";
import { IdentitiesClient, type IdentitiesClientOptions } from "./client.js";

export interface FromEnvOptions extends Partial<IdentitiesClientOptions> {
  env?: Record<string, string | undefined>;
}

/** Build a client from IDENTITIES_API_URL + IDENTITIES_API_KEY. */
export function createIdentitiesClientFromEnv(options: FromEnvOptions = {}): IdentitiesClient {
  const env = options.env ?? process.env;
  const baseUrl = options.baseUrl ?? env["IDENTITIES_API_URL"];
  if (!baseUrl) {
    throw new Error("createIdentitiesClientFromEnv requires IDENTITIES_API_URL (or options.baseUrl).");
  }
  const apiKey = options.apiKey ?? env["IDENTITIES_API_KEY"];
  return new IdentitiesClient({
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}
