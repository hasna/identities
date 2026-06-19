#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IdentityStore } from "./storage.js";
import { getIdentityStoreStatus, projectIdentityMediaStatus, projectIdentityMediaSummary } from "./status.js";
import { identityDocumentKeys, type Identity, type IdentityDocumentKey, type IdentityKind } from "./types.js";
import { createEcosystemRegistrationManifest, createAgentIdentityRef } from "./ecosystem.js";
import { identityToAgentManifest } from "./core.js";
import { syncIdentityContactPointsAndUpdate } from "./integrations.js";
import { writeEveAgent } from "./eve.js";
import {
  detectIdentityMediaSecrets,
  generateHasnaRosterMedia,
  generateIdentityProfileImage,
  generateIdentityVoice,
  getIdentityMediaAssetsDir,
  type VoiceGenerationMode,
} from "./media.js";
import { seedHasnaCompanyAgents } from "./roster.js";

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

const version = "0.1.3";
const booleanFlags = new Set([
  "json",
  "help",
  "h",
  "version",
  "keep-deprecated",
  "dry-run",
  "create-voice",
  "voices",
  "profile-images",
  "clear-voice",
  "clear-profile-image",
]);

const helpText = `identities

Usage:
  identities [--json] [--store <path>] <command>

Commands:
  create --name <name> [--kind human|agent|organization|service] [--identifier scheme:value] [--email address] [--phone number]
  update <id|identifier> [--name <name>] [--display-name <name>] [--kind kind]
  list
  status
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
  media doctor
  media status [id|identifier]
  media generate-voice <id|identifier> [--voice-id id] [--voice-description text] [--text text] [--model model] [--output-format format] [--out-dir dir] [--dry-run] [--create-voice]
  media generate-profile-image <id|identifier> [--prompt text] [--model model] [--aspect-ratio 1:1] [--out-dir dir] [--dry-run]
  media generate-roster [--voices] [--profile-images] [--out-dir dir] [--dry-run] [--limit n]
  update ... [--clear-voice] [--clear-profile-image]
  asset list <id|identifier>
  sync <id|identifier>
  validate
  status
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

  if (command === "status") {
    output(await getIdentityStoreStatus(store), json);
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

  if (command === "media") {
    await dispatchMedia(rest, parsed, store, json);
    return;
  }

  if (command === "asset") {
    await dispatchAsset(rest, store, json);
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

async function dispatchMedia(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;

  if (subcommand === "doctor" || subcommand === "secrets") {
    output({ assetsDir: getIdentityMediaAssetsDir(), secrets: detectIdentityMediaSecrets() }, json);
    return;
  }

  if (subcommand === "status") {
    if (target) {
      const identity = await store.require(target);
      output(projectIdentityMediaStatus(identity), json);
      return;
    }

    const identities = await store.list();
    output({
      count: identities.length,
      assetsDir: getIdentityMediaAssetsDir(),
      identities: identities.map(projectIdentityMediaSummary),
    }, json);
    return;
  }

  if (subcommand === "generate-voice") {
    output(await generateIdentityVoice(store, required(target, "media generate-voice requires an identity target"), {
      mode: parseVoiceGenerationMode(flagValue(parsed, "mode")),
      voiceId: flagValue(parsed, "voice-id"),
      voiceDescription: flagValue(parsed, "voice-description") ?? flagValue(parsed, "description"),
      text: flagValue(parsed, "text"),
      model: flagValue(parsed, "model"),
      outputFormat: flagValue(parsed, "output-format"),
      outDir: flagValue(parsed, "out-dir"),
      dryRun: hasFlag(parsed, "dry-run"),
      createVoice: hasFlag(parsed, "create-voice"),
    }), json);
    return;
  }

  if (subcommand === "generate-profile-image" || subcommand === "generate-picture" || subcommand === "generate-profile-picture") {
    output(await generateIdentityProfileImage(store, required(target, "media generate-profile-image requires an identity target"), {
      prompt: flagValue(parsed, "prompt"),
      model: flagValue(parsed, "model"),
      aspectRatio: flagValue(parsed, "aspect-ratio"),
      outDir: flagValue(parsed, "out-dir"),
      dryRun: hasFlag(parsed, "dry-run"),
    }), json);
    return;
  }

  if (subcommand === "generate-roster") {
    output(await generateHasnaRosterMedia(store, {
      voices: hasFlag(parsed, "voices") ? true : undefined,
      profileImages: hasFlag(parsed, "profile-images") ? true : undefined,
      outDir: flagValue(parsed, "out-dir"),
      dryRun: hasFlag(parsed, "dry-run"),
      limit: parseOptionalInteger(flagValue(parsed, "limit"), "limit"),
      voice: {
        mode: parseVoiceGenerationMode(flagValue(parsed, "mode")),
        voiceId: flagValue(parsed, "voice-id"),
        model: flagValue(parsed, "voice-model") ?? flagValue(parsed, "model"),
        outputFormat: flagValue(parsed, "output-format"),
        createVoice: hasFlag(parsed, "create-voice"),
      },
      profileImage: {
        model: flagValue(parsed, "image-model") ?? flagValue(parsed, "model"),
        aspectRatio: flagValue(parsed, "aspect-ratio"),
      },
    }), json);
    return;
  }

  throw new Error(`Unknown media command: ${subcommand ?? ""}`);
}

async function dispatchAsset(rest: string[], store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand === "list") {
    const identity = await store.require(required(target, "asset list requires an identity target"));
    output(identity.assets ?? [], json);
    return;
  }

  throw new Error(`Unknown asset command: ${subcommand ?? ""}`);
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
    voice: hasFlag(parsed, "clear-voice") ? null : undefined,
    profileImage: hasFlag(parsed, "clear-profile-image") ? null : undefined,
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
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    const value = next;
    index += 1;
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

function parseVoiceGenerationMode(value: string | undefined): VoiceGenerationMode | undefined {
  if (value === undefined) return undefined;
  if (value === "design" || value === "text-to-speech") return value;
  throw new Error(`Invalid voice generation mode: ${value}`);
}

function parseOptionalInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
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
