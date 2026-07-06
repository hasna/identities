#!/usr/bin/env bun
// End-to-end proof: exercise the live serve through the REAL generated SDK
// client with a real API key. Reads IDENTITIES_API_URL + IDENTITIES_API_KEY.
import { readFileSync } from "node:fs";
import { createIdentitiesClientFromEnv } from "../src/sdk/index.js";

const apiKey = process.env["IDENTITIES_API_KEY"] || readFileSync("/dev/shm/apikey", "utf8").trim();
const client = createIdentitiesClientFromEnv({
  baseUrl: process.env["IDENTITIES_API_URL"] || "http://127.0.0.1:15462",
  apiKey,
});

const uid = `agent:selfhost-proof-${Date.now()}`;
const out: Record<string, unknown> = {};

const created = await client.createIdentity({ kind: "agent", fullName: "Selfhost Proof Agent", uniqueIdentifier: uid });
out.created = { id: created.id, fullName: created.fullName };

const got = await client.getIdentity(uid);
out.get = { id: (got as any).id, matches: (got as any).id === created.id };

const updated = await client.updateIdentity(created.id, { displayName: "Proof" });
out.updated = { displayName: (updated as any).displayName };

const withEmail = await client.linkEmail(created.id, { address: `proof-${Date.now()}@example.com`, primary: true });
out.linkedEmail = { email: (withEmail as any).emails?.[0]?.address };

const list = await client.listIdentities();
out.listCount = (list as any).count;

const del = await client.deleteIdentity(created.id);
out.deleted = (del as any).deleted;

let gone = false;
try {
  await client.getIdentity(uid);
} catch (e: any) {
  gone = e?.status === 404;
}
out.goneAfterDelete = gone;

console.log(JSON.stringify(out, null, 2));
console.log(out.deleted && out.goneAfterDelete && out.get && (out.get as any).matches ? "PROOF_OK" : "PROOF_FAIL");
