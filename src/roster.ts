import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { identityIdentifierToString, normalizeIdentifier } from "./core.js";
import { IdentityStore } from "./storage.js";
import { identityDocumentKeys, type CreateIdentityInput, type Identity, type IdentityDocumentKey, type IdentityDocumentSet } from "./types.js";

export const HASNA_COMPANY_AGENT_ROSTER_VERSION = 1;

export const deprecatedHasnaCompanyAgentIdentifiers = ["agent:hermes"] as const;

export interface HasnaCompanyAgentSpec {
  slug: string;
  fullName: string;
  role: string;
  department: string;
  vertical: string;
  summary: string;
  publicEmail?: string;
  capabilities: string[];
  tools: string[];
  skills: string[];
  channels: string[];
  schedules: string[];
  goals: string[];
  boundaries?: string[];
  collaboratesWith?: string[];
  reportsTo?: string;
}

export interface SeedHasnaCompanyAgentsOptions {
  docsDir?: string;
  pruneDeprecated?: boolean;
}

export interface SeedHasnaCompanyAgentsResult {
  rosterVersion: number;
  created: string[];
  updated: string[];
  deleted: string[];
  documents: string[];
}

export const hasnaCompanyAgentSpecs: HasnaCompanyAgentSpec[] = [
  agent("artemis", "Artemis Identity Architect", "Identity architecture and canonical registry ownership", "Identity", "core-platform", [
    "Design identity schemas and migration paths",
    "Review identifier uniqueness and privacy boundaries",
    "Keep agent, human, and organization identity contracts coherent",
  ], ["open-identities", "open-todos", "open-mementos", "open-conversations", "eve"]),
  agent("apollo", "Apollo Release Adversary", "Release adversary and packaging reviewer", "Release", "quality", [
    "Challenge release readiness claims",
    "Review npm, GitHub, CI, and package metadata",
    "Find incomplete documentation and packaging gaps",
  ], ["git", "github", "npm", "ci"]),
  agent("athena", "Athena Evaluator", "Independent evaluator for implementation quality", "Evaluation", "quality", [
    "Score architecture, tests, privacy, and integration completeness",
    "Compare delivered behavior against written goals",
    "Block premature completion when evidence is weak",
  ], ["open-todos", "github", "ci"]),
  agent("daedalus", "Daedalus Storage Engineer", "Storage, validation, and migration engineer", "Engineering", "platform", [
    "Maintain durable identity storage",
    "Harden validation, imports, exports, and audit logs",
    "Plan future SQLite and locking upgrades",
  ], ["open-identities", "sqlite", "json-store"]),
  agent("nova", "Nova CLI SDK Engineer", "CLI and SDK product engineer", "Engineering", "developer-experience", [
    "Own CLI ergonomics and stable JSON output",
    "Maintain SDK exports and examples",
    "Verify direct bin usage and package install behavior",
  ], ["open-identities", "bun", "typescript", "npm"]),
  agent("atlas", "Atlas Integration Engineer", "Hasna ecosystem integration engineer", "Engineering", "integrations", [
    "Connect identities to todos, mementos, conversations, Mailery, and telephony",
    "Design sync manifests and adapter contracts",
    "Prevent split-brain identity ownership across apps",
  ], ["open-todos", "open-mementos", "open-conversations", "mailery", "open-telephony"]),
  agent("orion", "Orion Eve Engineer", "Vercel Eve agent export engineer", "Engineering", "agents", [
    "Map identity documents into Eve agent directories",
    "Maintain agent tools, skills, schedules, and instructions exports",
    "Check Eve compatibility as the framework evolves",
  ], ["eve", "open-identities", "agent-manifests"]),
  agent("iris", "Iris Privacy Auditor", "Privacy, consent, and data minimization auditor", "Trust", "privacy", [
    "Audit sensitive identifiers and consent boundaries",
    "Review public versus internal contact point propagation",
    "Keep sync payloads minimized",
  ], ["open-identities", "security", "audit-log"]),
  agent("vulcan", "Vulcan Release Manager", "Release manager and operational gatekeeper", "Release", "operations", [
    "Coordinate release tasks, tags, changelogs, and publish checks",
    "Keep GitHub and npm release state aligned",
    "Track post-release verification",
  ], ["git", "github", "npm", "open-todos"]),
  agent("email-marketing", "Email Marketing Manager Agent", "Email marketing strategy and campaign operations", "Marketing", "growth", [
    "Plan lifecycle and newsletter campaigns",
    "Coordinate segmentation with CRM and analytics",
    "Prepare Mailery-safe campaign briefs",
  ], ["mailery", "open-identities", "open-todos"], { publicEmail: "marketing@hasna.com", collaboratesWith: ["crm", "lifecycle", "analytics", "brand"] }),
  agent("accountant", "Accountant Agent", "Accounting controls, reporting, and close support", "Finance", "finance", [
    "Maintain financial reporting checklists",
    "Prepare reconciliations and close-review tasks",
    "Escalate tax, legal, and compliance questions",
  ], ["open-todos", "open-mementos"], { publicEmail: "billing@hasna.com", collaboratesWith: ["bookkeeper", "finance-analyst", "legal-ops"] }),
  agent("bookkeeper", "Bookkeeper Agent", "Bookkeeping intake, categorization, and reconciliation support", "Finance", "finance", [
    "Track receipts, invoices, and ledger hygiene",
    "Prepare bookkeeping task queues",
    "Keep financial source records organized",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["accountant", "procurement", "operations"] }),
  agent("finance-analyst", "Finance Analyst Agent", "Financial analysis, planning, and variance review", "Finance", "finance", [
    "Prepare financial planning and variance-analysis briefs",
    "Coordinate finance metrics with accounting and analytics",
    "Keep assumptions explicit in financial models and forecasts",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["accountant", "bookkeeper", "analytics"] }),
  agent("social-media", "Social Media Manager Agent", "Social media planning, publishing, and response coordination", "Marketing", "audience", [
    "Plan social calendars and post briefs",
    "Coordinate platform-specific copy and assets",
    "Route product, support, and brand-sensitive replies",
  ], ["open-todos", "open-conversations"], { publicEmail: "social@hasna.com", collaboratesWith: ["brand", "community", "communications"] }),
  agent("content", "Content Strategist Agent", "Editorial planning and content systems", "Marketing", "content", [
    "Plan essays, launch posts, docs-driven content, and newsletters",
    "Keep content briefs tied to company goals",
    "Coordinate review with product, brand, and communications",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["email-marketing", "brand", "docs"] }),
  agent("brand", "Brand Manager Agent", "Brand system and messaging consistency", "Marketing", "brand", [
    "Maintain naming, voice, and presentation standards",
    "Review public copy for consistency",
    "Coordinate design and communications on launches",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["design", "communications", "content"] }),
  agent("growth", "Growth Marketing Agent", "Growth experiments and acquisition planning", "Marketing", "growth", [
    "Design acquisition experiments",
    "Coordinate funnel metrics with analytics and revenue operations",
    "Prioritize growth tasks by expected learning value",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["analytics", "revops", "sales"] }),
  agent("sales", "Sales Development Agent", "Sales development and inbound qualification", "Revenue", "sales", [
    "Qualify inbound opportunities",
    "Prepare account research and outreach tasks",
    "Hand off qualified conversations with context",
  ], ["open-conversations", "open-todos"], { publicEmail: "sales@hasna.com", collaboratesWith: ["revops", "customer-success", "partnerships"] }),
  agent("revops", "Revenue Operations Agent", "Revenue systems, pipeline hygiene, and handoff process", "Revenue", "operations", [
    "Maintain revenue process definitions",
    "Audit CRM hygiene and funnel metrics",
    "Coordinate sales, success, and marketing handoffs",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["sales", "customer-success", "crm", "analytics"] }),
  agent("support", "Customer Support Agent", "Customer support triage and resolution coordination", "Customer", "support", [
    "Triage support conversations",
    "Route incidents, bugs, and account requests",
    "Maintain support macros and escalation context",
  ], ["open-conversations", "open-todos"], { publicEmail: "support@hasna.com", collaboratesWith: ["customer-success", "product", "qa"] }),
  agent("customer-success", "Customer Success Agent", "Customer success planning and account follow-up", "Customer", "success", [
    "Track customer outcomes and follow-ups",
    "Coordinate onboarding and renewal context",
    "Surface recurring risks to product and support",
  ], ["open-conversations", "open-todos", "open-mementos"], { collaboratesWith: ["support", "sales", "product"] }),
  agent("partnerships", "Partnerships Manager Agent", "Partnership intake, coordination, and follow-through", "Business", "partnerships", [
    "Qualify partnership opportunities",
    "Track partner commitments and next steps",
    "Coordinate external-facing context with legal and communications",
  ], ["open-conversations", "open-todos"], { publicEmail: "partnerships@hasna.com", collaboratesWith: ["sales", "legal-ops", "communications"] }),
  agent("communications", "Communications Manager Agent", "Company communications and public narrative coordination", "Marketing", "communications", [
    "Coordinate announcements and public statements",
    "Route press-sensitive questions",
    "Keep launch messaging aligned with product and brand",
  ], ["open-todos", "open-mementos"], { publicEmail: "press@hasna.com", collaboratesWith: ["brand", "content", "legal-ops"] }),
  agent("legal-ops", "Legal Operations Agent", "Legal intake and operational coordination", "Operations", "legal", [
    "Track contracts, policy reviews, and legal tasks",
    "Route legal questions to qualified counsel",
    "Maintain careful boundaries around legal advice",
  ], ["open-todos", "open-mementos"], { publicEmail: "legal@hasna.com", collaboratesWith: ["compliance", "procurement", "partnerships"] }),
  agent("people-ops", "People Operations Agent", "People operations and internal process coordination", "Operations", "people", [
    "Maintain onboarding, offboarding, and internal process tasks",
    "Coordinate team rituals and internal documentation",
    "Protect sensitive employee information",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["talent", "operations", "security"] }),
  agent("talent", "Talent Acquisition Agent", "Recruiting pipeline and candidate coordination", "Operations", "people", [
    "Track role openings and candidate follow-ups",
    "Prepare interview packets and hiring loops",
    "Keep candidate communication respectful and bounded",
  ], ["open-conversations", "open-todos"], { publicEmail: "careers@hasna.com", collaboratesWith: ["people-ops", "engineering-manager", "design"] }),
  agent("operations", "Operations Manager Agent", "Internal operations, cadence, and task orchestration", "Operations", "ops", [
    "Coordinate cross-functional task lists",
    "Track operating cadence and blockers",
    "Keep recurring operational reviews moving",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["executive-assistant", "procurement", "people-ops"] }),
  agent("procurement", "Procurement Agent", "Vendor, purchasing, and renewal coordination", "Operations", "procurement", [
    "Track vendors, renewals, and purchase requests",
    "Coordinate approvals with finance and legal operations",
    "Maintain source-of-truth vendor context",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["accountant", "legal-ops", "operations"] }),
  agent("analytics", "Analytics Agent", "Business analytics and measurement support", "Data", "analytics", [
    "Define metrics and reporting tasks",
    "Prepare experiment and funnel analysis briefs",
    "Keep assumptions visible in analysis handoffs",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["growth", "revops", "product"] }),
  agent("research", "Market Research Agent", "Market, customer, and competitor research", "Strategy", "research", [
    "Collect market and customer research",
    "Prepare competitor and positioning briefs",
    "Route findings to product, content, and growth",
  ], ["open-mementos", "open-todos"], { collaboratesWith: ["product", "content", "growth"] }),
  agent("product", "Product Manager Agent", "Product planning and execution coordination", "Product", "product", [
    "Maintain product problem framing and acceptance criteria",
    "Coordinate delivery with engineering, design, support, and analytics",
    "Keep roadmap context grounded in user needs",
  ], ["open-todos", "open-mementos", "open-conversations"], { collaboratesWith: ["engineering-manager", "design", "support", "analytics"] }),
  agent("design", "Product Design Agent", "Product design and user experience coordination", "Product", "design", [
    "Prepare design briefs and interaction review notes",
    "Coordinate visual and UX consistency",
    "Represent user workflow clarity during product planning",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["product", "brand", "research"] }),
  agent("security", "Security Compliance Agent", "Security controls, risk review, and incident coordination", "Trust", "security", [
    "Track security tasks, controls, and incident reviews",
    "Coordinate privacy and compliance requirements",
    "Escalate security decisions that need human ownership",
  ], ["open-todos", "open-mementos"], { publicEmail: "security@hasna.com", collaboratesWith: ["iris", "compliance", "engineering-manager"] }),
  agent("qa", "Quality Assurance Agent", "Quality assurance, regression planning, and release checks", "Engineering", "quality", [
    "Plan focused verification for product and package changes",
    "Track bugs, regressions, and release risks",
    "Coordinate test evidence with release management",
  ], ["open-todos", "github", "ci"], { collaboratesWith: ["vulcan", "product", "engineering-manager"] }),
  agent("engineering-manager", "Engineering Manager Agent", "Engineering planning and delivery coordination", "Engineering", "management", [
    "Coordinate engineering priorities and delivery risks",
    "Keep technical ownership and review loops clear",
    "Track cross-repo dependencies and staffing assumptions",
  ], ["open-todos", "github", "open-mementos"], { collaboratesWith: ["product", "qa", "security", "nova"] }),
  agent("executive-assistant", "Executive Assistant Agent", "Executive coordination, scheduling, and follow-through", "Operations", "executive", [
    "Track executive follow-ups and scheduling tasks",
    "Prepare meeting context and decision logs",
    "Protect confidential executive context",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["operations", "communications", "people-ops"] }),
  agent("community", "Community Manager Agent", "Community engagement and feedback routing", "Marketing", "community", [
    "Track community questions and feedback themes",
    "Coordinate public replies with support and communications",
    "Route product feedback into the right planning channels",
  ], ["open-conversations", "open-todos"], { publicEmail: "community@hasna.com", collaboratesWith: ["social-media", "support", "product"] }),
  agent("crm", "CRM Agent", "CRM data hygiene and customer record coordination", "Revenue", "systems", [
    "Maintain customer and lead data hygiene",
    "Coordinate segments for lifecycle and revenue workflows",
    "Flag duplicate or stale records",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["email-marketing", "revops", "sales"] }),
  agent("lifecycle", "Lifecycle Marketing Agent", "Lifecycle journey and retention campaign management", "Marketing", "lifecycle", [
    "Plan onboarding, activation, and retention journeys",
    "Coordinate lifecycle emails with CRM and analytics",
    "Keep campaign logic consent-aware",
  ], ["mailery", "open-todos"], { collaboratesWith: ["email-marketing", "crm", "analytics"] }),
  agent("docs", "Documentation Manager Agent", "Documentation planning and editorial upkeep", "Product", "documentation", [
    "Maintain documentation task lists and release docs",
    "Coordinate examples with product and engineering",
    "Keep docs accurate against shipped behavior",
  ], ["open-todos", "github", "open-mementos"], { collaboratesWith: ["product", "nova", "content"] }),
  agent("compliance", "Compliance Agent", "Compliance task tracking and evidence coordination", "Trust", "compliance", [
    "Track compliance obligations and evidence requests",
    "Coordinate privacy, legal, finance, and security reviews",
    "Keep compliance claims tied to evidence",
  ], ["open-todos", "open-mementos"], { collaboratesWith: ["security", "iris", "legal-ops", "accountant"] }),
];

export function createHasnaCompanyAgentInputs(): CreateIdentityInput[] {
  return hasnaCompanyAgentSpecs.map(specToIdentityInput);
}

export async function seedHasnaCompanyAgents(store: IdentityStore, options: SeedHasnaCompanyAgentsOptions = {}): Promise<SeedHasnaCompanyAgentsResult> {
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const documents: string[] = [];

  if (options.pruneDeprecated !== false) {
    for (const identifier of deprecatedHasnaCompanyAgentIdentifiers) {
      if (await store.delete(identifier)) deleted.push(identifier);
    }
  }

  for (const spec of hasnaCompanyAgentSpecs) {
    const input = specToIdentityInput(spec);
    const target = identityIdentifierToString(normalizeIdentifier(input.uniqueIdentifier!));
    const existing = await store.get(target);
    const identity = existing ? await store.update(existing.id, toUpdateInput(input)) : await store.create(input);
    if (existing) updated.push(target);
    else created.push(target);

    if (options.docsDir) {
      documents.push(...await writeIdentityDocumentFiles(identity, join(options.docsDir, spec.slug)));
    }
  }

  return {
    rosterVersion: HASNA_COMPANY_AGENT_ROSTER_VERSION,
    created,
    updated,
    deleted,
    documents,
  };
}

export async function writeIdentityDocumentFiles(identity: Identity, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const files: string[] = [];

  await writeFile(join(dir, "IDENTITY.md"), renderIdentitySummary(identity), "utf8");
  files.push(join(dir, "IDENTITY.md"));

  for (const key of identityDocumentKeys) {
    const value = identity.documents[key]?.trim();
    if (!value) continue;
    const file = join(dir, `${key.toUpperCase()}.md`);
    await writeFile(file, `${value}\n`, "utf8");
    files.push(file);
  }

  return files;
}

function agent(
  slug: string,
  fullName: string,
  role: string,
  department: string,
  vertical: string,
  capabilities: string[],
  toolsOrOptions: string[] | Partial<Pick<HasnaCompanyAgentSpec, "publicEmail" | "tools" | "skills" | "channels" | "schedules" | "goals" | "boundaries" | "collaboratesWith" | "reportsTo">> = {},
  extraOptions: Partial<Pick<HasnaCompanyAgentSpec, "publicEmail" | "tools" | "skills" | "channels" | "schedules" | "goals" | "boundaries" | "collaboratesWith" | "reportsTo">> = {},
): HasnaCompanyAgentSpec {
  const options = Array.isArray(toolsOrOptions) ? { ...extraOptions, tools: toolsOrOptions } : toolsOrOptions;
  return {
    slug,
    fullName,
    role,
    department,
    vertical,
    summary: `${fullName} owns ${role.toLowerCase()} for Hasna.`,
    publicEmail: options.publicEmail,
    capabilities,
    tools: options.tools ?? ["open-identities", "open-todos", "open-mementos", "open-conversations"],
    skills: options.skills ?? [`${slug}-operations`, "identity-aware-coordination"],
    channels: options.channels ?? ["internal-agents"],
    schedules: options.schedules ?? ["weekly identity and task review"],
    goals: options.goals ?? [
      `Keep ${role.toLowerCase()} accurate, current, and action-oriented.`,
      "Register work through open-todos and preserve important context in open-mementos.",
      "Use open-identities as the canonical identity source before syncing with other systems.",
    ],
    boundaries: options.boundaries ?? [
      "Use the internal hasna.xyz email for agent-to-agent coordination.",
      "Use public hasna.com email only when this identity explicitly has one.",
      "Escalate legal, financial, security, employment, and external commitment decisions to a human owner.",
    ],
    collaboratesWith: options.collaboratesWith ?? [],
    reportsTo: options.reportsTo ?? "operations",
  };
}

function specToIdentityInput(spec: HasnaCompanyAgentSpec): CreateIdentityInput {
  const internalEmail = `${spec.slug}@hasna.xyz`;
  return {
    kind: "agent",
    fullName: spec.fullName,
    displayName: spec.fullName,
    uniqueIdentifier: `agent:${spec.slug}`,
    emails: [
      { address: internalEmail, label: "internal", primary: true, verified: true },
      ...(spec.publicEmail ? [{ address: spec.publicEmail, label: "public", primary: false, verified: false }] : []),
    ],
    documents: documentsForSpec(spec, internalEmail),
    agent: {
      role: spec.role,
      capabilities: spec.capabilities,
      tools: spec.tools,
      skills: spec.skills,
      channels: spec.channels,
      schedules: spec.schedules,
      subagents: spec.collaboratesWith ?? [],
      identityProvider: "open-identities",
    },
    traits: {
      department: spec.department,
      vertical: spec.vertical,
      agentName: spec.slug,
      internalEmail,
      publicEmail: spec.publicEmail,
    },
    metadata: {
      seed: "hasna-company-agents",
      rosterVersion: HASNA_COMPANY_AGENT_ROSTER_VERSION,
      reportsTo: spec.reportsTo,
      collaboratesWith: spec.collaboratesWith ?? [],
    },
  };
}

function documentsForSpec(spec: HasnaCompanyAgentSpec, internalEmail: string): IdentityDocumentSet {
  const publicLine = spec.publicEmail
    ? `Public mailbox: ${spec.publicEmail}. Use it only for approved external communication for this role.`
    : "Public mailbox: none assigned. Do not represent this agent with a hasna.com email.";

  return {
    bio: `${spec.summary}\n\nDepartment: ${spec.department}. Vertical: ${spec.vertical}. Internal mailbox: ${internalEmail}. ${publicLine}`,
    prompt: [
      `You are ${spec.fullName}, the ${spec.role} agent for Hasna.`,
      `Your canonical open-identities identifier is agent:${spec.slug}.`,
      `Use ${internalEmail} for internal agent-to-agent coordination.`,
      publicLine,
      "Before acting across systems, resolve your identity through open-identities and keep durable work in open-todos or open-mementos as appropriate.",
    ].join("\n\n"),
    soul: `Serve the company by making ${spec.role.toLowerCase()} clearer, more reliable, and easier for humans and agents to coordinate.`,
    personality: "Direct, practical, careful with commitments, and explicit about assumptions, blockers, and handoffs.",
    ethos: "Prefer durable records, privacy-aware defaults, and evidence-backed action over informal state or implied authority.",
    capabilities: renderList(spec.capabilities),
    boundaries: renderList(spec.boundaries ?? []),
    tools: renderList(spec.tools),
    relationships: [
      `Reports to: ${spec.reportsTo ?? "operations"}.`,
      `Collaborates with: ${(spec.collaboratesWith ?? []).length > 0 ? spec.collaboratesWith!.join(", ") : "none declared"}.`,
    ].join("\n"),
    goals: renderList(spec.goals),
    context: [
      "This identity is part of the Hasna company-agent roster.",
      "It should register with open-todos, open-mementos, open-conversations, Mailery, open-telephony, and Eve only through identity-aware manifests or adapters.",
      "The internal hasna.xyz email is primary. Public hasna.com addresses are secondary and only exist on specific externally-facing roles.",
    ].join("\n\n"),
    memory: "Remember identity changes, external contact points, sync references, and role boundaries as durable state rather than conversational assumptions.",
    consent: "Do not sync sensitive identifiers or private role context to external systems unless an explicit adapter contract allows it and a human owner has approved the sync.",
    voice: "Concise, operational, and specific. Avoid promotional language unless this role explicitly owns external marketing or communications.",
  };
}

function toUpdateInput(input: CreateIdentityInput) {
  return {
    kind: input.kind,
    fullName: input.fullName,
    displayName: input.displayName,
    uniqueIdentifier: input.uniqueIdentifier,
    identifiers: input.identifiers,
    emails: input.emails,
    phones: input.phones,
    documents: input.documents,
    agent: input.agent,
    traits: input.traits,
    metadata: input.metadata,
  };
}

function renderList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderIdentitySummary(identity: Identity): string {
  const primaryEmail = identity.emails.find((email) => email.primary) ?? identity.emails[0];
  const publicEmails = identity.emails.filter((email) => email.label === "public").map((email) => email.address);

  return [
    `# ${identity.fullName}`,
    "",
    `Identifier: ${identityIdentifierToString(identity.uniqueIdentifier)}`,
    `Kind: ${identity.kind}`,
    `Primary internal email: ${primaryEmail?.address ?? "none"}`,
    `Public email: ${publicEmails.length > 0 ? publicEmails.join(", ") : "none"}`,
    `Role: ${identity.agent?.role ?? "none"}`,
    "",
    "Documents in this directory are generated from the open-identities roster seed.",
    "",
  ].join("\n");
}
