import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Identity, IdentityDocumentKey } from "./types.js";
import { identityDocumentKeys } from "./types.js";
import { identityToAgentManifest, renderIdentityInstructions } from "./core.js";

export interface EveExportOptions {
  outDir: string;
  model?: string;
}

export interface EveExportResult {
  outDir: string;
  files: string[];
}

const SKILL_DOCUMENTS: IdentityDocumentKey[] = [
  "bio",
  "personality",
  "ethos",
  "capabilities",
  "boundaries",
  "tools",
  "goals",
  "context",
  "consent",
];

export async function writeEveAgent(identity: Identity, options: EveExportOptions): Promise<EveExportResult> {
  const agentDir = join(options.outDir, "agent");
  const skillsDir = join(agentDir, "skills");
  const toolsDir = join(agentDir, "tools");
  const schedulesDir = join(agentDir, "schedules");
  const files: string[] = [];

  await mkdir(skillsDir, { recursive: true });
  await mkdir(toolsDir, { recursive: true });
  await mkdir(schedulesDir, { recursive: true });

  await write(agentDir, "instructions.md", renderIdentityInstructions(identity), files);
  await write(agentDir, "agent.ts", renderAgentTs(options.model ?? identity.agent?.model), files);
  await write(agentDir, "identity.json", `${JSON.stringify(identityToAgentManifest(identity), null, 2)}\n`, files);
  await write(toolsDir, "resolve_identity.ts", renderResolveIdentityTool(identity.id), files);

  for (const key of SKILL_DOCUMENTS) {
    const value = identity.documents[key]?.trim();
    if (!value) continue;
    await write(skillsDir, `${key}.md`, renderSkillDocument(key, value), files);
  }

  if ((identity.agent?.schedules ?? []).length > 0) {
    await write(schedulesDir, "identity_audit.md", renderIdentityAuditSchedule(identity.agent?.schedules ?? []), files);
  }

  return { outDir: options.outDir, files };
}

function renderAgentTs(model: string | undefined): string {
  return `import { defineAgent } from "eve";

export default defineAgent({
  model: ${JSON.stringify(model ?? "openai/gpt-5.4-mini")},
});
`;
}

function renderResolveIdentityTool(identityId: string): string {
  return `import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Return this agent's open-identities identity reference.",
  inputSchema: z.object({}),
  async execute() {
    return {
      identityId: ${JSON.stringify(identityId)},
      source: "open-identities",
    };
  },
});
`;
}

function renderSkillDocument(key: IdentityDocumentKey, value: string): string {
  return `---
description: Identity ${key} context from open-identities
---

${value}
`;
}

function renderIdentityAuditSchedule(schedules: string[]): string {
  return `---
cron: "0 8 * * *"
---

Review the current identity registration, contact-point sync state, and integration references.

Configured schedule hints:
${schedules.map((item) => `- ${item}`).join("\n")}
`;
}

async function write(dir: string, name: string, content: string, files: string[]): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, content, "utf8");
  files.push(path);
}

export function listEveDocumentKeys(): IdentityDocumentKey[] {
  return identityDocumentKeys.filter((key) => key !== "memory" && key !== "voice");
}

