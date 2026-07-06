#!/usr/bin/env bun
// Entry point for the `identities-serve` binary.
//
//   identities-serve [--port N] [--host H]   start the HTTP API (cloud mode)
//   identities-serve migrate [--dry-run]     apply cloud schema migrations
//   identities-serve --version | --help

import { createCloudIdentityStore, runIdentitiesMigrations } from "../pg-store.js";
import { getPackageVersion } from "../version.js";
import { startServer } from "./serve.js";

function argValue(name: string): string | undefined {
  const idx = process.argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return undefined;
  const arg = process.argv[idx]!;
  if (arg.includes("=")) return arg.split("=").slice(1).join("=");
  return process.argv[idx + 1];
}

function printHelp(): void {
  console.log(`identities-serve — @hasna/identities cloud HTTP API

Usage:
  identities-serve [options]           Start the HTTP API (PURE REMOTE cloud mode)
  identities-serve migrate [--dry-run] Apply cloud schema migrations then exit
  identities-serve --version           Print the package version
  identities-serve --help              Show this help

Options:
  --port <port>   Port to bind (default: $PORT or 15455)
  --host <host>   Host to bind (default: $HOST or 0.0.0.0)

Environment:
  HASNA_IDENTITIES_STORAGE_MODE=cloud        Required (PURE REMOTE)
  HASNA_IDENTITIES_DATABASE_URL=postgres://  Required in cloud mode
  HASNA_IDENTITIES_API_SIGNING_KEY=<hmac>    API-key signing secret (or HASNA_API_SIGNING_KEY)`);
}

async function migrate(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const cloud = createCloudIdentityStore({ applicationName: "identities-migrate" });
  try {
    const result = await runIdentitiesMigrations(cloud.client, { dryRun });
    const appliedIds = new Set(result.applied.map((a) => a.id));
    // After a real run, everything in the plan is applied; pending only remains on dry-run.
    const pending = result.plan
      .filter((p) => p.state === "pending" && !appliedIds.has(p.migration.id))
      .map((p) => p.migration.id);
    const justApplied = dryRun
      ? []
      : result.plan.filter((p) => p.state === "pending").map((p) => p.migration.id);
    console.log(
      JSON.stringify({
        dryRun,
        applied: result.applied.map((a) => a.id),
        justApplied,
        pending,
      }, null, 2),
    );
  } finally {
    await cloud.close();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (process.argv[2] === "migrate") {
    await migrate();
    return;
  }

  const portArg = argValue("--port");
  const server = await startServer({
    ...(portArg ? { port: Number(portArg) } : {}),
    ...(argValue("--host") ? { host: argValue("--host")! } : {}),
    audit: (e) => {
      try {
        console.log(JSON.stringify({ log: "api_auth", ...(e as object) }));
      } catch {
        // never break the request path on a logging failure
      }
    },
  });
  console.log(`identities-serve listening on http://${server.hostname}:${server.port} (mode=cloud)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
