export * from "./client.js";
import { IdentitiesClient, type IdentitiesClientOptions } from "./client.js";
export interface FromEnvOptions extends Partial<IdentitiesClientOptions> {
    env?: Record<string, string | undefined>;
}
/** Build a client from HASNA_IDENTITIES_API_URL + HASNA_IDENTITIES_API_KEY. */
export declare function createIdentitiesClientFromEnv(options?: FromEnvOptions): IdentitiesClient;
