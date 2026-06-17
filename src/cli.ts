#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IdentityStore } from "./storage.js";
import { identityDocumentKeys, type Identity, type IdentityDocumentKey, type IdentityKind } from "./types.js";
import { createEcosystemRegistrationManifest, createAgentIdentityRef } from "./ecosystem.js";
import { identityToAgentManifest } from "./core.js";
import { syncIdentityContactPointsAndUpdate } from "./integrations.js";
import { writeEveAgent } from "./eve.js";
import { seedHasnaCompanyAgents } from "./roster.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

const version = "0.1.1";
const booleanFlags = new Set(["json", "help", "h", "version", "keep-deprecated"]);

const helpText = `identities

Usage:
  identities [--json] [--store <path>] <command>

Commands:
  create --name <name> [--kind human|agent|organization|service] [--identifier scheme:value] [--email address] [--phone number]
  update <id|identifier> [--name <name>] [--display-name <name>] [--kind kind]
  list
  show <id|identifier|email|phone>
  delete <id|identifier>
  link-email <id|identifier> <email>
  link-phone <id|identifier> <phone>
  doc get <id|identifier> <key>
  doc set <id|identifier> <key> <value|--file path>
  doc export <id|identifier> --dir <dir>
  doc import <id|identifier> --dir <dir>
  agent manifest <id|identifier>
  agent register --name <name> [--identifier agent:name]
  agent seed-company [--docs-dir dir] [--keep-deprecated]
  eve export <id|identifier> --out <dir>
  sync <id|identifier>
  validate
  export [path]
  import <path>
  version

Data is stored in ~/.hasna/identities/identities.json by default.
Set OPEN_IDENTITIES_STORE or pass --store for an isolated store.
`;

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const json = hasFlag(parsed, "json");
  const store = new IdentityStore({ filePath: flagValue(parsed, "store") });

  try {
    await dispatch(parsed, store, json);
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ error: errorMessage(error) }, null, 2));
    } else {
      console.error(errorMessage(error));
    }
    process.exitCode = 1;
  }
}

async function dispatch(parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [command, ...rest] = parsed.positionals;

  if (!command || command === "help" || hasFlag(parsed, "help") || hasFlag(parsed, "h")) {
    output(helpText, json);
    return;
  }

  if (command === "version" || hasFlag(parsed, "version")) {
    output({ version }, json);
    return;
  }

  if (command === "list") {
    const cards = await store.listCards();
    if (json) output(cards, json);
    else {
      for (const card of cards) {
        console.log([card.id, card.kind, card.fullName, card.primaryEmail ?? "", card.primaryPhone ?? ""].join("\t"));
      }
    }
    return;
  }

  if (command === "show") {
    output(await store.require(required(rest[0], "show requires an identity target")), json);
    return;
  }

  if (command === "create") {
    const identity = await store.create(createInputFromFlags(parsed));
    output(identity, json);
    return;
  }

  if (command === "update") {
    const target = required(rest[0], "update requires an identity target");
    output(await store.update(target, createUpdateFromFlags(parsed)), json);
    return;
  }

  if (command === "link-email") {
    const [target, email] = rest;
    output(await store.linkEmail(required(target, "link-email requires an identity target"), required(email, "link-email requires an email")), json);
    return;
  }

  if (command === "link-phone") {
    const [target, phone] = rest;
    output(await store.linkPhone(required(target, "link-phone requires an identity target"), required(phone, "link-phone requires a phone number")), json);
    return;
  }

  if (command === "doc") {
    await dispatchDoc(rest, parsed, store, json);
    return;
  }

  if (command === "agent") {
    await dispatchAgent(rest, parsed, store, json);
    return;
  }

  if (command === "eve") {
    await dispatchEve(rest, parsed, store, json);
    return;
  }

  if (command === "sync") {
    const target = required(rest[0], "sync requires an identity target");
    output(await syncIdentityContactPointsAndUpdate(store, target, {}), json);
    return;
  }

  if (command === "validate" || command === "doctor") {
    output(await store.validate(), json);
    return;
  }

  if (command === "export") {
    const identities = await store.list();
    const targetPath = rest[0];
    if (targetPath) {
      await writeFile(targetPath, `${JSON.stringify({ version: 1, identities }, null, 2)}\n`, "utf8");
      output({ exported: identities.length, path: targetPath }, json);
    } else {
      output({ version: 1, identities }, true);
    }
    return;
  }

  if (command === "import") {
    const path = required(rest[0], "import requires a path");
    const parsedImport = JSON.parse(await readFile(path, "utf8")) as { identities?: Identity[] };
    await store.replaceAll(parsedImport.identities ?? []);
    output({ imported: parsedImport.identities?.length ?? 0, path }, json);
    return;
  }

  if (command === "delete") {
    const target = required(rest[0], "delete requires an identity target");
    output({ deleted: await store.delete(target) }, json);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function dispatchDoc(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target, keyOrMaybeDir, value] = rest;
  if (subcommand === "get") {
    const identity = await store.require(required(target, "doc get requires an identity target"));
    const key = requireDocumentKey(keyOrMaybeDir);
    output({ key, value: identity.documents[key] ?? "" }, json);
    return;
  }

  if (subcommand === "set") {
    const key = requireDocumentKey(keyOrMaybeDir);
    const file = flagValue(parsed, "file");
    const nextValue = file ? await readFile(file, "utf8") : required(value, "doc set requires a value or --file");
    output(await store.update(required(target, "doc set requires an identity target"), { documents: { [key]: nextValue } }), json);
    return;
  }

  if (subcommand === "export") {
    const identity = await store.require(required(target, "doc export requires an identity target"));
    const dir = required(flagValue(parsed, "dir") ?? keyOrMaybeDir, "doc export requires --dir");
    await mkdir(dir, { recursive: true });
    const files: string[] = [];
    for (const key of identityDocumentKeys) {
      const content = identity.documents[key];
      if (content === undefined) continue;
      const path = join(dir, `${key.toUpperCase()}.md`);
      await writeFile(path, content, "utf8");
      files.push(path);
    }
    output({ exported: files.length, files }, json);
    return;
  }

  if (subcommand === "import") {
    const dir = required(flagValue(parsed, "dir") ?? keyOrMaybeDir, "doc import requires --dir");
    const documents: Record<string, string> = {};
    for (const key of identityDocumentKeys) {
      try {
        documents[key] = await readFile(join(dir, `${key.toUpperCase()}.md`), "utf8");
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }
    output(await store.update(required(target, "doc import requires an identity target"), { documents }), json);
    return;
  }

  throw new Error(`Unknown doc command: ${subcommand ?? ""}`);
}

async function dispatchAgent(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand === "manifest") {
    const identity = await store.require(required(target, "agent manifest requires an identity target"));
    output(createEcosystemRegistrationManifest(identity, [
      createAgentIdentityRef(identity, { source: "todos" }),
      createAgentIdentityRef(identity, { source: "mementos" }),
      createAgentIdentityRef(identity, { source: "conversations" }),
      createAgentIdentityRef(identity, { source: "eve" }),
    ]), json);
    return;
  }

  if (subcommand === "register") {
    const identity = await store.create({
      ...createInputFromFlags(parsed),
      kind: "agent",
      uniqueIdentifier: flagValue(parsed, "identifier") ?? `agent:${slugify(required(flagValue(parsed, "name"), "agent register requires --name"))}`,
    });
    output(identityToAgentManifest(identity), json);
    return;
  }

  if (subcommand === "seed-company") {
    output(await seedHasnaCompanyAgents(store, {
      docsDir: flagValue(parsed, "docs-dir"),
      pruneDeprecated: !hasFlag(parsed, "keep-deprecated"),
    }), json);
    return;
  }

  throw new Error(`Unknown agent command: ${subcommand ?? ""}`);
}

async function dispatchEve(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand !== "export") throw new Error(`Unknown eve command: ${subcommand ?? ""}`);
  const identity = await store.require(required(target, "eve export requires an identity target"));
  const outDir = required(flagValue(parsed, "out"), "eve export requires --out");
  output(await writeEveAgent(identity, { outDir, model: flagValue(parsed, "model") }), json);
}

function createInputFromFlags(parsed: ParsedArgs) {
  const name = flagValue(parsed, "name") ?? parsed.positionals[1];
  const kind = parseKind(flagValue(parsed, "kind") ?? "human");
  return {
    kind,
    fullName: required(name, "create requires --name"),
    displayName: flagValue(parsed, "display-name"),
    uniqueIdentifier: flagValue(parsed, "identifier"),
    identifiers: flagValues(parsed, "identifier").slice(1),
    emails: flagValues(parsed, "email"),
    phones: flagValues(parsed, "phone"),
    documents: documentFlags(parsed),
    agent: agentFlags(parsed),
  };
}

function createUpdateFromFlags(parsed: ParsedArgs) {
  const documents = documentFlags(parsed);
  const agent = agentFlags(parsed);
  return {
    kind: flagValue(parsed, "kind") ? parseKind(flagValue(parsed, "kind")!) : undefined,
    fullName: flagValue(parsed, "name"),
    displayName: flagValue(parsed, "display-name"),
    uniqueIdentifier: flagValue(parsed, "identifier"),
    identifiers: flagValues(parsed, "identifier").length > 1 ? flagValues(parsed, "identifier").slice(1) : undefined,
    emails: flagValues(parsed, "email").length > 0 ? flagValues(parsed, "email") : undefined,
    phones: flagValues(parsed, "phone").length > 0 ? flagValues(parsed, "phone") : undefined,
    documents: Object.keys(documents).length > 0 ? documents : undefined,
    agent,
  };
}

function documentFlags(parsed: ParsedArgs): Record<string, string | undefined> {
  return Object.fromEntries(identityDocumentKeys.flatMap((key) => {
    const value = flagValue(parsed, key);
    return value === undefined ? [] : [[key, value]];
  }));
}

function agentFlags(parsed: ParsedArgs) {
  const agent = {
    role: flagValue(parsed, "role"),
    model: flagValue(parsed, "model"),
    capabilities: flagValues(parsed, "capability"),
    tools: flagValues(parsed, "tool"),
    skills: flagValues(parsed, "skill"),
    channels: flagValues(parsed, "channel"),
    schedules: flagValues(parsed, "schedule"),
    subagents: flagValues(parsed, "subagent"),
  };
  const hasAgentValue = Object.values(agent).some((value) => Array.isArray(value) ? value.length > 0 : value !== undefined);
  return hasAgentValue ? agent : undefined;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (booleanFlags.has(key)) {
      flags.set(key, [...(flags.get(key) ?? []), "true"]);
      continue;
    }
    const next = args[index + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
    flags.set(key, [...(flags.get(key) ?? []), value]);
  }

  return { positionals, flags };
}

function hasFlag(args: ParsedArgs, key: string): boolean {
  return args.flags.has(key);
}

function flagValue(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags.get(key)?.[0];
  return value === "true" ? undefined : value;
}

function flagValues(args: ParsedArgs, key: string): string[] {
  return (args.flags.get(key) ?? []).filter((value) => value !== "true");
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

function parseKind(kind: string): IdentityKind {
  if (kind === "human" || kind === "agent" || kind === "organization" || kind === "service") return kind;
  throw new Error(`Invalid identity kind: ${kind}`);
}

function requireDocumentKey(value: string | undefined): IdentityDocumentKey {
  const key = required(value, "document key is required") as IdentityDocumentKey;
  if (!identityDocumentKeys.includes(key)) throw new Error(`Invalid document key: ${key}`);
  return key;
}

function output(value: unknown, json: boolean): void {
  if (typeof value === "string" && !json) console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

if (import.meta.main) {
  runCli();
}
