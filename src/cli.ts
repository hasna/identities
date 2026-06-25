#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { IdentityStore } from "./storage.js";
import { getIdentityStoreStatus, projectIdentityMediaStatus, projectIdentityMediaSummary, type IdentityReferenceStatus } from "./status.js";
import {
  identityDocumentKeys,
  type BrowserPlanCoverageReport,
  type Identity,
  type IdentityDocumentKey,
  type IdentityKind,
} from "./types.js";
import { createEcosystemRegistrationManifest, createAgentIdentityRef } from "./ecosystem.js";
import {
  findPrimaryEmail,
  identityIdentifierToString,
  identityToAgentManifest,
  publicIdentityIdentifier,
} from "./core.js";
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
  "verified",
  "ready-only",
  "verbose",
]);

const helpText = `identities

Usage:
  identities [--json] [--verbose] [--limit n] [--store <path>] [--audit <path>] <command>

Commands:
  create --name <name> [--kind human|agent|organization|service] [--identifier scheme:value] [--email address] [--phone number]
  update <id|identifier> [--name <name>] [--display-name <name>] [--kind kind]
  list [--limit n]
  status [--verbose]
  show <id|identifier|email|phone> [--verbose]
  delete <id|identifier>
  link-email <id|identifier> <email> [--verified] [--mailery-id id]
  link-phone <id|identifier> <phone>
  machine list <machine-id> [--purpose browserplan] [--limit n]
  machine assign <id|identifier> <machine-id> [--purpose browserplan] [--slot slot]
  browserplan list --machine <machine-id> [--require count] [--ready-only] [--limit n]
  browserplan reserve <id|identifier> --machine <machine-id> [--email address] [--profile name] [--slot slot]
  browserplan coverage [--target 8]
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
Human output is compact by default. Use --verbose for full object details, --json for machine-readable output, and --limit n for longer tables.
`;

const defaultHumanLimit = 20;
const defaultPreviewLength = 160;

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parseArgs(argv);
  const json = hasFlag(parsed, "json");
  const store = createStoreFromArgs(parsed);

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
    if (json) output({ version }, true);
    else console.log(version);
    return;
  }

  if (command === "list") {
    const cards = await store.listCards();
    if (json) output(cards, json);
    else if (hasFlag(parsed, "verbose")) output(await store.list(), true);
    else {
      const { rows, total, limit } = limitRows(cards, parsed);
      printTable(["id", "kind", "name", "email", "phone"], rows.map((card) => [
        card.id,
        card.kind,
        card.fullName,
        card.primaryEmail ?? "",
        card.primaryPhone ?? "",
      ]));
      printLimitHint("identities", rows.length, total, limit, "identities list --limit <n>");
      printDetailsHint("Use `identities show <id> --verbose` for full details or `--json` for machine-readable output.");
    }
    return;
  }

  if (command === "status") {
    const status = await getIdentityStoreStatus(store);
    if (json || hasFlag(parsed, "verbose")) output(status, true);
    else printStatusSummary(status);
    return;
  }

  if (command === "show") {
    const identity = await store.require(required(rest[0], "show requires an identity target"));
    outputIdentity(identity, parsed, json, "Identity");
    return;
  }

  if (command === "create") {
    const identity = await store.create(createInputFromFlags(parsed));
    outputIdentity(identity, parsed, json, "Created identity");
    return;
  }

  if (command === "update") {
    const target = required(rest[0], "update requires an identity target");
    outputIdentity(await store.update(target, createUpdateFromFlags(parsed)), parsed, json, "Updated identity");
    return;
  }

  if (command === "link-email") {
    const [target, email] = rest;
    outputIdentity(await store.linkEmail(required(target, "link-email requires an identity target"), {
      address: required(email, "link-email requires an email"),
      verified: hasFlag(parsed, "verified"),
      maileryId: flagValue(parsed, "mailery-id"),
    }), parsed, json, "Linked email");
    return;
  }

  if (command === "link-phone") {
    const [target, phone] = rest;
    outputIdentity(
      await store.linkPhone(required(target, "link-phone requires an identity target"), required(phone, "link-phone requires a phone number")),
      parsed,
      json,
      "Linked phone",
    );
    return;
  }

  if (command === "machine") {
    await dispatchMachine(rest, parsed, store, json);
    return;
  }

  if (command === "browserplan") {
    await dispatchBrowserPlan(rest, parsed, store, json);
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
    await dispatchAsset(rest, parsed, store, json);
    return;
  }

  if (command === "sync") {
    const target = required(rest[0], "sync requires an identity target");
    const result = await syncIdentityContactPointsAndUpdate(store, target, {});
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else printSyncSummary(result);
    return;
  }

  if (command === "validate" || command === "doctor") {
    const result = await store.validate();
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else console.log(`${result.valid ? "Valid" : "Invalid"} store: ${result.count} identities.`);
    return;
  }

  if (command === "export") {
    const identities = await store.list();
    const targetPath = rest[0];
    if (targetPath) {
      await writeFile(targetPath, `${JSON.stringify({ version: 1, identities }, null, 2)}\n`, "utf8");
      const result = { exported: identities.length, path: targetPath };
      if (json || hasFlag(parsed, "verbose")) output(result, true);
      else console.log(`Exported ${result.exported} identities to ${result.path}.`);
    } else {
      output({ version: 1, identities }, true);
    }
    return;
  }

  if (command === "import") {
    const path = required(rest[0], "import requires a path");
    const parsedImport = JSON.parse(await readFile(path, "utf8")) as { identities?: Identity[] };
    await store.replaceAll(parsedImport.identities ?? []);
    const result = { imported: parsedImport.identities?.length ?? 0, path };
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else console.log(`Imported ${result.imported} identities from ${result.path}.`);
    return;
  }

  if (command === "delete") {
    const target = required(rest[0], "delete requires an identity target");
    const deleted = await store.delete(target);
    if (json || hasFlag(parsed, "verbose")) output({ deleted }, true);
    else console.log(deleted ? `Deleted ${target}.` : `No identity matched ${target}.`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function createStoreFromArgs(parsed: ParsedArgs): IdentityStore {
  const filePath = flagValue(parsed, "store");
  return new IdentityStore({
    filePath,
    auditPath: flagValue(parsed, "audit") ?? (filePath ? `${filePath}.audit.jsonl` : undefined),
  });
}

function projectMachineIdentity(identity: Identity, machineId: string) {
  const normalizedMachineId = machineId.toLowerCase();
  const primaryEmail = findPrimaryEmail(identity);
  return {
    id: identity.id,
    kind: identity.kind,
    fullName: identity.fullName,
    displayName: identity.displayName,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    primaryEmail: primaryEmail?.address,
    emailVerified: primaryEmail?.verified ?? false,
    maileryId: primaryEmail?.maileryId ?? primaryEmail?.sync?.externalId,
    machineAssignments: (identity.machineAssignments ?? [])
      .filter((assignment) => assignment.status !== "released" && assignment.machineId === normalizedMachineId)
      .map((assignment) => ({
        machineId: assignment.machineId,
        purpose: assignment.purpose,
        slot: assignment.slot,
        status: assignment.status,
        assignedAt: assignment.assignedAt,
      })),
  };
}

async function dispatchMachine(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target, machineId] = rest;
  if (subcommand === "list") {
    const normalizedMachineId = required(target, "machine list requires a machine id");
    const identities = await store.listByMachine(required(target, "machine list requires a machine id"), {
      purpose: flagValue(parsed, "purpose"),
    });
    if (json) output(identities.map((identity) => projectMachineIdentity(identity, normalizedMachineId)), json);
    else if (hasFlag(parsed, "verbose")) output(identities, true);
    else {
      const { rows, total, limit } = limitRows(identities, parsed);
      printTable(["id", "kind", "name", "email", "assignments"], rows.map((identity) => [
        identity.id,
        identity.kind,
        identity.fullName,
        identity.emails[0]?.address ?? "",
        String(identity.machineAssignments?.filter((assignment) => assignment.status !== "released").length ?? 0),
      ]));
      printLimitHint("identities", rows.length, total, limit, "identities machine list <machine> --limit <n>");
      printDetailsHint("Use `identities show <id> --verbose` for full identity details or `--json` for the machine summary contract.");
    }
    return;
  }

  if (subcommand === "assign") {
    outputIdentity(await store.assignMachine(required(target, "machine assign requires an identity target"), {
      machineId: required(machineId ?? flagValue(parsed, "machine"), "machine assign requires a machine id"),
      purpose: flagValue(parsed, "purpose") ?? "browserplan",
      slot: flagValue(parsed, "slot"),
    }), parsed, json, "Assigned machine");
    return;
  }

  throw new Error(`Unknown machine command: ${subcommand ?? ""}`);
}

async function dispatchBrowserPlan(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand === "list") {
    const machineId = required(flagValue(parsed, "machine") ?? target, "browserplan list requires --machine");
    const profiles = await store.listBrowserPlanProfilesByMachine(machineId, {
      requiredCount: parseOptionalInteger(flagValue(parsed, "require"), "require"),
      readyOnly: hasFlag(parsed, "ready-only"),
    });
    if (json || hasFlag(parsed, "verbose")) output(profiles, true);
    else {
      const { rows, total, limit } = limitRows(profiles, parsed);
      printTable(["machine", "slot", "profile", "email", "ready", "identity"], rows.map((profile) => [
        profile.machineId,
        profile.slot ?? "",
        profile.profileName,
        profile.email,
        profile.emailReady ? "yes" : "no",
        profile.identityId,
      ]));
      printLimitHint("profiles", rows.length, total, limit, "identities browserplan list --machine <id> --limit <n>");
      printDetailsHint("Use `--ready-only`, `--require <n>`, or `--json` for the full BrowserPlan profile contract.");
    }
    return;
  }

  if (subcommand === "reserve") {
    outputIdentity(await store.reserveBrowserPlanProfile(required(target, "browserplan reserve requires an identity target"), {
      machineId: required(flagValue(parsed, "machine"), "browserplan reserve requires --machine"),
      email: flagValue(parsed, "email"),
      profileName: flagValue(parsed, "profile"),
      slot: flagValue(parsed, "slot"),
    }), parsed, json, "Reserved BrowserPlan profile");
    return;
  }

  if (subcommand === "coverage") {
    const report = await store.getBrowserPlanCoverage({
      targetPerMachine: parseOptionalInteger(flagValue(parsed, "target"), "target"),
      machineIds: flagValues(parsed, "machine").length > 0 ? flagValues(parsed, "machine") : undefined,
    });
    if (json || hasFlag(parsed, "verbose")) output(report, true);
    else printBrowserPlanCoverage(report);
    return;
  }

  throw new Error(`Unknown browserplan command: ${subcommand ?? ""}`);
}

async function dispatchDoc(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target, keyOrMaybeDir, value] = rest;
  if (subcommand === "get") {
    const identity = await store.require(required(target, "doc get requires an identity target"));
    const key = requireDocumentKey(keyOrMaybeDir);
    const value = identity.documents[key] ?? "";
    if (json || hasFlag(parsed, "verbose")) output({ key, value }, true);
    else {
      console.log(`${key}: ${truncate(value, defaultPreviewLength)}`);
      if (value.length > defaultPreviewLength) {
        printDetailsHint("Use `--verbose` or `--json` to print the full document value.");
      }
    }
    return;
  }

  if (subcommand === "set") {
    const key = requireDocumentKey(keyOrMaybeDir);
    const file = flagValue(parsed, "file");
    const nextValue = file ? await readFile(file, "utf8") : required(value, "doc set requires a value or --file");
    outputIdentity(
      await store.update(required(target, "doc set requires an identity target"), { documents: { [key]: nextValue } }),
      parsed,
      json,
      `Updated document ${key}`,
    );
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
    const result = { exported: files.length, files };
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else console.log(`Exported ${result.exported} documents to ${dir}.`);
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
    outputIdentity(
      await store.update(required(target, "doc import requires an identity target"), { documents }),
      parsed,
      json,
      `Imported ${Object.keys(documents).length} documents`,
    );
    return;
  }

  throw new Error(`Unknown doc command: ${subcommand ?? ""}`);
}

async function dispatchAgent(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand === "manifest") {
    const identity = await store.require(required(target, "agent manifest requires an identity target"));
    const manifest = createEcosystemRegistrationManifest(identity, [
      createAgentIdentityRef(identity, { source: "todos" }),
      createAgentIdentityRef(identity, { source: "mementos" }),
      createAgentIdentityRef(identity, { source: "conversations" }),
      createAgentIdentityRef(identity, { source: "eve" }),
    ]);
    if (json || hasFlag(parsed, "verbose")) output(manifest, true);
    else {
      console.log(`Agent manifest: ${manifest.identity.identifier}`);
      console.log(`Refs: ${manifest.refs.map((ref) => `${ref.source}:${ref.identifier}`).join(", ")}`);
      printDetailsHint("Use `--json` or `--verbose` for the full registration manifest.");
    }
    return;
  }

  if (subcommand === "register") {
    const identity = await store.create({
      ...createInputFromFlags(parsed),
      kind: "agent",
      uniqueIdentifier: flagValue(parsed, "identifier") ?? `agent:${slugify(required(flagValue(parsed, "name"), "agent register requires --name"))}`,
    });
    const manifest = identityToAgentManifest(identity);
    if (json || hasFlag(parsed, "verbose")) output(manifest, true);
    else {
      printIdentitySummary(identity, "Registered agent");
      printDetailsHint("Use `agent manifest <id> --json` for the full agent manifest.");
    }
    return;
  }

  if (subcommand === "seed-company") {
    const result = await seedHasnaCompanyAgents(store, {
      docsDir: flagValue(parsed, "docs-dir"),
      pruneDeprecated: !hasFlag(parsed, "keep-deprecated"),
    });
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else {
      console.log(`Seeded ${result.created.length + result.updated.length} Hasna company agents (${result.created.length} created, ${result.updated.length} updated).`);
      console.log(`Deleted deprecated identities: ${result.deleted.length}. Exported documents: ${result.documents.length}.`);
      printDetailsHint("Use `--json` or `--verbose` for per-agent and per-document details.");
    }
    return;
  }

  throw new Error(`Unknown agent command: ${subcommand ?? ""}`);
}

async function dispatchEve(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand !== "export") throw new Error(`Unknown eve command: ${subcommand ?? ""}`);
  const identity = await store.require(required(target, "eve export requires an identity target"));
  const outDir = required(flagValue(parsed, "out"), "eve export requires --out");
  const result = await writeEveAgent(identity, { outDir, model: flagValue(parsed, "model") });
  if (json || hasFlag(parsed, "verbose")) output(result, true);
  else {
    console.log(`Exported Eve agent for ${identity.displayName ?? identity.fullName}.`);
    console.log(`Files: ${result.files.length}. Output: ${outDir}.`);
    printDetailsHint("Use `--json` or `--verbose` for the file list.");
  }
}

async function dispatchMedia(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;

  if (subcommand === "doctor" || subcommand === "secrets") {
    const result = { assetsDir: getIdentityMediaAssetsDir(), secrets: detectIdentityMediaSecrets() };
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else {
      console.log(`Assets dir: ${redactAssetsDir(result.assetsDir)}`);
      console.log(`Secrets: ${Object.entries(result.secrets).map(([name, status]) => `${name}=${status.available ? "set" : "missing"}`).join(", ")}`);
    }
    return;
  }

  if (subcommand === "status") {
    if (target) {
      const identity = await store.require(target);
      const result = projectIdentityMediaStatus(identity);
      if (json || hasFlag(parsed, "verbose")) output(result, true);
      else printMediaStatusSummary(result);
      return;
    }

    const identities = await store.list();
    const result = {
      count: identities.length,
      assetsDir: getIdentityMediaAssetsDir(),
      identities: identities.map(projectIdentityMediaSummary),
    };
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else printMediaStoreSummary(result, parsed);
    return;
  }

  if (subcommand === "generate-voice") {
    const result = await generateIdentityVoice(store, required(target, "media generate-voice requires an identity target"), {
      mode: parseVoiceGenerationMode(flagValue(parsed, "mode")),
      voiceId: flagValue(parsed, "voice-id"),
      voiceDescription: flagValue(parsed, "voice-description") ?? flagValue(parsed, "description"),
      text: flagValue(parsed, "text"),
      model: flagValue(parsed, "model"),
      outputFormat: flagValue(parsed, "output-format"),
      outDir: flagValue(parsed, "out-dir"),
      dryRun: hasFlag(parsed, "dry-run"),
      createVoice: hasFlag(parsed, "create-voice"),
    });
    outputMediaGeneration(result, parsed, json, "voice");
    return;
  }

  if (subcommand === "generate-profile-image" || subcommand === "generate-picture" || subcommand === "generate-profile-picture") {
    const result = await generateIdentityProfileImage(store, required(target, "media generate-profile-image requires an identity target"), {
      prompt: flagValue(parsed, "prompt"),
      model: flagValue(parsed, "model"),
      aspectRatio: flagValue(parsed, "aspect-ratio"),
      outDir: flagValue(parsed, "out-dir"),
      dryRun: hasFlag(parsed, "dry-run"),
    });
    outputMediaGeneration(result, parsed, json, "profile image");
    return;
  }

  if (subcommand === "generate-roster") {
    const result = await generateHasnaRosterMedia(store, {
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
    });
    if (json || hasFlag(parsed, "verbose")) output(result, true);
    else {
      const planned = result.generated.filter((item) => item.asset.status === "planned").length;
      const failed = result.generated.filter((item) => item.asset.status === "failed").length;
      console.log(`Roster media: ${result.generated.length} items (${planned} planned, ${failed} failed).`);
      console.log(`Created assets: ${result.generated.filter((item) => item.asset.status === "generated").length}.`);
      printDetailsHint("Use `--json` or `--verbose` for per-identity generation results.");
    }
    return;
  }

  throw new Error(`Unknown media command: ${subcommand ?? ""}`);
}

async function dispatchAsset(rest: string[], parsed: ParsedArgs, store: IdentityStore, json: boolean): Promise<void> {
  const [subcommand, target] = rest;
  if (subcommand === "list") {
    const identity = await store.require(required(target, "asset list requires an identity target"));
    const assets = identity.assets ?? [];
    if (json || hasFlag(parsed, "verbose")) output(assets, true);
    else {
      const { rows, total, limit } = limitRows(assets, parsed);
      printTable(["id", "kind", "provider", "status", "source"], rows.map((asset) => [
        asset.id,
        asset.kind,
        asset.provider,
        asset.status,
        asset.source ?? "",
      ]));
      printLimitHint("assets", rows.length, total, limit, "identities asset list <id> --limit <n>");
      printDetailsHint("Use `--json` or `--verbose` for full asset metadata.");
    }
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
    machineAssignments: machineFlags(parsed),
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

function machineFlags(parsed: ParsedArgs) {
  return flagValues(parsed, "machine").map((machineId) => ({
    machineId,
    purpose: flagValue(parsed, "purpose") ?? "browserplan",
    slot: flagValue(parsed, "slot"),
  }));
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
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function requireDocumentKey(value: string | undefined): IdentityDocumentKey {
  const key = required(value, "document key is required") as IdentityDocumentKey;
  if (!identityDocumentKeys.includes(key)) throw new Error(`Invalid document key: ${key}`);
  return key;
}

function outputIdentity(identity: Identity, parsed: ParsedArgs, json: boolean, label: string): void {
  if (json || hasFlag(parsed, "verbose")) {
    output(identity, true);
    return;
  }
  printIdentitySummary(identity, label);
  printDetailsHint("Use `--verbose` for the full identity object or `--json` for machine-readable output.");
}

function printIdentitySummary(identity: Identity, label: string): void {
  const primaryEmail = findPrimaryEmail(identity);
  const populatedDocuments = identityDocumentKeys.filter((key) => Boolean(identity.documents[key]?.trim())).length;
  const activeMachineAssignments = identity.machineAssignments?.filter((assignment) => assignment.status !== "released").length ?? 0;
  const activeBrowserPlanProfiles = identity.browserPlanProfiles?.filter((profile) => profile.status !== "released").length ?? 0;
  console.log(`${label}: ${identity.displayName ?? identity.fullName}`);
  printTable(["field", "value"], [
    ["id", identity.id],
    ["kind", identity.kind],
    ["identifier", identityIdentifierToString(publicIdentityIdentifier(identity))],
    ["primaryEmail", primaryEmail ? `${primaryEmail.address}${primaryEmail.verified ? " (verified)" : ""}` : ""],
    ["phones", String(identity.phones.length)],
    ["documents", `${populatedDocuments}/${identityDocumentKeys.length} populated`],
    ["agent", identity.agent ? "yes" : "no"],
    ["assets", String(identity.assets?.length ?? 0)],
    ["machineAssignments", String(activeMachineAssignments)],
    ["browserPlanProfiles", String(activeBrowserPlanProfiles)],
  ]);
}

function printStatusSummary(status: IdentityReferenceStatus): void {
  const kinds = Object.entries(status.counts.byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${kind}:${count}`)
    .join(", ") || "none";

  console.log(`${status.package.name} ${status.package.version}`);
  printTable(["area", "summary"], [
    ["store", `${status.store.records} records (${status.store.exists ? "exists" : "missing"})`],
    ["identities", `${status.counts.identities} total; ${kinds}`],
    ["contacts", `${status.counts.emails} emails, ${status.counts.phones} phones, ${status.counts.maileryRefs} Mailery refs, ${status.counts.telephonyRefs} Telephony refs`],
    ["agents", `${status.counts.agentProfiles} profiles, ${status.counts.uniqueAgentRoles} unique roles, ${status.counts.toolRefs} tool refs`],
    ["documents", `${status.counts.populatedDocuments}/${status.counts.documentSlots} populated slots`],
    ["browserplan", `${status.counts.machineAssignments} machine assignments, ${status.counts.browserPlanProfiles} profile reservations`],
    ["roster", `${status.counts.roster.seededCurrentVersion}/${status.counts.roster.builtInAgents} current built-in agents seeded`],
    ["safety", "metadata-only; contact values, document bodies, credentials, and raw ids omitted"],
  ]);
  printDetailsHint("Use `identities status --json` for the full stable contract or `--verbose` for the full object.");
}

function printBrowserPlanCoverage(report: BrowserPlanCoverageReport): void {
  printTable(["machine", "usable", "missing", "assigned", "email", "reserved"], report.machines.map((machine) => [
    machine.machineId,
    String(machine.usable),
    String(machine.missing),
    String(machine.assigned),
    String(machine.withEmail),
    String(machine.reserved),
  ]));
  console.log(`Totals: ${report.totals.usable}/${report.totals.target} usable, ${report.totals.missing} missing across ${report.totals.machines} machines.`);
  if (report.excludedMachineIds.length > 0) console.log(`Excluded: ${report.excludedMachineIds.join(", ")}.`);
  printDetailsHint("Use `--json` or `--verbose` for the full BrowserPlan coverage contract.");
}

function printMediaStatusSummary(status: ReturnType<typeof projectIdentityMediaStatus>): void {
  console.log(`Media: ${status.name}`);
  printTable(["field", "value"], [
    ["identifier", status.identifier],
    ["kind", status.kind],
    ["voice", status.voice ? status.voice.provider : "none"],
    ["profileImage", status.profileImage ? status.profileImage.provider : "none"],
    ["assets", `${status.assets.count} total (${status.assets.byKind.voice} voice, ${status.assets.byKind["profile-image"]} profile-image)`],
  ]);
  printDetailsHint("Use `--json` or `--verbose` for metadata items.");
}

function printMediaStoreSummary(
  status: { count: number; assetsDir: string; identities: ReturnType<typeof projectIdentityMediaSummary>[] },
  parsed: ParsedArgs,
): void {
  console.log(`Media store: ${status.count} identities. Assets dir: ${redactAssetsDir(status.assetsDir)}`);
  const { rows, total, limit } = limitRows(status.identities, parsed);
  printTable(["id", "kind", "name", "assets", "voice", "image"], rows.map((identity) => [
    identity.identityId,
    identity.kind,
    identity.name,
    String(identity.assets),
    identity.hasVoice ? "yes" : "no",
    identity.hasProfileImage ? "yes" : "no",
  ]));
  printLimitHint("identities", rows.length, total, limit, "identities media status --limit <n>");
  printDetailsHint("Use `identities media status <id>` for one identity or `--json` for the full metadata summary.");
}

function outputMediaGeneration(
  result: Awaited<ReturnType<typeof generateIdentityVoice>>,
  parsed: ParsedArgs,
  json: boolean,
  label: string,
): void {
  if (json || hasFlag(parsed, "verbose")) {
    output(result, true);
    return;
  }
  console.log(`Generated ${label}: ${result.identifier}`);
  printTable(["field", "value"], [
    ["identityId", result.identityId],
    ["provider", result.provider],
    ["asset", `${result.asset.id} (${result.asset.status})`],
    ["dryRun", result.dryRun ? "yes" : "no"],
  ]);
  printDetailsHint("Use `--json` or `--verbose` for full media metadata.");
}

function printSyncSummary(result: Awaited<ReturnType<typeof syncIdentityContactPointsAndUpdate>>): void {
  printIdentitySummary(result.identity, "Synced identity");
  if (result.results.length === 0) {
    console.log("Sync results: none.");
    return;
  }
  printTable(["provider", "status", "externalId", "error"], result.results.map((item) => [
    item.provider,
    item.status,
    item.externalId ?? "",
    item.error ? truncate(item.error, 80) : "",
  ]));
  printDetailsHint("Use `--json` or `--verbose` for raw sync results.");
}

function limitRows<T>(items: T[], parsed: ParsedArgs): { rows: T[]; total: number; limit: number } {
  const limit = parseOptionalInteger(flagValue(parsed, "limit"), "limit") ?? defaultHumanLimit;
  return { rows: items.slice(0, limit), total: items.length, limit };
}

function printLimitHint(label: string, shown: number, total: number, limit: number, command: string): void {
  if (total > shown) {
    console.log(`Showing ${shown} of ${total} ${label}. Use \`${command}\` or \`--json\` for more.`);
  } else if (total > limit) {
    console.log(`Showing ${shown} of ${total} ${label}.`);
  }
}

function printDetailsHint(message: string): void {
  console.log(message);
}

function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  const widths = headers.map((header, index) => {
    return Math.min(48, Math.max(header.length, ...rows.map((row) => displayCell(row[index]).length)));
  });
  console.log(headers.map((header, index) => padCell(header, widths[index])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(row.map((cell, index) => padCell(displayCell(cell), widths[index])).join("  "));
  }
}

function displayCell(value: string | undefined): string {
  return truncate(value ?? "", 48);
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}...`;
}

function output(value: unknown, json: boolean): void {
  if (typeof value === "string" && !json) console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

function redactAssetsDir(path: string): string {
  const defaultAssetsDir = join(homedir(), ".hasna", "identities", "assets");
  if (path === defaultAssetsDir && !process.env["OPEN_IDENTITIES_ASSETS_DIR"]) return "~/.hasna/identities/assets";
  return "<custom-assets-dir>";
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
