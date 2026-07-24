import { type IdentityStore } from "./storage.js";
import type { IdentityAsset, ProfileImage, VoiceProfile } from "./types.js";
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
    skipped: Array<{
        target: string;
        reason: string;
    }>;
    failed: Array<{
        target: string;
        kind: IdentityAsset["kind"];
        error: string;
    }>;
    secrets: IdentityMediaSecretStatus;
}
export declare function getIdentityMediaAssetsDir(): string;
export declare function detectIdentityMediaSecrets(): IdentityMediaSecretStatus;
export declare function generateIdentityVoice(store: IdentityStore, target: string, options?: GenerateIdentityVoiceOptions): Promise<GeneratedIdentityMediaResult>;
export declare function generateIdentityProfileImage(store: IdentityStore, target: string, options?: GenerateIdentityProfileImageOptions): Promise<GeneratedIdentityMediaResult>;
export declare function generateHasnaRosterMedia(store: IdentityStore, options?: GenerateHasnaRosterMediaOptions): Promise<GenerateHasnaRosterMediaResult>;
export declare function createElevenLabsAdapter(config?: {
    apiKey?: string;
    baseUrl?: string;
}): ElevenLabsVoiceAdapter;
export declare function createMiniMaxImageAdapter(config?: {
    apiKey?: string;
    baseUrl?: string;
}): MiniMaxImageAdapter;
