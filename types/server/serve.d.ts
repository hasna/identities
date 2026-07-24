import { ApiKeyStore, type ApiKeyVerifier } from "@hasna/contracts/auth";
import type { IdentityStore } from "../storage.js";
import { type CloudIdentityStore } from "../pg-store.js";
export declare const IDENTITIES_SERVE_APP = "identities";
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
interface Handler {
    store: IdentityStore;
    cloud: CloudIdentityStore;
    verifier: ApiKeyVerifier;
    keys: ApiKeyStore;
    version: string;
}
export declare function buildHandler(options?: ServeOptions): Promise<Handler>;
export declare function createFetchHandler(options?: ServeOptions): Promise<{
    handler: Handler;
    fetch: (req: Request) => Promise<Response>;
}>;
export declare function startServer(options?: ServeOptions): Promise<RunningServer>;
export {};
