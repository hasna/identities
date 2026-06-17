# Integrations

`open-identities` should own identity records. Mailery should own email delivery, mailbox state, send keys, quotas, and address ownership events. Telephony should own phone-number provisioning, messaging, calls, recordings, and transcripts.

The first sync layer is intentionally adapter-based:

```ts
import { syncIdentityContactPointsAndUpdate } from "@hasna/identities";

await syncIdentityContactPointsAndUpdate(store, identity.id, {
  mailery: {
    async upsertIdentityEmail(input) {
      return { externalId: "mailery-email-id" };
    },
  },
  telephony: {
    async upsertIdentityPhone(input) {
      return { externalId: "telephony-phone-id" };
    },
  },
});
```

## Mailery

The local email repo is `open-emails`. Its package is currently `@hasna/mailery`, and it also includes `@hasna/emails-sdk`.

The identity sync adapter should:

- Upsert or resolve a Mailery owner by `owners.external_id = identity.id`.
- Assign or transfer addresses through Mailery ownership APIs with reasons and audit events.
- Preserve only the non-sensitive public identity identifier in provider metadata.
- Return a stable Mailery external ID.
- Avoid copying prompt, soul, ethos, or other private documents into Mailery unless a specific feature requires it.

## Telephony

The local phone repo is `open-telephony`, published as `@hasna/telephony`.

The identity sync adapter should:

- Link agent identities to Telephony agents by `identityId`.
- Preserve only the non-sensitive public identity identifier in provider metadata.
- Return a stable Telephony external ID.
- Keep SMS, WhatsApp, call, voicemail, and transcript state in Telephony.

`open-telephony` does not yet model human/organization/service phone-number ownership with an administrator agent. Until that exists, `open-identities` should not claim human or organization phone ownership is fully represented in Telephony.

## Conflict Rules

- `open-identities` is the source of truth for full name, kind, unique identifier, and identity documents.
- Mailery is the source of truth for email operational state.
- Telephony is the source of truth for phone operational state.
- Sync should be idempotent and keyed by `identityId` plus normalized email address or phone number.
- Sensitive identifiers should not be propagated to integration systems by default.
- If `uniqueIdentifier.sensitive === true`, sync and public exports must use `open-identities:<identity.id>` instead.
- Sync helpers should persist provider links and sync status back into the identity store.
