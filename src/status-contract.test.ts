import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { IdentityStore } from "./storage.js";
import { getIdentityReferenceStatus } from "./status.js";

const rootDir = join(import.meta.dir, "..");

describe("identity reference status contract", () => {
  test("reports metadata only without contact values, credentials, private keys, document bodies, or raw identifiers", async () => {
    const privatePathRoot = join(tmpdir(), "private-account-123-apple03");
    await mkdir(privatePathRoot, { recursive: true });
    const dir = await mkdtemp(join(privatePathRoot, "open-identities-status-"));
    const storePath = join(dir, "identities.json");
    const auditPath = join(dir, "audit.jsonl");
    const store = new IdentityStore({ filePath: storePath, auditPath });

    await store.create({
      kind: "agent",
      fullName: "Private Status Agent",
      uniqueIdentifier: { scheme: "ssn", value: "123-45-6789", sensitive: true },
      emails: ["private-status@example.com"],
      phones: ["+15555550123"],
      documents: {
        prompt: "private prompt body should not appear",
        ethos: "private ethos body should not appear",
      },
      agent: {
        role: "Private GitHub App Operator",
        tools: ["github"],
        skills: ["private-key-rotation"],
      },
      metadata: {
        githubAppId: "app-private-123",
        githubAppPrivateKey: "-----BEGIN PRIVATE KEY----- raw private key -----END PRIVATE KEY-----",
        credential: "ghp_raw_private_token",
      },
    });

    try {
      const status = await getIdentityReferenceStatus(store);
      expect(status).toMatchObject({
        service: "identities",
        schemaVersion: "1.0",
        package: {
          name: "@hasna/identities",
          version: expect.any(String),
        },
        counts: {
          identities: 1,
          emails: 1,
          phones: 1,
          agentProfiles: 1,
          agentRoles: 1,
          populatedDocuments: 2,
        },
        safety: {
          includesNames: false,
          includesContactValues: false,
          includesCredentialValues: false,
          includesDocumentBodies: false,
          includesSensitiveIdentifiers: false,
          includesPrivateKeys: false,
          includesGitHubAppPrivateData: false,
          statusOutputIsMetadataOnly: true,
        },
      });
      expect(status.refs.identities[0].refId).toStartWith("identity_");

      const serialized = JSON.stringify(status);
      expect(serialized).not.toContain("Private Status Agent");
      expect(serialized).not.toContain("private-status@example.com");
      expect(serialized).not.toContain("+15555550123");
      expect(serialized).not.toContain("123-45-6789");
      expect(serialized).not.toContain("private prompt body should not appear");
      expect(serialized).not.toContain("Private GitHub App Operator");
      expect(serialized).not.toContain("app-private-123");
      expect(serialized).not.toContain("raw private key");
      expect(serialized).not.toContain("ghp_raw_private_token");
      expect(serialized).not.toContain(privatePathRoot);
      expect(serialized).not.toContain("apple03");

      const cli = Bun.spawnSync({
        cmd: ["bun", "src/cli.ts", "--store", storePath, "--json", "status"],
        cwd: rootDir,
        env: { ...process.env, OPEN_IDENTITIES_AUDIT: auditPath },
      });
      expect(cli.exitCode).toBe(0);
      const output = new TextDecoder().decode(cli.stdout);
      expect(JSON.parse(output).counts.identities).toBe(1);
      expect(output).not.toContain("private-status@example.com");
      expect(output).not.toContain("+15555550123");
      expect(output).not.toContain("123-45-6789");
      expect(output).not.toContain("private prompt body should not appear");
      expect(output).not.toContain("Private GitHub App Operator");
      expect(output).not.toContain("raw private key");
      expect(output).not.toContain(privatePathRoot);
      expect(output).not.toContain("apple03");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
