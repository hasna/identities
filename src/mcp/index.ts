#!/usr/bin/env bun
// MCP server for @hasna/identities. Exposes the identity store operations as MCP
// tools over stdio. Every tool routes through the shared Store abstraction
// (resolveIdentityStore): the local JSON store by default, or the HTTPS `/v1`
// API store (bearer key) when HASNA_IDENTITIES_API_URL + HASNA_IDENTITIES_API_KEY
// (or HASNA_IDENTITIES_STORAGE_MODE=api) are set. There is NO Postgres DSN on the
// client — self_hosted/cloud both go through the API store, same as the CLI/SDK.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { IdentityStore } from "../storage.js";
import { CloudHttpIdentityStore, resolveIdentityStore } from "../http-store.js";
import { getPackageVersion } from "../version.js";

function resolveStore(): { store: IdentityStore; mode: "api" | "local" } {
  const store = resolveIdentityStore();
  return { store, mode: store instanceof CloudHttpIdentityStore ? "api" : "local" };
}

function jsonText(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorText(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

async function main(): Promise<void> {
  const { store } = resolveStore();
  const server = new McpServer({ name: "identities", version: getPackageVersion() });

  server.tool(
    "identity_list",
    "List all identity records (optionally as compact contact cards).",
    { cards: z.boolean().optional().describe("Return compact contact cards instead of full records") },
    async ({ cards }) => {
      try {
        return jsonText(cards ? await store.listCards() : await store.list());
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_get",
    "Get one identity by id, identifier, email, or phone.",
    { target: z.string().describe("id, identifier, email, or phone") },
    async ({ target }) => {
      try {
        const identity = await store.get(target);
        return identity ? jsonText(identity) : errorText(`Identity not found: ${target}`);
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_create",
    "Create a new identity record.",
    {
      kind: z.enum(["human", "agent", "organization", "service"]),
      fullName: z.string(),
      displayName: z.string().optional(),
      uniqueIdentifier: z.string().optional(),
      emails: z.array(z.string()).optional(),
      phones: z.array(z.string()).optional(),
    },
    async (input) => {
      try {
        return jsonText(await store.create(input as any));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_update",
    "Update an existing identity by target.",
    {
      target: z.string(),
      fullName: z.string().optional(),
      displayName: z.string().optional(),
      uniqueIdentifier: z.string().optional(),
      kind: z.enum(["human", "agent", "organization", "service"]).optional(),
    },
    async ({ target, ...patch }) => {
      try {
        return jsonText(await store.update(target, patch as any));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_delete",
    "Delete an identity by target.",
    { target: z.string() },
    async ({ target }) => {
      try {
        return jsonText({ deleted: await store.delete(target), target });
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_link_email",
    "Link an email address to an identity.",
    { target: z.string(), address: z.string(), label: z.string().optional(), primary: z.boolean().optional() },
    async ({ target, ...email }) => {
      try {
        return jsonText(await store.linkEmail(target, email as any));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "identity_link_phone",
    "Link a phone number to an identity.",
    { target: z.string(), number: z.string(), label: z.string().optional(), primary: z.boolean().optional() },
    async ({ target, ...phone }) => {
      try {
        return jsonText(await store.linkPhone(target, phone as any));
      } catch (e) {
        return errorText(e instanceof Error ? e.message : String(e));
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
