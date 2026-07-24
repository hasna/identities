import { type Migration } from "./generated/storage-kit/index.js";
export declare const IDENTITY_STORE_TABLE = "identity_store";
export declare const IDENTITY_AUDIT_TABLE = "identity_audit";
export declare const API_KEYS_TABLE = "api_keys";
export declare const DEFAULT_STORE_ID = "default";
export declare function identitiesMigrations(): Migration[];
