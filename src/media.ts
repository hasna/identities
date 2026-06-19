import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createIdentity, identityIdentifierToString, publicIdentityIdentifier } from "./core.js";
import { getIdentityDataDir, type IdentityStore } from "./storage.js";
import type { Identity, IdentityAsset, ProfileImage, VoiceProfile } from "./types.js";

export type VoiceGenerationMode = "design" | "text-to-speech";

export interface ProviderSecretStatus {
  available: boolean;
  source?: string;
  checkedEnv: string[];
  checkedSecrets: string[];
}

export interface IdentityMediaSecretStatus {
  elevenlabs: ProviderSecretStatus;
  minimax: ProviderSecretStatus;
}

export interface ElevenLabsVoiceDesignResult {
  audio: Uint8Array;
  mediaType: string;
  generatedVoiceId?: string;
  previewText?: string;
  metadata?: Record<string, unknown>;
}

export interface ElevenLabsTextToSpeechResult {
  audio: Uint8Array;
  mediaType: string;
  metadata?: Record<string, unknown>;
}

export interface ElevenLabsCreatedVoice {
  voiceId: string;
  metadata?: Record<string, unknown>;
}

export interface ElevenLabsVoiceAdapter {
  designVoice(input: {
    description: string;
    text: string;
    model?: string;
    outputFormat?: string;
  }): Promise<ElevenLabsVoiceDesignResult>;
  textToSpeech(input: {
    voiceId: string;
    text: string;
    model?: string;
    outputFormat?: string;
  }): Promise<ElevenLabsTextToSpeechResult>;
  createVoice?(input: {
    name: string;
    description: string;
    generatedVoiceId: string;
  }): Promise<ElevenLabsCreatedVoice>;
}

export interface MiniMaxProfileImageResult {
  image: Uint8Array;
  mediaType: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface MiniMaxImageAdapter {
  generateProfileImage(input: {
    prompt: string;
    model?: string;
    aspectRatio?: string;
  }): Promise<MiniMaxProfileImageResult>;
}

export interface IdentityMediaAdapters {
  elevenlabs: ElevenLabsVoiceAdapter;
  minimax: MiniMaxImageAdapter;
}

export interface GenerateIdentityVoiceOptions {
  adapter?: ElevenLabsVoiceAdapter;
  mode?: VoiceGenerationMode;
  voiceId?: string;
  voiceDescription?: string;
  text?: string;
  model?: string;
  outputFormat?: string;
  outDir?: string;
  dryRun?: boolean;
  createVoice?: boolean;
}

export interface GenerateIdentityProfileImageOptions {
  adapter?: MiniMaxImageAdapter;
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  outDir?: string;
  dryRun?: boolean;
}

export interface GenerateHasnaRosterMediaOptions {
  voices?: boolean;
  profileImages?: boolean;
  dryRun?: boolean;
  outDir?: string;
  limit?: number;
  voice?: Omit<GenerateIdentityVoiceOptions, "outDir" | "dryRun">;
  profileImage?: Omit<GenerateIdentityProfileImageOptions, "outDir" | "dryRun">;
}

export interface GeneratedIdentityMediaResult {
  identityId: string;
  identifier: string;
  fullName: string;
  kind: IdentityAsset["kind"];
  provider: string;
  dryRun: boolean;
  asset: IdentityAsset;
  voice?: VoiceProfile;
  profileImage?: ProfileImage;
}

export interface GenerateHasnaRosterMediaResult {
  planned: number;
  generated: GeneratedIdentityMediaResult[];
  skipped: Array<{ target: string; reason: string }>;
  failed: Array<{ target: string; kind: IdentityAsset["kind"]; error: string }>;
  secrets: IdentityMediaSecretStatus;
}

const ELEVENLABS_ENV_NAMES = [
  "ELEVENLABS_API_KEY",
  "XI_API_KEY",
  "HASNAXYZ_ELEVENLABS_LIVE_API_KEY",
];

const ELEVENLABS_SECRET_KEYS = [
  "elevenlabs/api_key",
  "elevenlabs/live/api_key",
  "hasnaxyz/elevenlabs/live/api_key",
];

const MINIMAX_ENV_NAMES = [
  "MINIMAX_API_KEY",
  "HASNAXYZ_MINIMAX_LIVE_API_KEY",
  "HASNA_TAKUMI_LIVE_MINIMAX_API_KEY",
];

const MINIMAX_SECRET_KEYS = [
  "minimax/api_key",
  "minimax/live/api_key",
  "hasna/takumi/live/minimax_api_key",
];

const DEFAULT_ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_MINIMAX_BASE_URL = "https://api.minimax.io/v1";

export function getIdentityMediaAssetsDir(): string {
  return process.env["OPEN_IDENTITIES_ASSETS_DIR"] || join(getIdentityDataDir(), "assets");
}

export function detectIdentityMediaSecrets(): IdentityMediaSecretStatus {
  return {
    elevenlabs: detectProviderSecret(ELEVENLABS_ENV_NAMES, ELEVENLABS_SECRET_KEYS),
    minimax: detectProviderSecret(MINIMAX_ENV_NAMES, MINIMAX_SECRET_KEYS),
  };
}

export async function generateIdentityVoice(
  store: IdentityStore,
  target: string,
  options: GenerateIdentityVoiceOptions = {},
): Promise<GeneratedIdentityMediaResult> {
  const identity = await store.require(target);
  const mode = options.mode ?? (options.voiceId ? "text-to-speech" : "design");
  const provider = "elevenlabs";
  const text = normalizeSampleText(options.text ?? buildVoiceSampleText(identity));
  const description = normalizeVoiceDescription(options.voiceDescription ?? buildVoiceDescription(identity));
  const outputFormat = options.outputFormat ?? "mp3_44100_128";
  const model = options.model ?? (mode === "design" ? "eleven_multilingual_ttv_v2" : "eleven_multilingual_v2");

  if (options.dryRun) {
    return planIdentityVoice(identity, { ...options, mode, model, outputFormat, text, voiceDescription: description });
  }

  const adapter = options.adapter ?? createElevenLabsAdapter();
  const assetId = createAssetId("voice");
  const generatedAt = new Date().toISOString();

  if (mode === "text-to-speech") {
    const voiceId = required(options.voiceId ?? identity.voice?.voiceId, "voiceId is required for text-to-speech generation");
    const generated = await adapter.textToSpeech({ voiceId, text, model, outputFormat });
    const asset = await writeGeneratedAsset(identity, {
      id: assetId,
      kind: "voice",
      provider,
      status: "generated",
      source: "generated",
      model,
      prompt: text,
      generatedAt,
      mediaType: generated.mediaType,
      bytes: generated.audio,
      outDir: options.outDir,
      metadata: {
        mode,
        outputFormat,
        voiceId,
        visibility: "internal",
        ...(generated.metadata ?? {}),
      },
    });
    const voice: VoiceProfile = {
      ...(identity.voice ?? {}),
      provider,
      voiceId,
      model,
      outputFormat,
      sampleText: text,
      assetId: asset.id,
      updatedAt: generatedAt,
      metadata: { ...(identity.voice?.metadata ?? {}), mode },
    };
    const updated = await store.update(identity.id, { assets: [...(identity.assets ?? []), asset], voice });
    return generatedMediaResult(updated, asset, { voice: updated.voice });
  }

  const generated = await adapter.designVoice({ description, text, model, outputFormat });
  const asset = await writeGeneratedAsset(identity, {
    id: assetId,
    kind: "voice",
    provider,
    status: "generated",
    source: "generated",
    model,
    prompt: description,
    generatedAt,
    mediaType: generated.mediaType,
    bytes: generated.audio,
    outDir: options.outDir,
    metadata: {
      mode,
      outputFormat,
      text: generated.previewText ?? text,
      generatedVoiceId: generated.generatedVoiceId,
      visibility: "internal",
      ...(generated.metadata ?? {}),
    },
  });

  let voiceId = identity.voice?.voiceId;
  let createdVoiceMetadata: Record<string, unknown> | undefined;
  if (options.createVoice && generated.generatedVoiceId && adapter.createVoice) {
    const created = await adapter.createVoice({
      name: identity.displayName ?? identity.fullName,
      description,
      generatedVoiceId: generated.generatedVoiceId,
    });
    voiceId = created.voiceId;
    createdVoiceMetadata = created.metadata;
  }

  const voice: VoiceProfile = {
    ...(identity.voice ?? {}),
    provider,
    voiceId,
    generatedVoiceId: generated.generatedVoiceId ?? identity.voice?.generatedVoiceId,
    name: identity.displayName ?? identity.fullName,
    description,
    model,
    outputFormat,
    sampleText: generated.previewText ?? text,
    previewAssetId: asset.id,
    assetId: asset.id,
    updatedAt: generatedAt,
    metadata: {
      ...(identity.voice?.metadata ?? {}),
      mode,
      createVoice: options.createVoice ?? false,
      ...(createdVoiceMetadata ? { createdVoice: createdVoiceMetadata } : {}),
    },
  };

  const updated = await store.update(identity.id, { assets: [...(identity.assets ?? []), asset], voice });
  return generatedMediaResult(updated, asset, { voice: updated.voice });
}

export async function generateIdentityProfileImage(
  store: IdentityStore,
  target: string,
  options: GenerateIdentityProfileImageOptions = {},
): Promise<GeneratedIdentityMediaResult> {
  const identity = await store.require(target);
  const provider = "minimax";
  const prompt = normalizeImagePrompt(options.prompt ?? buildProfileImagePrompt(identity));
  const model = options.model ?? "image-01";
  const aspectRatio = options.aspectRatio ?? "1:1";

  if (options.dryRun) {
    return plannedMediaResult(identity, {
      kind: "profile-image",
      provider,
      model,
      prompt,
      metadata: { aspectRatio, visibility: "internal" },
    });
  }

  const generatedAt = new Date().toISOString();
  const generated = await (options.adapter ?? createMiniMaxImageAdapter()).generateProfileImage({ prompt, model, aspectRatio });
  const asset = await writeGeneratedAsset(identity, {
    id: createAssetId("profile-image"),
    kind: "profile-image",
    provider,
    status: "generated",
    source: "generated",
    model,
    prompt,
    generatedAt,
    mediaType: generated.mediaType,
    bytes: generated.image,
    url: generated.url,
    outDir: options.outDir,
    metadata: {
      aspectRatio,
      visibility: "internal",
      ...(generated.metadata ?? {}),
    },
  });
  const profileImage: ProfileImage = {
    ...(identity.profileImage ?? {}),
    provider,
    model,
    prompt,
    aspectRatio,
    assetId: asset.id,
    url: generated.url ?? identity.profileImage?.url,
    updatedAt: generatedAt,
    metadata: { ...(identity.profileImage?.metadata ?? {}) },
  };
  const updated = await store.update(identity.id, { assets: [...(identity.assets ?? []), asset], profileImage });
  return generatedMediaResult(updated, asset, { profileImage: updated.profileImage });
}

export async function generateHasnaRosterMedia(
  store: IdentityStore,
  options: GenerateHasnaRosterMediaOptions = {},
): Promise<GenerateHasnaRosterMediaResult> {
  const { createHasnaCompanyAgentInputs } = await import("./roster.js");
  const inputs = createHasnaCompanyAgentInputs();
  const selectedInputs = typeof options.limit === "number" ? inputs.slice(0, options.limit) : inputs;
  const generateVoices = options.voices ?? !options.profileImages;
  const generateProfileImages = options.profileImages ?? !options.voices;
  const generated: GeneratedIdentityMediaResult[] = [];
  const skipped: GenerateHasnaRosterMediaResult["skipped"] = [];
  const failed: GenerateHasnaRosterMediaResult["failed"] = [];
  const secrets = detectIdentityMediaSecrets();

  let planned = 0;

  for (const input of selectedInputs) {
    const target = String(input.uniqueIdentifier);
    let identity = await store.get(target);
    if (!identity) {
      identity = options.dryRun ? createIdentity(input) : await store.create(input);
    }

    if (generateVoices) {
      planned += 1;
      if (!options.dryRun && !secrets.elevenlabs.available && !options.voice?.adapter) {
        skipped.push({ target, reason: "ElevenLabs API key is not available" });
      } else {
        try {
          generated.push(options.dryRun
            ? planIdentityVoice(identity, { ...options.voice, outDir: options.outDir, dryRun: true })
            : await generateIdentityVoice(store, identity.id, { ...options.voice, outDir: options.outDir }));
        } catch (error) {
          failed.push({ target, kind: "voice", error: errorMessage(error) });
        }
      }
    }

    if (generateProfileImages) {
      planned += 1;
      if (!options.dryRun && !secrets.minimax.available && !options.profileImage?.adapter) {
        skipped.push({ target, reason: "MiniMax API key is not available" });
      } else {
        try {
          generated.push(options.dryRun
            ? planIdentityProfileImage(identity, { ...options.profileImage, outDir: options.outDir, dryRun: true })
            : await generateIdentityProfileImage(store, identity.id, { ...options.profileImage, outDir: options.outDir }));
        } catch (error) {
          failed.push({ target, kind: "profile-image", error: errorMessage(error) });
        }
      }
    }
  }

  return { planned, generated, skipped, failed, secrets };
}

function planIdentityVoice(identity: Identity, options: GenerateIdentityVoiceOptions): GeneratedIdentityMediaResult {
  const mode = options.mode ?? (options.voiceId ? "text-to-speech" : "design");
  const text = normalizeSampleText(options.text ?? buildVoiceSampleText(identity));
  const description = normalizeVoiceDescription(options.voiceDescription ?? buildVoiceDescription(identity));
  const outputFormat = options.outputFormat ?? "mp3_44100_128";
  const model = options.model ?? (mode === "design" ? "eleven_multilingual_ttv_v2" : "eleven_multilingual_v2");
  return plannedMediaResult(identity, {
    kind: "voice",
    provider: "elevenlabs",
    model,
    prompt: mode === "design" ? description : text,
    metadata: { mode, outputFormat, text, voiceDescription: description, visibility: "internal" },
  });
}

function planIdentityProfileImage(identity: Identity, options: GenerateIdentityProfileImageOptions): GeneratedIdentityMediaResult {
  const prompt = normalizeImagePrompt(options.prompt ?? buildProfileImagePrompt(identity));
  const aspectRatio = options.aspectRatio ?? "1:1";
  return plannedMediaResult(identity, {
    kind: "profile-image",
    provider: "minimax",
    model: options.model ?? "image-01",
    prompt,
    metadata: { aspectRatio, visibility: "internal" },
  });
}

export function createElevenLabsAdapter(config: { apiKey?: string; baseUrl?: string } = {}): ElevenLabsVoiceAdapter {
  const apiKeys = config.apiKey
    ? [{ value: config.apiKey, source: "config" }]
    : resolveProviderSecretCandidates(ELEVENLABS_ENV_NAMES, ELEVENLABS_SECRET_KEYS);
  required(apiKeys[0]?.value, "ElevenLabs API key is not configured");
  const baseUrl = trimTrailingSlash(config.baseUrl ?? process.env["ELEVENLABS_BASE_URL"] ?? DEFAULT_ELEVENLABS_BASE_URL);

  async function post<T>(
    path: string,
    body: Record<string, unknown>,
    responseType: "json" | "arraybuffer",
    apiKey: string,
    params: Record<string, string | undefined> = {},
  ): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs request failed (${response.status}): ${await safeResponseText(response)}`);
    }
    if (responseType === "arraybuffer") return new Uint8Array(await response.arrayBuffer()) as T;
    return await response.json() as T;
  }

  return {
    async designVoice(input) {
      return await attemptElevenLabs(apiKeys, async (apiKey) => {
        const response = await post<{
          previews?: Array<{ audio_base_64?: string; generated_voice_id?: string; media_type?: string; duration_secs?: number; language?: string }>;
          text?: string;
        }>("/v1/text-to-voice/design", {
          voice_description: input.description,
          text: input.text,
          model_id: input.model ?? "eleven_multilingual_ttv_v2",
        }, "json", apiKey, { output_format: input.outputFormat ?? "mp3_44100_128" });
        const preview = response.previews?.[0];
        const audioBase64 = preview?.audio_base_64;
        if (!audioBase64) throw new Error("ElevenLabs voice design did not return preview audio");
        return {
          audio: decodeBase64Payload(audioBase64).bytes,
          mediaType: preview.media_type ?? "audio/mpeg",
          generatedVoiceId: preview.generated_voice_id,
          previewText: response.text,
          metadata: {
            durationSeconds: preview.duration_secs,
            language: preview.language,
          },
        };
      });
    },
    async textToSpeech(input) {
      return await attemptElevenLabs(apiKeys, async (apiKey) => {
        const audio = await post<Uint8Array>(`/v1/text-to-speech/${encodeURIComponent(input.voiceId)}`, {
          text: input.text,
          model_id: input.model ?? "eleven_multilingual_v2",
        }, "arraybuffer", apiKey, { output_format: input.outputFormat ?? "mp3_44100_128" });
        return { audio, mediaType: "audio/mpeg" };
      });
    },
    async createVoice(input) {
      return await attemptElevenLabs(apiKeys, async (apiKey) => {
        const response = await post<{ voice_id?: string; [key: string]: unknown }>("/v1/text-to-voice", {
          voice_name: input.name,
          voice_description: input.description,
          generated_voice_id: input.generatedVoiceId,
        }, "json", apiKey);
        const voiceId = response.voice_id;
        if (!voiceId) throw new Error("ElevenLabs voice creation did not return voice_id");
        return { voiceId, metadata: response };
      });
    },
  };
}

export function createMiniMaxImageAdapter(config: { apiKey?: string; baseUrl?: string } = {}): MiniMaxImageAdapter {
  const apiKeys = config.apiKey
    ? [{ value: config.apiKey, source: "config" }]
    : resolveProviderSecretCandidates(MINIMAX_ENV_NAMES, MINIMAX_SECRET_KEYS);
  required(apiKeys[0]?.value, "MiniMax API key is not configured");
  const baseUrl = trimTrailingSlash(config.baseUrl ?? process.env["MINIMAX_BASE_URL"] ?? process.env["MINIMAX_API_BASE_URL"] ?? DEFAULT_MINIMAX_BASE_URL);

  return {
    async generateProfileImage(input) {
      return await attemptMiniMax(apiKeys, async (apiKey) => {
        const response = await fetch(`${baseUrl}/image_generation`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model ?? "image-01",
            prompt: input.prompt,
            aspect_ratio: input.aspectRatio ?? "1:1",
            response_format: "base64",
            n: 1,
            prompt_optimizer: true,
          }),
        });
        if (!response.ok) {
          throw new Error(`MiniMax image generation failed (${response.status}): ${await safeResponseText(response)}`);
        }
        const payload = await response.json() as Record<string, unknown>;
        if (isMiniMaxAuthFailure(payload)) {
          throw new AuthRetryError("MiniMax auth failure");
        }
        const image = await extractMiniMaxImage(payload);
        return {
          ...image,
          metadata: { response: summarizeMiniMaxResponse(payload) },
        };
      });
    },
  };
}

async function attemptElevenLabs<T>(
  candidates: Array<{ value: string; source: string }>,
  run: (apiKey: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await run(candidate.value);
    } catch (error) {
      lastError = error;
      if (!isAuthRetryable(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ElevenLabs request failed");
}

async function attemptMiniMax<T>(
  candidates: Array<{ value: string; source: string }>,
  run: (apiKey: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await run(candidate.value);
    } catch (error) {
      lastError = error;
      if (!isAuthRetryable(error)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MiniMax request failed");
}

function detectProviderSecret(envNames: string[], secretKeys: string[]): ProviderSecretStatus {
  const resolved = resolveProviderSecret(envNames, secretKeys);
  return {
    available: Boolean(resolved),
    source: resolved?.source,
    checkedEnv: envNames,
    checkedSecrets: secretKeys,
  };
}

function resolveProviderSecret(envNames: string[], secretKeys: string[]): { value: string; source: string } | undefined {
  return resolveProviderSecretCandidates(envNames, secretKeys)[0];
}

function resolveProviderSecretCandidates(envNames: string[], secretKeys: string[]): Array<{ value: string; source: string }> {
  const candidates: Array<{ value: string; source: string }> = [];
  for (const name of envNames) {
    const value = process.env[name]?.trim();
    if (value) candidates.push({ value, source: `env:${name}` });
  }
  for (const key of secretKeys) {
    const value = readSecretValue(key);
    if (value) candidates.push({ value, source: `secrets:${key}` });
  }
  return candidates;
}

function readSecretValue(key: string): string | undefined {
  const result = spawnSync("secrets", ["get", key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value ? value : undefined;
}

async function writeGeneratedAsset(identity: Identity, input: {
  id: string;
  kind: IdentityAsset["kind"];
  provider: string;
  status: IdentityAsset["status"];
  source: IdentityAsset["source"];
  model?: string;
  prompt?: string;
  generatedAt: string;
  mediaType: string;
  bytes: Uint8Array;
  url?: string;
  outDir?: string;
  metadata?: Record<string, unknown>;
}): Promise<IdentityAsset> {
  const dir = join(input.outDir ?? getIdentityMediaAssetsDir(), safePathSegment(identity.uniqueIdentifier.value || identity.id));
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const extension = extensionForMediaType(input.mediaType, input.kind);
  const path = join(dir, `${input.id}.${extension}`);
  await writeFile(path, input.bytes, { mode: 0o600 });
  return {
    id: input.id,
    kind: input.kind,
    provider: input.provider,
    status: input.status,
    source: input.source,
    path,
    url: input.url,
    mediaType: input.mediaType,
    bytes: input.bytes.byteLength,
    checksum: sha256(input.bytes),
    model: input.model,
    prompt: input.prompt,
    generatedAt: input.generatedAt,
    metadata: input.metadata ?? {},
  };
}

function plannedMediaResult(identity: Identity, input: {
  kind: IdentityAsset["kind"];
  provider: string;
  model?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}): GeneratedIdentityMediaResult {
  const asset: IdentityAsset = {
    id: `planned_${input.kind}`,
    kind: input.kind,
    provider: input.provider,
    status: "planned",
    source: "generated",
    model: input.model,
    prompt: input.prompt,
    metadata: input.metadata ?? {},
  };
  return generatedMediaResult(identity, asset, {});
}

function generatedMediaResult(
  identity: Identity,
  asset: IdentityAsset,
  overlays: Pick<GeneratedIdentityMediaResult, "voice" | "profileImage">,
): GeneratedIdentityMediaResult {
  return {
    identityId: identity.id,
    identifier: identityIdentifierToString(publicIdentityIdentifier(identity)),
    fullName: identity.fullName,
    kind: asset.kind,
    provider: asset.provider,
    dryRun: asset.status === "planned",
    asset,
    ...overlays,
  };
}

function buildVoiceDescription(identity: Identity): string {
  const role = identity.agent?.role ?? "identity-aware company agent";
  const voice = identity.documents.voice?.trim() || "Concise, operational, and specific.";
  return [
    `A clear professional AI agent voice for ${identity.displayName ?? identity.fullName}.`,
    `The speaker supports ${role}.`,
    `${voice}`,
    "The voice should sound original, calm, alert, trustworthy, and not like any real public figure.",
  ].join(" ");
}

function buildVoiceSampleText(identity: Identity): string {
  const name = identity.displayName ?? identity.fullName;
  const role = identity.agent?.role ?? "identity-aware coordination";
  return [
    `Hello, I am ${name}.`,
    `My role is ${role}.`,
    "I keep identity, context, and handoffs explicit so humans and agents can coordinate from the same source of truth.",
  ].join(" ");
}

function buildProfileImagePrompt(identity: Identity): string {
  const name = identity.displayName ?? identity.fullName;
  const role = identity.agent?.role ?? "identity-aware company agent";
  return [
    `Professional square profile portrait for ${name}, a fictional AI agent responsible for ${role}.`,
    "Modern company avatar, original face, subtle Greco-Roman naming inspiration, natural lighting, clean background, high detail, no text, no logo, no watermark.",
  ].join(" ");
}

function normalizeVoiceDescription(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length >= 20) return trimmed.slice(0, 1000);
  return `${trimmed} Clear, professional, original, and operational.`.slice(0, 1000);
}

function normalizeSampleText(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length >= 100) return trimmed.slice(0, 1000);
  return `${trimmed} I state assumptions, preserve durable context, and coordinate work through the identity-aware Hasna system.`.slice(0, 1000);
}

function normalizeImagePrompt(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) throw new Error("profile image prompt cannot be empty");
  return trimmed.slice(0, 1500);
}

async function extractMiniMaxImage(payload: Record<string, unknown>): Promise<{ image: Uint8Array; mediaType: string; url?: string }> {
  const data = isRecord(payload.data) ? payload.data : payload;
  const base64 = firstString(data.image_base64) ?? firstString(data.imageBase64) ?? firstImagePayload(data.images, "base64") ?? firstImagePayload(data.image, "base64");
  if (base64) {
    const decoded = decodeBase64Payload(base64);
    return { image: decoded.bytes, mediaType: decoded.mediaType ?? "image/png" };
  }

  const url = firstString(data.image_urls) ?? firstString(data.imageUrls) ?? firstString(data.image_url) ?? firstImagePayload(data.images, "url");
  if (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`MiniMax image download failed (${response.status})`);
    const mediaType = response.headers.get("content-type")?.split(";")[0] || "image/png";
    return { image: new Uint8Array(await response.arrayBuffer()), mediaType, url };
  }

  throw new Error("MiniMax image generation response did not include image_base64 or image_urls");
}

function firstImagePayload(value: unknown, key: "base64" | "url"): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") return item;
      if (isRecord(item)) {
        const result = firstString(item[key]) ?? firstString(item[key === "base64" ? "image_base64" : "image_url"]);
        if (result) return result;
      }
    }
  }
  if (isRecord(value)) return firstString(value[key]);
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string" && item.trim());
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

function decodeBase64Payload(value: string): { bytes: Uint8Array; mediaType?: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  const mediaType = match?.[1];
  const payload = match?.[2] ?? value;
  return { bytes: new Uint8Array(Buffer.from(payload, "base64")), mediaType };
}

function summarizeMiniMaxResponse(payload: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(payload.data) ? payload.data : {};
  return {
    id: payload.id,
    created: payload.created,
    model: payload.model,
    usage: payload.usage,
    baseResp: payload.base_resp,
    hasImageBase64: Boolean(firstString(data.image_base64) ?? firstString(data.imageBase64)),
    hasImageUrls: Boolean(firstString(data.image_urls) ?? firstString(data.imageUrls)),
  };
}

function isMiniMaxAuthFailure(payload: Record<string, unknown>): boolean {
  const baseResp = isRecord(payload.base_resp) ? payload.base_resp : undefined;
  const statusCode = typeof baseResp?.status_code === "number" ? baseResp.status_code : undefined;
  const statusMsg = typeof baseResp?.status_msg === "string" ? baseResp.status_msg.toLowerCase() : "";
  return statusCode === 1004 || statusMsg.includes("login fail") || statusMsg.includes("auth");
}

class AuthRetryError extends Error {}

function isAuthRetryable(error: unknown): boolean {
  if (error instanceof AuthRetryError) return true;
  if (!(error instanceof Error)) return false;
  return /(?:401|403|login fail|unauthorized|forbidden)/i.test(error.message);
}

function extensionForMediaType(mediaType: string, kind: IdentityAsset["kind"]): string {
  const normalized = mediaType.toLowerCase().split(";")[0];
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return "mp3";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return "wav";
  if (normalized === "audio/flac") return "flac";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/png") return "png";
  return kind === "voice" ? "mp3" : "png";
}

function createAssetId(kind: IdentityAsset["kind"]): string {
  return `${kind.replace(/[^a-z0-9]+/g, "-")}_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safePathSegment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || `identity-${randomUUID()}`;
}

async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 1000);
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined || value === "") throw new Error(message);
  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
