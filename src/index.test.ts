import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  createHasnaCompanyAgentInputs,
  createBrowserPlanCoverageReport,
  createIdentity,
  deprecatedHasnaCompanyAgentIdentifiers,
  generateIdentityProfileImage,
  generateIdentityVoice,
  hasnaCompanyAgentSpecs,
  IdentityStore,
  listBrowserPlanProfiles,
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

  test("creates identities with machine assignments and reserves BrowserPlan profiles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-browserplan-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Browser Agent",
      uniqueIdentifier: "agent:browser-agent",
      emails: [{ address: "Browser.Agent@Example.com", verified: true, maileryId: "mailery_1" }],
      machineAssignments: [{ machineId: "MACHINE001", purpose: "browserplan", slot: "profile-01" }],
    });

    expect(identity.machineAssignments[0]).toMatchObject({
      machineId: "machine001",
      purpose: "browserplan",
      slot: "profile-01",
      status: "assigned",
    });

    const reserved = await store.reserveBrowserPlanProfile(identity.id, {
      machineId: "machine001",
      profileName: "Browser Agent 01",
      slot: "profile-01",
    });

    expect(reserved.browserPlanProfiles[0]).toMatchObject({
      machineId: "machine001",
      profileName: "Browser Agent 01",
      email: "browser.agent@example.com",
      slot: "profile-01",
      status: "reserved",
    });

    const byMachine = await store.listByMachine("machine001", { purpose: "browserplan" });
    expect(byMachine.map((item) => item.id)).toEqual([identity.id]);

    const profiles = await store.listBrowserPlanProfilesByMachine("machine001", { requiredCount: 1 });
    expect(profiles).toEqual([
      expect.objectContaining({
        identityId: identity.id,
        machineId: "machine001",
        profileName: "Browser Agent 01",
        email: "browser.agent@example.com",
        emailVerified: true,
        emailReady: true,
        maileryId: "mailery_1",
        slot: "profile-01",
      }),
    ]);
  });

  test("prevents duplicate BrowserPlan slots and reports insufficient profile data", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-browserplan-duplicates-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const first = await store.create({
      kind: "agent",
      fullName: "First Browser Agent",
      uniqueIdentifier: "agent:first-browser-agent",
      emails: ["first-browser@example.com"],
      machineAssignments: [{ machineId: "machine002", purpose: "browserplan", slot: "profile-01" }],
    });
    const second = await store.create({
      kind: "agent",
      fullName: "Second Browser Agent",
      uniqueIdentifier: "agent:second-browser-agent",
      emails: ["second-browser@example.com"],
      machineAssignments: [{ machineId: "machine002", purpose: "browserplan", slot: "profile-02" }],
    });

    await store.reserveBrowserPlanProfile(first.id, { machineId: "machine002", slot: "profile-01" });
    await expect(store.reserveBrowserPlanProfile(second.id, { machineId: "machine002", slot: "profile-01" })).rejects.toThrow(/conflicts/);
    await expect(store.listBrowserPlanProfilesByMachine("machine002", { requiredCount: 2 })).rejects.toThrow(/Insufficient ready BrowserPlan profiles/);
    expect(() => createIdentity({
      kind: "agent",
      fullName: "Duplicate BrowserPlan Agent",
      uniqueIdentifier: "agent:duplicate-browserplan-agent",
      emails: [{ address: "duplicate-browserplan@example.com", verified: true, maileryId: "mailery_duplicate" }],
      machineAssignments: [{ machineId: "machine002", purpose: "browserplan" }],
      browserPlanProfiles: [
        { machineId: "machine002", slot: "profile-03" },
        { machineId: "machine002", slot: "profile-04" },
      ],
    })).toThrow(/Duplicate BrowserPlan profile email/);
  });

  test("requires machine assignment and attached email before BrowserPlan reservation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-browserplan-errors-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Unassigned Browser Agent",
      uniqueIdentifier: "agent:unassigned-browser-agent",
      emails: ["unassigned-browser@example.com"],
    });

    await expect(store.reserveBrowserPlanProfile(identity.id, { machineId: "machine003" })).rejects.toThrow(/not assigned/);
    await store.assignMachine(identity.id, { machineId: "machine003", purpose: "browserplan" });
    await expect(store.reserveBrowserPlanProfile(identity.id, {
      machineId: "machine003",
      email: "other-browser@example.com",
    })).rejects.toThrow(/not attached/);

    expect(() => createIdentity({
      kind: "agent",
      fullName: "Invalid BrowserPlan Agent",
      uniqueIdentifier: "agent:invalid-browserplan-agent",
      emails: ["invalid-browserplan@example.com"],
      browserPlanProfiles: [{ machineId: "machine003" }],
    })).toThrow(/requires machine assignment/);
  });

  test("BrowserPlan coverage reports target gaps per machine", () => {
    const identity = createIdentity({
      kind: "agent",
      fullName: "Coverage Browser Agent",
      uniqueIdentifier: "agent:coverage-browser-agent",
      emails: [{ address: "coverage-browser@example.com", verified: true, maileryId: "mailery_coverage" }],
      machineAssignments: [{ machineId: "machine004", purpose: "browserplan" }],
      browserPlanProfiles: [{ machineId: "machine004", profileName: "Coverage Browser Agent" }],
    });

    const report = listBrowserPlanProfiles([identity], "machine004", { requiredCount: 1 });
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ machineId: "machine004", email: "coverage-browser@example.com" });
    const coverage = createBrowserPlanCoverageReport([identity], { machineIds: ["machine004"], targetPerMachine: 8 });
    expect(coverage.machines[0]).toMatchObject({ assigned: 1, withEmail: 1, usable: 1, missing: 7 });
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

  test("preserves previously stored assets when later updates use stale snapshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-media-race-"));
    const store = new IdentityStore({ filePath: join(dir, "identities.json"), auditPath: join(dir, "audit.jsonl") });
    const identity = await store.create({
      kind: "agent",
      fullName: "Race Condition Agent",
      uniqueIdentifier: "agent:race-condition-agent",
    });

    const snapshot = await store.require(identity.id);
    await store.update(identity.id, {
      assets: [
        {
          id: "asset_voice_1",
          kind: "voice",
          provider: "elevenlabs",
        },
      ],
      voice: { provider: "elevenlabs" },
    });

    await store.update(identity.id, {
      assets: [
        ...snapshot.assets,
        {
          id: "asset_profile_1",
          kind: "profile-image",
          provider: "minimax",
        },
      ],
      profileImage: { provider: "minimax" },
    });

    const updated = await store.require(identity.id);
    expect(updated.assets).toHaveLength(2);
    expect(updated.voice?.provider).toBe("elevenlabs");
    expect(updated.profileImage?.provider).toBe("minimax");
  });

  test("exports an Eve agent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-eve-"));
    const identity = createIdentity({
      kind: "agent",
      fullName: "Eve Agent",
      uniqueIdentifier: { scheme: "ssn", value: "123-45-6789", sensitive: true },
      documents: {
        prompt: "Act as Eve Agent.",
        capabilities: "Identity lookup and sync.",
      },
      voice: {
        provider: "elevenlabs",
        voiceId: "voice_1",
        generatedVoiceId: "generated_voice_1",
        sampleText: "secret sample text",
      },
      profileImage: {
        provider: "minimax",
        prompt: "secret image prompt",
        aspectRatio: "1:1",
      },
      assets: [
        {
          id: "asset_voice_1",
          kind: "voice",
          provider: "elevenlabs",
          path: "/tmp/private-voice.mp3",
          mediaType: "audio/mpeg",
        },
      ],
      agent: { model: "openai/gpt-5.4-mini", schedules: ["daily identity audit"] },
    });

    const result = await writeEveAgent(identity, { outDir: dir });
    expect(result.files.some((file) => file.endsWith("agent/instructions.md"))).toBe(true);
    const instructions = await readFile(join(dir, "agent", "instructions.md"), "utf8");
    const manifest = await readFile(join(dir, "agent", "identity.json"), "utf8");
    expect(instructions).toContain("Act as Eve Agent.");
    expect(manifest).toContain("open-identities:oid_");
    expect(manifest).not.toContain("Act as Eve Agent.");
    expect(manifest).not.toContain("secret sample text");
    expect(manifest).not.toContain("secret image prompt");
    expect(manifest).not.toContain("/tmp/private-voice.mp3");
  });

  test("CLI supports leading boolean flags and isolated store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-cli-"));
    const storePath = join(dir, "identities.json");
    const output = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "create", "--kind", "agent", "--name", "CLI Agent", "--identifier", "agent:cli-agent"]);
    });
    expect(JSON.parse(output).uniqueIdentifier.value).toBe("cli-agent");
    expect(await readFile(`${storePath}.audit.jsonl`, "utf8")).toContain("\"action\":\"create\"");

    const versionOutput = await captureStdout(async () => {
      await runCli(["--json", "version"]);
    });
    expect(JSON.parse(versionOutput).version).toBe("0.1.3");
  });

  test("CLI defaults to compact human output and keeps full JSON/detail paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-compact-cli-"));
    const storePath = join(dir, "identities.json");
    const longPrompt = "Long private prompt ".repeat(50);

    const createOutput = await captureStdout(async () => {
      await runCli([
        "--store",
        storePath,
        "create",
        "--kind",
        "agent",
        "--name",
        "Compact CLI Agent",
        "--identifier",
        "agent:compact-cli-agent",
        "--email",
        "compact@example.com",
        "--prompt",
        longPrompt,
      ]);
    });
    expect(createOutput).toContain("Created identity: Compact CLI Agent");
    expect(createOutput).toContain("documents");
    expect(createOutput).not.toContain(longPrompt.trim());

    const showOutput = await captureStdout(async () => {
      await runCli(["--store", storePath, "show", "agent:compact-cli-agent"]);
    });
    expect(showOutput).toContain("Use `--verbose`");
    expect(showOutput).not.toContain(longPrompt.trim());

    const docPreview = await captureStdout(async () => {
      await runCli(["--store", storePath, "doc", "get", "agent:compact-cli-agent", "prompt"]);
    });
    expect(docPreview.length).toBeLessThan(longPrompt.length);
    expect(docPreview).toContain("Use `--verbose` or `--json`");

    const verboseShow = await captureStdout(async () => {
      await runCli(["--verbose", "--store", storePath, "show", "agent:compact-cli-agent"]);
    });
    expect(JSON.parse(verboseShow).documents.prompt).toBe(longPrompt);

    const jsonShow = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "show", "agent:compact-cli-agent"]);
    });
    expect(JSON.parse(jsonShow).documents.prompt).toBe(longPrompt);
  });

  test("CLI list, status, and BrowserPlan coverage use compact human summaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-compact-list-"));
    const storePath = join(dir, "identities.json");
    const store = new IdentityStore({ filePath: storePath, auditPath: join(dir, "audit.jsonl") });
    for (let index = 0; index < 3; index += 1) {
      await store.create({
        kind: "agent",
        fullName: `Listed Agent ${index + 1}`,
        uniqueIdentifier: `agent:listed-agent-${index + 1}`,
        emails: [`listed-${index + 1}@example.com`],
        documents: { prompt: "Hidden prompt ".repeat(40) },
      });
    }

    const listOutput = await captureStdout(async () => {
      await runCli(["--store", storePath, "list", "--limit", "2"]);
    });
    expect(listOutput).toContain("Showing 2 of 3 identities");
    expect(listOutput).toContain("Use `identities show <id> --verbose`");
    expect(listOutput).not.toContain("Hidden prompt");

    const verboseList = JSON.parse(await captureStdout(async () => {
      await runCli(["--verbose", "--store", storePath, "list"]);
    }));
    expect(verboseList[0].documents.prompt).toContain("Hidden prompt");

    const statusOutput = await captureStdout(async () => {
      await runCli(["--store", storePath, "status"]);
    });
    expect(statusOutput).toContain("@hasna/identities");
    expect(statusOutput).toContain("metadata-only");
    expect(statusOutput).toContain("Use `identities status --json`");
    expect(statusOutput).not.toContain("\"refs\"");

    const jsonStatus = await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "status"]);
    });
    expect(JSON.parse(jsonStatus).refs.identities).toHaveLength(3);

    const coverageOutput = await captureStdout(async () => {
      await runCli(["--store", storePath, "browserplan", "coverage", "--target", "8"]);
    });
    expect(coverageOutput).toContain("Totals:");
    expect(coverageOutput).toContain("Use `--json` or `--verbose`");
    expect(coverageOutput).not.toContain("\"machines\"");

    const badLimit = await captureStderrAndExitCode(async () => {
      await runCli(["--store", storePath, "list", "--limit", "2abc"]);
    });
    expect(badLimit.stderr).toContain("limit must be a positive integer");
    expect(badLimit.exitCode).toBe(1);
  });

  test("CLI exposes BrowserPlan machine assignment, reservation, and coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-browserplan-cli-"));
    const storePath = join(dir, "identities.json");
    const created = JSON.parse(await captureStdout(async () => {
      await runCli([
        "--json",
        "--store",
        storePath,
        "create",
        "--kind",
        "agent",
        "--name",
        "CLI Browser Agent",
        "--identifier",
        "agent:cli-browser-agent",
        "--email",
        "cli-browser@example.com",
        "--machine",
        "machine005",
      ]);
    }));
    expect(created.machineAssignments[0]).toMatchObject({ machineId: "machine005", purpose: "browserplan" });

    await captureStdout(async () => {
      await runCli([
        "--json",
        "--store",
        storePath,
        "link-email",
        "agent:cli-browser-agent",
        "cli-browser@example.com",
        "--verified",
        "--mailery-id",
        "mailery_cli",
      ]);
    });

    const reserved = JSON.parse(await captureStdout(async () => {
      await runCli([
        "--json",
        "--store",
        storePath,
        "browserplan",
        "reserve",
        "agent:cli-browser-agent",
        "--machine",
        "machine005",
        "--slot",
        "profile-01",
      ]);
    }));
    expect(reserved.browserPlanProfiles[0]).toMatchObject({ machineId: "machine005", slot: "profile-01" });

    const listOutput = JSON.parse(await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "browserplan", "list", "--machine", "machine005", "--require", "1"]);
    }));
    expect(listOutput[0]).toMatchObject({ identityId: created.id, email: "cli-browser@example.com", emailReady: true });

    const machineList = JSON.parse(await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "machine", "list", "machine005", "--purpose", "browserplan"]);
    }));
    expect(machineList[0]).toMatchObject({ id: created.id, primaryEmail: "cli-browser@example.com", maileryId: "mailery_cli" });
    expect(machineList[0].documents).toBeUndefined();

    const verboseMachineList = JSON.parse(await captureStdout(async () => {
      await runCli(["--verbose", "--store", storePath, "machine", "list", "machine005", "--purpose", "browserplan"]);
    }));
    expect(verboseMachineList[0]).toMatchObject({ id: created.id, fullName: "CLI Browser Agent" });

    const verboseBrowserPlanList = JSON.parse(await captureStdout(async () => {
      await runCli(["--verbose", "--store", storePath, "browserplan", "list", "--machine", "machine005"]);
    }));
    expect(verboseBrowserPlanList[0]).toMatchObject({ identityId: created.id, emailReady: true });

    const coverage = JSON.parse(await captureStdout(async () => {
      await runCli(["--json", "--store", storePath, "browserplan", "coverage", "--target", "8"]);
    }));
    expect(coverage.totals.target).toBe(88);
    expect(coverage.machines.find((machine: { machineId: string }) => machine.machineId === "machine005").missing).toBe(7);
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

  test("CLI media summaries redact custom assets directories by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "open-identities-media-redacted-"));
    const storePath = join(dir, "identities.json");
    const previousAssetsDir = process.env["OPEN_IDENTITIES_ASSETS_DIR"];
    process.env["OPEN_IDENTITIES_ASSETS_DIR"] = join(dir, "private-assets-root");
    try {
      const statusOutput = await captureStdout(async () => {
        await runCli(["--store", storePath, "media", "status"]);
      });
      expect(statusOutput).toContain("<custom-assets-dir>");
      expect(statusOutput).not.toContain(dir);

      const doctorOutput = await captureStdout(async () => {
        await runCli(["--store", storePath, "media", "doctor"]);
      });
      expect(doctorOutput).toContain("<custom-assets-dir>");
      expect(doctorOutput).not.toContain(dir);

      const jsonStatus = JSON.parse(await captureStdout(async () => {
        await runCli(["--json", "--store", storePath, "media", "status"]);
      }));
      expect(jsonStatus.assetsDir).toBe(join(dir, "private-assets-root"));
    } finally {
      if (previousAssetsDir === undefined) delete process.env["OPEN_IDENTITIES_ASSETS_DIR"];
      else process.env["OPEN_IDENTITIES_ASSETS_DIR"] = previousAssetsDir;
    }
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

  test("Hasna company roster uses Greek or Roman agent names and only hasna.xyz emails", () => {
    const inputs = createHasnaCompanyAgentInputs();
    const classicalSlugs = new Set([
      "janus",
      "cassandra",
      "rhadamanthus",
      "archimedes",
      "cicero",
      "mercury",
      "marcus",
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
      expect(input.emails).toHaveLength(1);
      for (const email of input.emails ?? []) {
        const address = typeof email === "string" ? email : email.address;
        expect(address.endsWith("@hasna.xyz")).toBe(true);
        expect(address.includes("@hasna.com")).toBe(false);
      }
      expect(JSON.stringify(input)).not.toContain("hasna.com");
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
    expect(calliope.emails).toHaveLength(1);
    expect(calliope.emails.some((email) => email.address.includes("@hasna.com") || email.label === "public")).toBe(false);
    const marcus = await updatedStore.require("agent:marcus");
    expect(marcus.emails).toEqual([
      expect.objectContaining({ address: "marcus@hasna.xyz", label: "internal", primary: true, verified: true }),
    ]);
    expect(calliope.voice).toMatchObject({ provider: "elevenlabs", model: "eleven_multilingual_ttv_v2" });
    expect(calliope.profileImage).toMatchObject({ provider: "minimax", model: "image-01" });
    const calliopePrompt = await readFile(join(docsDir, "calliope", "PROMPT.md"), "utf8");
    const calliopeIdentity = await readFile(join(docsDir, "calliope", "IDENTITY.md"), "utf8");
    const marcusIdentity = await readFile(join(docsDir, "marcus", "IDENTITY.md"), "utf8");
    expect(calliopePrompt).toContain("calliope@hasna.xyz");
    expect(calliopePrompt).not.toContain("hasna.com");
    expect(calliopeIdentity).toContain("Agent email: calliope@hasna.xyz");
    expect(calliopeIdentity).not.toContain("hasna.com");
    expect(marcusIdentity).toContain("Agent email: marcus@hasna.xyz");
    expect(calliopeIdentity).toContain("Voice provider: elevenlabs");
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

async function captureStderrAndExitCode(fn: () => Promise<void>): Promise<{ stderr: string; exitCode: string | number | undefined }> {
  const original = console.error;
  const originalExitCode = process.exitCode;
  const lines: string[] = [];
  process.exitCode = undefined;
  console.error = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    await fn();
    return { stderr: lines.join("\n"), exitCode: process.exitCode };
  } finally {
    console.error = original;
    process.exitCode = originalExitCode ?? 0;
  }
}
