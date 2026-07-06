// Ordered, checksum-guarded schema migrations for the cloud (Postgres) mode of
// @hasna/identities. PURE REMOTE per Amendment A1 — the serve service reads and
// writes these tables directly; there is no sync engine or local mirror.
//
// The identity store is persisted as a single JSONB document row guarded by an
// optimistic-concurrency `rev`, so the full core-lib validation/normalization
// logic (duplicate detection, instruction-source graph checks) runs unchanged
// against the whole store on every mutation. The api-keys table comes from the
// canonical @hasna/contracts auth kit.

import { defineMigration, type Migration } from "./generated/storage-kit/index.js";
import { apiKeyMigrations } from "@hasna/contracts/auth";

export const IDENTITY_STORE_TABLE = "identity_store";
export const IDENTITY_AUDIT_TABLE = "identity_audit";
export const API_KEYS_TABLE = "api_keys";
export const DEFAULT_STORE_ID = "default";

export function identitiesMigrations(): Migration[] {
  return [
    defineMigration(
      "identities_0001_store",
      `CREATE TABLE IF NOT EXISTS ${IDENTITY_STORE_TABLE} (
         id TEXT PRIMARY KEY,
         rev BIGINT NOT NULL DEFAULT 0,
         doc JSONB NOT NULL DEFAULT '{"version":1,"identities":[],"instructionSources":[]}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    ),
    defineMigration(
      "identities_0002_audit",
      `CREATE TABLE IF NOT EXISTS ${IDENTITY_AUDIT_TABLE} (
         seq BIGSERIAL PRIMARY KEY,
         store_id TEXT NOT NULL,
         action TEXT NOT NULL,
         target TEXT NOT NULL,
         at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    ),
    defineMigration(
      "identities_0003_audit_idx",
      `CREATE INDEX IF NOT EXISTS ${IDENTITY_AUDIT_TABLE}_store_seq_idx
         ON ${IDENTITY_AUDIT_TABLE} (store_id, seq DESC)`,
    ),
    ...apiKeyMigrations(API_KEYS_TABLE).map((m) => defineMigration(m.id, m.sql)),
  ];
}
