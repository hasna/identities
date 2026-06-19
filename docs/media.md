# Media

`open-identities` models generated voice and profile pictures as identity media. The identity JSON stores metadata and file references. Audio and image bytes are written to disk and are not embedded in the identity record.

## Storage

Generated assets are written to:

```bash
~/.hasna/identities/assets
```

Override this with `OPEN_IDENTITIES_ASSETS_DIR` or with `--out-dir` on generation commands.

Each generated asset stores:

- provider and model
- media kind: `voice` or `profile-image`
- file path or provider URL
- media type, byte size, and SHA-256 checksum
- generation prompt or sample text
- generation status and timestamp
- internal metadata such as visibility and provider response hints

## Providers

Voice generation uses ElevenLabs directly. If an existing `--voice-id` is provided, `open-identities` creates a text-to-speech sample. Without `--voice-id`, it uses ElevenLabs voice design to create a generated voice preview and stores the returned generated voice ID.

Profile image generation uses MiniMax image generation directly with `response_format: "base64"` so the image can be saved locally before provider URLs expire.

Provider keys are resolved from environment variables first and then from compatible `secrets` vault keys. `media doctor` reports availability without printing values:

```bash
identities media doctor --json
```

Supported key names:

- ElevenLabs: `ELEVENLABS_API_KEY`, `XI_API_KEY`, `HASNAXYZ_ELEVENLABS_LIVE_API_KEY`
- MiniMax: `MINIMAX_API_KEY`, `HASNAXYZ_MINIMAX_LIVE_API_KEY`, `HASNA_TAKUMI_LIVE_MINIMAX_API_KEY`
- MiniMax vault fallback: `hasna/takumi/live/minimax_api_key`

## CLI

```bash
identities media generate-voice agent:calliope --json
identities media generate-profile-image agent:calliope --json
identities media generate-roster --voices --profile-images --json
identities media status agent:calliope --json
identities asset list agent:calliope --json
```

Use `--dry-run` to inspect planned generation without calling providers:

```bash
identities media generate-roster --voices --profile-images --dry-run --json
```

## SDK

```ts
import {
  IdentityStore,
  generateHasnaRosterMedia,
  generateIdentityProfileImage,
  generateIdentityVoice,
} from "@hasna/identities";

const store = new IdentityStore();

await generateIdentityVoice(store, "agent:calliope");
await generateIdentityProfileImage(store, "agent:calliope");

await generateHasnaRosterMedia(store, {
  voices: true,
  profileImages: true,
});
```

The SDK accepts custom adapters for tests or for future connector-backed implementations.

## Privacy

Voice and profile images are identity data. The default roster metadata marks generated media as internal. Do not publish or sync generated media externally unless the identity owner has approved that use and the target system has a clear adapter contract.
