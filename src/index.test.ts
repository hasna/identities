import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createHasnaCompanyAgentInputs,
  createIdentity,
  deprecatedHasnaCompanyAgentIdentifiers,
  generateIdentityProfileImage,
  generateIdentityVoice,
  hasnaCompanyAgentSpecs,
  IdentityStore,
  seedHasnaCompanyAgents,
  syncIdentityContactPoints,
  syncIdentityContactPointsAndUpdate,
  writeEveAgent,
} from "./index.js";
import { runCli } from "./cli.js";

describe("open-identities", () => {
  test("creates identities with document slots", () => {
    const identity = createIdentity({
      kind: "agent",
      fullName: "Ava Example",
      uniqueIdentifier: "agent:ava-example",
      emails: ["ava@example.com"],
      phones: ["+15555550123"],
      documents: {
        prompt: "You are Ava.",
        ethos: "Be accurate.",
      },
    });

    expect(identity.id).toStartWith("oid_");
    expect(identity.uniqueIdentifier).toEqual({
      scheme: "agent",
      value: "ava-example",
      status: "unverified",
      sensitive: false,
    });
    expect(identity.emails[0]).toMatchObject({ address: "ava@example.com", primary: true });
    expect(identity.phones[0]).toMatchObject({ number: "+15555550123", primary: true });
    expect(identity.documents.prompt).toBe("You are Ava.");
    expect(identity.documents.soul).toBe("");
    expect(identity.assets).toEqual([]);
  });

  test("creates identities with voice, profile image, and asset metadata", () => {
    const identity = createIdentity({
      kind: "agent",
      fullName: "Media Agent",
      uniqueIdentifier: "agent:media-agent",
      voice: {
        provider: "elevenlabs",
        generatedVoiceId: "generated_voice_1",
        sampleText: "A sample voice line for this media agent.",
      },
      profileImage: {
        provider: "minimax",
        prompt: "A profile image prompt.",
        aspectRatio: "1:1",
      },
      assets: [
        {
          id: "asset_voice_1",
          kind: "voice",
          provider: "elevenlabs",
          path: "/tmp/voice.mp3",
          mediaType: "audio/mpeg",
        },
      ],
    });

    expect(identity.voice).toMatchObject({ provider: "elevenlabs", generatedVoiceId: "generated_voice_1" });
    expect(identity.profileImage).toMatchObject({ provider: "minimax", aspectRatio: "1:1" });
    expect(identity.assets[0]).toMatchObject({ id: "asset_voice_1", kind: "voice", status: "generated" });
  });

  test("persists and links contact points", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json") });
    const identity = await store.create({
      kind: "human",
      fullName: "Jordan Example",
      uniqueIdentifier: { scheme: "human", value: "jordan-example", status: "verified" },
    });

    await store.linkEmail(identity.id, "JORDAN@EXAMPLE.COM");
    await store.linkPhone("human:jordan-example", "+15555550199");

    const found = await store.require("jordan@example.com");
    expect(found.phones[0].number).toBe("+15555550199");
    expect((await store.listCards())[0].primaryEmail).toBe("jordan@example.com");
  });

  test("syncs contact points through adapters", async () => {
    const identity = createIdentity({
      kind: "agent",
      fullName: "Sync Agent",
      uniqueIdentifier: { scheme: "ssn", value: "123-45-6789", sensitive: true },
      emails: ["sync@example.com"],
      phones: ["+15555550222"],
    });

    const results = await syncIdentityContactPoints(identity, {
      mailery: {
        async upsertIdentityEmail(input) {
          expect(input.email.address).toBe("sync@example.com");
          expect(input.uniqueIdentifier.scheme).toBe("open-identities");
          expect(input.uniqueIdentifier.sensitive).toBe(false);
          return { externalId: "mailery_1" };
        },
      },
      telephony: {
        async upsertIdentityPhone(input) {
          expect(input.phone.number).toBe("+15555550222");
          return { externalId: "tel_1" };
        },
      },
    });

    expect(results).toEqual([
      { provider: "mailery", value: "sync@example.com", externalId: "mailery_1", status: "synced", syncedAt: expect.any(String) },
      { provider: "telephony", value: "+15555550222", externalId: "tel_1", status: "synced", syncedAt: expect.any(String) },
    ]);
  });

  test("rejects duplicate secondary identifiers and contact points", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });

    await store.create({
      kind: "human",
      fullName: "First Person",
      uniqueIdentifier: "human:first",
      identifiers: ["github:shared"],
      emails: ["shared@example.com"],
      phones: ["+15555550111"],
    });

    await expect(store.create({ kind: "human", fullName: "Second", uniqueIdentifier: "human:second", emails: ["shared@example.com"] })).rejects.toThrow(/conflicts/);
    await expect(store.create({ kind: "human", fullName: "Third", uniqueIdentifier: "human:third", identifiers: ["github:shared"] })).rejects.toThrow(/conflicts/);
    await expect(store.create({ kind: "human", fullName: "Fourth", uniqueIdentifier: "human:fourth", phones: ["+15555550111"] })).rejects.toThrow(/conflicts/);
  });

  test("persists sync refs when using store sync helper", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Persistent Sync Agent",
      uniqueIdentifier: "agent:persistent-sync",
      emails: ["persist@example.com"],
    });

    await syncIdentityContactPointsAndUpdate(store, identity.id, {
      mailery: {
        async upsertIdentityEmail() {
          return { externalId: "owner_123" };
        },
      },
    });

    const updated = await store.require(identity.id);
    expect(updated.emails[0]).toMatchObject({
      maileryId: "owner_123",
      sync: { provider: "mailery", externalId: "owner_123", status: "synced" },
    });
  });

  test("normalizes legacy store records without asset fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-legacy-"));
    const storePath = join(dir, "identities.json");
    const legacy = createIdentity({
      kind: "agent",
      fullName: "Legacy Agent",
      uniqueIdentifier: "agent:legacy-agent",
    }) as Record<string, unknown>;
    delete legacy.assets;

    await writeFile(storePath, `${JSON.stringify({ version: 1, identities: [legacy] }, null, 2)}\n`, "utf8");
    const store = new IdentityStore({ filePath: storePath, auditPath: join(dir, "audit.jsonl") });
    const identity = await store.require("agent:legacy-agent");

    expect(identity.assets).toEqual([]);
    expect(identity.documents.voice).toBe("");
  });

  test("generates media assets through injectable adapters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-media-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Media Agent",
      uniqueIdentifier: "agent:media-agent",
      documents: { voice: "Clear and direct." },
      agent: { role: "media testing" },
    });

    const voiceResult = await generateIdentityVoice(store, identity.id, {
      outDir: join(dir, "assets"),
      adapter: {
        async designVoice(input) {
          expect(input.description).toContain("Media Agent");
          return {
            audio: new Uint8Array([1, 2, 3]),
            mediaType: "audio/mpeg",
            generatedVoiceId: "generated_voice_1",
            previewText: input.text,
          };
        },
        async textToSpeech() {
          throw new Error("not used");
        },
      },
    });

    const imageResult = await generateIdentityProfileImage(store, identity.id, {
      outDir: join(dir, "assets"),
      adapter: {
        async generateProfileImage(input) {
          expect(input.prompt).toContain("Media Agent");
          return {
            image: new Uint8Array([4, 5, 6]),
            mediaType: "image/png",
          };
        },
      },
    });

    expect(Array.from(await readFile(voiceResult.asset.path!))).toEqual([1, 2, 3]);
    expect(Array.from(await readFile(imageResult.asset.path!))).toEqual([4, 5, 6]);
    const updated = await store.require(identity.id);
    expect(updated.assets).toHaveLength(2);
    expect(updated.voice?.generatedVoiceId).toBe("generated_voice_1");
    expect(updated.profileImage?.assetId).toBe(imageResult.asset.id);
  });

  test("exports an Eve agent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-eve-"));
    const identity = createIdentity({
      kind: "agent",
      fullName: "Eve Agent",
      uniqueIdentifier: "agent:eve-agent",
      documents: {
        prompt: "Act as Eve Agent.",
        capabilities: "Identity lookup and sync.",
      },
      agent: { model: "openai/gpt-5.4-mini", schedules: ["daily identity audit"] },
    });

    const result = await writeEveAgent(identity, { outDir: dir });
    expect(result.files.some((file) => file.endsWith("agent/instructions.md"))).toBe(true);
    expect(await readFile(join(dir, "agent", "instructions.md"), "utf8")).toContain("Act as Eve Agent.");
    expect(await readFile(join(dir, "agent", "identity.json"), "utf8")).toContain("agent:eve-agent");
  });

  test("CLI supports leading boolean flags and isolated store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-cli-"));
    const storePath = join(dir, "identities.json");
    const output = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "create", "--kind", "agent", "--name", "CLI Agent", "--identifier", "agent:cli-agent"]);
    });
    expect(JSON.parse(output).uniqueIdentifier.value).toBe("cli-agent");

    const versionOutput = await captureStdout(async () => {
      await runCli(["--json", "version"]);
    });
    expect(JSON.parse(versionOutput).version).toBe("0.1.3");
  });

  test("CLI rejects missing values for non-boolean flags", async () => {
    await expect(runCli(["create", "--kind"])).rejects.toThrow(/Missing value for --kind/);
  });

  test("CLI can clear media fields explicitly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-clear-media-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Clear Media Agent",
      uniqueIdentifier: "agent:clear-media-agent",
      voice: { provider: "elevenlabs", voiceId: "voice_1" },
      profileImage: { provider: "minimax", model: "image-01" },
    });

    const cleared = await store.update(identity.id, { voice: null, profileImage: null });
    expect(cleared.voice).toBeUndefined();
    expect(cleared.profileImage).toBeUndefined();
  });

  test("media status is metadata only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-media-status-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Status Media Agent",
      uniqueIdentifier: "agent:status-media-agent",
      voice: { provider: "elevenlabs", voiceId: "voice_1", sampleText: "secret sample" },
      profileImage: { provider: "minimax", prompt: "secret prompt" },
      assets: [{ kind: "voice", provider: "elevenlabs", path: "/tmp/secret.mp3", status: "generated" }],
    });

    const output = await captureStdout(async () => {
      await runCli(["--json", "--store", join(dir, "identities.json"), "media", "status", identity.id]);
    });
    expect(output).not.toContain("/tmp/secret.mp3");
    expect(output).not.toContain("secret sample");
    expect(output).not.toContain("secret prompt");
    expect(JSON.parse(output).assets.count).toBe(1);
  });

  test("CLI media roster dry-run plans generation without mutating the store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-media-cli-"));
    const storePath = join(dir, "identities.json");
    const output = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "media", "generate-roster", "--voices", "--profile-images", "--dry-run", "--limit", "1"]);
    });
    const parsed = JSON.parse(output);

    expect(parsed.planned).toBe(2);
    expect(parsed.generated).toHaveLength(2);
    expect(parsed.generated.every((item: { asset: { status: string } }) => item.asset.status === "planned")).toBe(true);
    const store = new IdentityStore({ filePath: storePath, auditPath: join(dir, "audit.jsonl") });
    expect(await store.list()).toHaveLength(0);
  });

  test("Hasna company roster uses Greek or Roman agent names and internal hasna.xyz emails", () => {
    const inputs = createHasnaCompanyAgentInputs();
    const classicalSlugs = new Set([
      "janus",
      "cassandra",
      "rhadamanthus",
      "archimedes",
      "cicero",
      "mercury",
      "hephaestus",
      "astraea",
      "vesta",
      "calliope",
      "plutus",
      "clio",
      "euclid",
      "echo",
      "homer",
      "aphrodite",
      "flora",
      "lucius",
      "numa",
      "asclepius",
      "eirene",
      "concordia",
      "fama",
      "themis",
      "hestia",
      "orpheus",
      "odysseus",
      "ceres",
      "pythia",
      "herodotus",
      "theseus",
      "phidias",
      "argus",
      "minos",
      "aurelius",
      "penelope",
      "harmonia",
      "mnemosyne",
      "persephone",
      "sibyl",
      "justitia",
    ]);
    const deprecated = new Set<string>(deprecatedHasnaCompanyAgentIdentifiers);
    expect(inputs).toHaveLength(classicalSlugs.size);
    expect(hasnaCompanyAgentSpecs.some((spec) => spec.slug === "hermes" || spec.fullName.toLowerCase().includes("hermes"))).toBe(false);

    for (const input of inputs) {
      const identifier = String(input.uniqueIdentifier);
      const slug = identifier.replace("agent:", "");
      expect(classicalSlugs.has(slug)).toBe(true);
      expect(deprecated.has(identifier)).toBe(false);
      const internalEmail = input.emails?.find((email) => typeof email !== "string" && email.label === "internal");
      expect(internalEmail).toBeDefined();
      if (typeof internalEmail !== "string") {
        expect(internalEmail.address).toBe(`${slug}@hasna.xyz`);
        expect(internalEmail.primary).toBe(true);
      }
      expect(input.documents?.prompt?.trim()).not.toBe("");
      expect(input.documents?.soul?.trim()).not.toBe("");
      expect(input.documents?.personality?.trim()).not.toBe("");
      expect(input.documents?.ethos?.trim()).not.toBe("");
      expect(input.voice).toMatchObject({ provider: "elevenlabs" });
      expect(input.profileImage).toMatchObject({ provider: "minimax", aspectRatio: "1:1" });
    }
  });

  test("CLI seeds company agents and exports markdown documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-roster-"));
    const storePath = join(dir, "identities.json");
    const docsDir = join(dir, "agents");
    const store = new IdentityStore({ filePath: storePath, auditPath: join(dir, "audit.jsonl") });

    await store.create({
      kind: "agent",
      fullName: "Hermes CLI SDK Engineer",
      uniqueIdentifier: "agent:hermes",
      emails: ["hermes@agents.hasna.local"],
    });
    await store.create({
      kind: "agent",
      fullName: "Email Marketing Manager Agent",
      uniqueIdentifier: "agent:email-marketing",
      emails: ["email-marketing@hasna.xyz"],
    });

    const seedOutput = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "agent", "seed-company", "--docs-dir", docsDir]);
    });
    const seeded = JSON.parse(seedOutput);
    expect(seeded.deleted).toEqual(["agent:hermes", "agent:email-marketing"]);
    expect(seeded.documents.length).toBeGreaterThan(100);

    const updatedStore = new IdentityStore({ filePath: storePath, auditPath: join(dir, "audit.jsonl") });
    await expect(updatedStore.require("agent:hermes")).rejects.toThrow(/not found/);
    await expect(updatedStore.require("agent:email-marketing")).rejects.toThrow(/not found/);
    const calliope = await updatedStore.require("agent:calliope");
    expect(calliope.emails[0]).toMatchObject({ address: "calliope@hasna.xyz", label: "internal", primary: true });
    expect(calliope.emails.some((email) => email.address === "marketing@hasna.com" && email.label === "public")).toBe(true);
    expect(calliope.voice).toMatchObject({ provider: "elevenlabs", model: "eleven_multilingual_ttv_v2" });
    expect(calliope.profileImage).toMatchObject({ provider: "minimax", model: "image-01" });
    expect(await readFile(join(docsDir, "calliope", "PROMPT.md"), "utf8")).toContain("calliope@hasna.xyz");
    expect(await readFile(join(docsDir, "calliope", "IDENTITY.md"), "utf8")).toContain("marketing@hasna.com");
    expect(await readFile(join(docsDir, "calliope", "IDENTITY.md"), "utf8")).toContain("Voice provider: elevenlabs");
  });
});

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}
