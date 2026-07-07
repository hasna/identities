// Cloud HTTP-backed identity store for self_hosted mode.
//
// LOCKED architecture (client -> AWS API only): when the two env vars
// HASNA_IDENTITIES_API_URL and HASNA_IDENTITIES_API_KEY are set, the CLI/SDK
// routes ALL reads and writes to https://<host>/v1 with a bearer API key.
// There is NO local file and NO database DSN on the client. Unsetting the env
// vars restores the local file store (the local original is never touched).
//
// This class extends IdentityStore and overrides every method that would
// otherwise touch the local backend, mapping each operation to the identities
// `/v1` REST surface (see src/server/serve.ts) with the SAME semantics the
// local store + server share. A throwing backend is injected so any method that
// is NOT overridden fails loudly rather than silently reading/writing local
// disk (no silent local drift).
import { randomUUID } from "node:crypto";
import {
  IdentityStore,
  type IdentityStoreOptions,
  type ListInstructionSourceOptions,
  type ReplaceAllOptions,
  type StorageBackend,
  type StorageSnapshot,
} from "./storage.js";
import {
  assignMachine as applyAssignMachine,
  reserveBrowserPlanProfile as applyReserveBrowserPlanProfile,
} from "./core.js";
import {
  listIdentityInstructionSources,
  normalizeInstructionSource,
  sortInstructionSources,
} from "./instructions.js";
import type {
  BrowserPlanProfileReservationInput,
  CreateIdentityInput,
  EmailAddress,
  Identity,
  IdentityMachineAssignmentInput,
  InstructionSource,
  InstructionSourceInput,
  PhoneNumber,
  UpdateIdentityInput,
} from "./types.js";

export interface CloudHttpConfig {
  /** Base URL, e.g. https://identities.hasna.xyz (the `/v1` prefix is appended). */
  apiUrl: string;
  /** Bearer API key (never logged). */
  apiKey: string;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
}

export class CloudHttpError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(message);
    this.name = "CloudHttpError";
  }
}

const IDENTITIES_API_URL_ENV = "HASNA_IDENTITIES_API_URL";
const IDENTITIES_API_KEY_ENV = "HASNA_IDENTITIES_API_KEY";

/**
 * Resolve the cloud HTTP config from the environment.
 * - both vars set   -> returns config (self_hosted / cloud-http)
 * - neither set     -> returns null (local file store)
 * - exactly one set -> throws (misconfigured; never silently fall back to local)
 */
export function resolveCloudHttpConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudHttpConfig | null {
  const apiUrl = env[IDENTITIES_API_URL_ENV]?.trim();
  const apiKey = env[IDENTITIES_API_KEY_ENV]?.trim();
  if (!apiUrl && !apiKey) return null;
  if (!apiUrl || !apiKey) {
    throw new Error(
      `Cloud (self_hosted) mode requires BOTH ${IDENTITIES_API_URL_ENV} and ${IDENTITIES_API_KEY_ENV}; ` +
        `only ${apiUrl ? IDENTITIES_API_URL_ENV : IDENTITIES_API_KEY_ENV} is set. ` +
        `Set both to use the cloud API, or unset both to use the local store.`,
    );
  }
  return { apiUrl, apiKey };
}

/**
 * Resolve the storage backend for the identities CLI/SDK.
 * Returns a cloud HTTP store when self_hosted env vars are present, otherwise a
 * local file store. Pass `preferLocal` (e.g. when `--store` is given) to force
 * the local file store regardless of env.
 */
export function resolveIdentityStore(
  options: IdentityStoreOptions & { preferLocal?: boolean } = {},
): IdentityStore {
  const { preferLocal, ...storeOptions } = options;
  if (!preferLocal) {
    const cloud = resolveCloudHttpConfig();
    if (cloud) return new CloudHttpIdentityStore(cloud, storeOptions);
  }
  return new IdentityStore(storeOptions);
}

/** Backend that refuses all local IO — guards against silent local drift. */
class ThrowingBackend implements StorageBackend {
  read(): Promise<StorageSnapshot> {
    throw new Error("cloud store: local backend must not be used");
  }
  write(): Promise<void> {
    throw new Error("cloud store: local backend must not be used");
  }
  appendAudit(): Promise<void> {
    return Promise.resolve();
  }
}

function upsertInstructionSource(
  sources: InstructionSource[],
  source: InstructionSource,
): InstructionSource[] {
  return sortInstructionSources([
    ...sources.filter((candidate) => candidate.id !== source.id),
    source,
  ]);
}

export class CloudHttpIdentityStore extends IdentityStore {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(config: CloudHttpConfig, options: IdentityStoreOptions = {}) {
    super({ ...options, backend: new ThrowingBackend() });
    this.base = `${config.apiUrl.replace(/\/+$/, "")}/v1`;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? 30000;
    // Surface the cloud endpoint (not a local path) for status/reporting.
    Object.defineProperty(this, "filePath", { value: this.base, writable: false });
  }

  // ── HTTP transport ─────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { idempotent?: boolean; allow404?: boolean } = {},
  ): Promise<{ status: number; data: T | null }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotent) headers["Idempotency-Key"] = randomUUID();
    try {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 404 && opts.allow404) return { status: 404, data: null };
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        const message =
          (parsed && typeof parsed === "object" && "error" in parsed
            ? String((parsed as { error: unknown }).error)
            : undefined) ?? `HTTP ${res.status} on ${method} ${path}`;
        throw new CloudHttpError(res.status, message, parsed);
      }
      return { status: res.status, data: parsed as T };
    } finally {
      clearTimeout(timer);
    }
  }

  private async patchIdentity(target: string, patch: UpdateIdentityInput): Promise<Identity> {
    const { data } = await this.request<Identity>(
      "PATCH",
      `/identities/${encodeURIComponent(target)}`,
      patch,
    );
    return data as Identity;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  override async list(): Promise<Identity[]> {
    const { data } = await this.request<{ identities: Identity[] }>("GET", "/identities");
    return data?.identities ?? [];
  }

  override async get(target: string): Promise<Identity | undefined> {
    const { status, data } = await this.request<Identity>(
      "GET",
      `/identities/${encodeURIComponent(target)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) return undefined;
    return data ?? undefined;
  }

  override async require(target: string): Promise<Identity> {
    const identity = await this.get(target);
    if (!identity) throw new Error(`Identity not found: ${target}`);
    return identity;
  }

  // list-derived reads (listByMachine, listCards, getBrowserPlanCoverage,
  // listBrowserPlanProfilesByMachine, validate) are inherited unchanged: they
  // call this.list(), which is overridden to hit the cloud API.

  // ── Instruction sources (identity-scoped only; store-level is unavailable) ──

  override async listInstructionSources(options: ListInstructionSourceOptions = {}): Promise<InstructionSource[]> {
    const identities = options.identityTarget
      ? [await this.require(options.identityTarget)]
      : await this.list();
    const sources = identities.flatMap((identity) =>
      listIdentityInstructionSources(identity, { includeDocuments: options.includeIdentityDocuments }),
    );
    return sortInstructionSources(sources);
  }

  override async listStoreInstructionSources(): Promise<InstructionSource[]> {
    // Store-level (global/team) instruction sources are not exposed by the cloud
    // API. Only identity-scoped sources round-trip over `/v1`.
    return [];
  }

  override async setInstructionSource(
    input: InstructionSourceInput | InstructionSource,
  ): Promise<InstructionSource> {
    const normalized = normalizeInstructionSource(input);
    if (normalized.owner.kind !== "identity" && normalized.owner.kind !== "persona") {
      throw new Error(
        "Store-level instruction sources are not supported in cloud (self_hosted) mode; only identity-scoped sources can be written over the cloud API.",
      );
    }
    const identity = await this.require(normalized.owner.id);
    const source = normalizeInstructionSource(
      {
        ...normalized,
        owner: {
          ...normalized.owner,
          id: identity.id,
          name: normalized.owner.name ?? identity.displayName ?? identity.fullName,
        },
      },
      { identityId: identity.id },
    );
    const nextSources = upsertInstructionSource(identity.instructionSources ?? [], source);
    await this.patchIdentity(identity.id, { instructionSources: nextSources as InstructionSourceInput[] });
    return source;
  }

  override async replaceInstructionSources(
    sources: Array<InstructionSourceInput | InstructionSource>,
    options: { identityTarget?: string } = {},
  ): Promise<InstructionSource[]> {
    if (!options.identityTarget) {
      throw new Error(
        "Replacing store-level instruction sources is not supported in cloud (self_hosted) mode; pass an identity target.",
      );
    }
    const identity = await this.require(options.identityTarget);
    const updated = await this.patchIdentity(identity.id, {
      instructionSources: sources as InstructionSourceInput[],
    });
    return updated.instructionSources ?? [];
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  override async create(input: CreateIdentityInput): Promise<Identity> {
    const { data } = await this.request<Identity>("POST", "/identities", input, { idempotent: true });
    return data as Identity;
  }

  override async update(target: string, input: UpdateIdentityInput): Promise<Identity> {
    return this.patchIdentity(target, input);
  }

  override async delete(target: string): Promise<boolean> {
    const { status, data } = await this.request<{ deleted?: boolean }>(
      "DELETE",
      `/identities/${encodeURIComponent(target)}`,
      undefined,
      { allow404: true },
    );
    if (status === 404) return false;
    return data?.deleted ?? true;
  }

  override async linkEmail(target: string, email: EmailAddress | string): Promise<Identity> {
    const body = typeof email === "string" ? { address: email } : email;
    const { data } = await this.request<Identity>(
      "POST",
      `/identities/${encodeURIComponent(target)}/emails`,
      body,
    );
    return data as Identity;
  }

  override async linkPhone(target: string, phone: PhoneNumber | string): Promise<Identity> {
    const body = typeof phone === "string" ? { number: phone } : phone;
    const { data } = await this.request<Identity>(
      "POST",
      `/identities/${encodeURIComponent(target)}/phones`,
      body,
    );
    return data as Identity;
  }

  override async assignMachine(
    target: string,
    assignment: IdentityMachineAssignmentInput,
  ): Promise<Identity> {
    const identity = await this.require(target);
    const updated = applyAssignMachine(identity, assignment);
    return this.patchIdentity(identity.id, { machineAssignments: updated.machineAssignments });
  }

  override async reserveBrowserPlanProfile(
    target: string,
    reservation: BrowserPlanProfileReservationInput,
  ): Promise<Identity> {
    const identity = await this.require(target);
    const updated = applyReserveBrowserPlanProfile(identity, reservation);
    return this.patchIdentity(identity.id, {
      machineAssignments: updated.machineAssignments,
      browserPlanProfiles: updated.browserPlanProfiles,
    });
  }

  override async replaceAll(identities: Identity[], options: ReplaceAllOptions = {}): Promise<void> {
    if (options.instructionSources && options.instructionSources.length > 0) {
      throw new Error(
        "Replacing store-level instruction sources is not supported in cloud (self_hosted) mode.",
      );
    }
    const current = await this.list();
    const desiredIds = new Set(identities.map((identity) => identity.id));
    for (const existing of current) {
      if (!desiredIds.has(existing.id)) await this.delete(existing.id);
    }
    const currentIds = new Set(current.map((identity) => identity.id));
    for (const identity of identities) {
      if (currentIds.has(identity.id)) await this.delete(identity.id);
      await this.create(identity as CreateIdentityInput);
    }
  }
}
