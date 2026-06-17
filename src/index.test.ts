import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createIdentity, IdentityStore, syncIdentityContactPoints, syncIdentityContactPointsAndUpdate, writeEveAgent } from "./index.js";
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
    expect(JSON.parse(versionOutput).version).toBe("0.1.0");
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
