#!/usr/bin/env bun
// Generate the typed @hasna/identities SDK client from the serve OpenAPI
// document, using the canonical @hasna/contracts SDK generator. The generated
// file (src/sdk/client.ts) is committed and verified in CI.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSdkFromOpenApi } from "@hasna/contracts/sdk";
import { buildOpenApiDocument } from "../src/server/openapi.js";
import { getPackageVersion } from "../src/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const spec = buildOpenApiDocument(getPackageVersion());
const result = generateSdkFromOpenApi(spec as any, {
  className: "IdentitiesClient",
  apiKeyHeader: "x-api-key",
});

const outDir = join(root, "src", "sdk");
mkdirSync(outDir, { recursive: true });
const header = "// @generated from the serve OpenAPI document by scripts/generate-sdk.ts — DO NOT EDIT.\n// Regenerate: bun run generate:sdk\n\n";
writeFileSync(join(outDir, "client.ts"), header + result.code, "utf8");

if (result.warnings.length > 0) {
  console.warn("SDK generator warnings:");
  for (const w of result.warnings) console.warn(`  - ${w}`);
}
console.log(`Generated ${result.operations.length} operations -> src/sdk/client.ts`);
for (const op of result.operations) console.log(`  ${op.method.toUpperCase()} ${op.path} -> ${op.functionName}`);
