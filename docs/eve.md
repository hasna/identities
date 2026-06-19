# Eve Compatibility

`open-identities` exports identity records into Vercel Eve agent directories without making Eve the canonical source of identity data.

```bash
identities eve export agent:ava-example --out ./ava-agent
```

The exporter writes:

- `agent/instructions.md` from public identity documents
- `agent/identity.json` as an open-identities manifest
- `agent/agent.ts` as a minimal Eve agent entrypoint
- `agent/tools/resolve_identity.ts` for the generated agent identity reference
- `agent/skills/*.md` from selected identity documents
- `agent/schedules/identity_audit.md` when schedule hints exist

Private records such as sensitive identifiers are not written into Eve exports by default. If an identity's canonical unique identifier is sensitive, generated manifests use `open-identities:<identity.id>`.

Voice guidance is exported as an Eve skill document, and `identity.json` includes first-class `voice`, `profileImage`, and `assets` references. Generated audio and image bytes remain external files owned by `open-identities`.
