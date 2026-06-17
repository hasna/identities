import type { EmailAddress, Identity, IdentityIdentifier, PhoneNumber } from "./types.js";
import { publicIdentityIdentifier } from "./core.js";
import type { IdentityStore } from "./storage.js";

export interface MaileryIdentitySyncInput {
  identityId: string;
  kind: Identity["kind"];
  fullName: string;
  displayName?: string;
  uniqueIdentifier: IdentityIdentifier;
  publicIdentifier: IdentityIdentifier;
  email: EmailAddress;
}

export interface TelephonyIdentitySyncInput {
  identityId: string;
  kind: Identity["kind"];
  fullName: string;
  displayName?: string;
  uniqueIdentifier: IdentityIdentifier;
  publicIdentifier: IdentityIdentifier;
  phone: PhoneNumber;
}

export interface ContactPointSyncResult {
  provider: "mailery" | "telephony";
  value: string;
  externalId?: string;
  status: "synced" | "failed" | "skipped";
  syncedAt?: string;
  error?: string;
}

export interface MaileryIdentityAdapter {
  upsertIdentityEmail(input: MaileryIdentitySyncInput): Promise<{ externalId?: string } | void>;
}

export interface TelephonyIdentityAdapter {
  upsertIdentityPhone(input: TelephonyIdentitySyncInput): Promise<{ externalId?: string } | void>;
}

export interface IdentitySyncAdapters {
  mailery?: MaileryIdentityAdapter;
  telephony?: TelephonyIdentityAdapter;
}

export async function syncIdentityContactPoints(identity: Identity, adapters: IdentitySyncAdapters): Promise<ContactPointSyncResult[]> {
  const results: ContactPointSyncResult[] = [];
  const publicIdentifier = publicIdentityIdentifier(identity);

  if (adapters.mailery) {
    for (const email of identity.emails) {
      try {
        const result = await adapters.mailery.upsertIdentityEmail({
          identityId: identity.id,
          kind: identity.kind,
          fullName: identity.fullName,
          displayName: identity.displayName,
          uniqueIdentifier: publicIdentifier,
          publicIdentifier,
          email,
        });
        results.push({ provider: "mailery", value: email.address, externalId: result?.externalId, status: "synced", syncedAt: new Date().toISOString() });
      } catch (error) {
        results.push({ provider: "mailery", value: email.address, status: "failed", error: errorMessage(error) });
      }
    }
  }

  if (adapters.telephony) {
    for (const phone of identity.phones) {
      try {
        const result = await adapters.telephony.upsertIdentityPhone({
          identityId: identity.id,
          kind: identity.kind,
          fullName: identity.fullName,
          displayName: identity.displayName,
          uniqueIdentifier: publicIdentifier,
          publicIdentifier,
          phone,
        });
        results.push({ provider: "telephony", value: phone.number, externalId: result?.externalId, status: "synced", syncedAt: new Date().toISOString() });
      } catch (error) {
        results.push({ provider: "telephony", value: phone.number, status: "failed", error: errorMessage(error) });
      }
    }
  }

  if (!adapters.mailery) {
    for (const email of identity.emails) {
      results.push({ provider: "mailery", value: email.address, status: "skipped", error: "No Mailery adapter configured" });
    }
  }

  if (!adapters.telephony) {
    for (const phone of identity.phones) {
      results.push({ provider: "telephony", value: phone.number, status: "skipped", error: "No Telephony adapter configured" });
    }
  }

  return results;
}

export async function syncIdentityContactPointsAndUpdate(
  store: IdentityStore,
  target: string,
  adapters: IdentitySyncAdapters,
): Promise<{ identity: Identity; results: ContactPointSyncResult[] }> {
  const identity = await store.require(target);
  const results = await syncIdentityContactPoints(identity, adapters);
  const updated = await store.update(identity.id, applyContactPointSyncResults(identity, results));
  return { identity: updated, results };
}

export function applyContactPointSyncResults(identity: Identity, results: ContactPointSyncResult[]): Pick<Identity, "emails" | "phones"> {
  return {
    emails: identity.emails.map((email) => {
      const result = results.find((item) => item.provider === "mailery" && item.value === email.address);
      if (!result) return email;
      return {
        ...email,
        maileryId: result.externalId ?? email.maileryId,
        sync: {
          provider: "mailery",
          externalId: result.externalId ?? email.sync?.externalId,
          status: result.status === "synced" ? "synced" : result.status === "failed" ? "failed" : "pending",
          syncedAt: result.syncedAt ?? email.sync?.syncedAt,
          error: result.error,
        },
      };
    }),
    phones: identity.phones.map((phone) => {
      const result = results.find((item) => item.provider === "telephony" && item.value === phone.number);
      if (!result) return phone;
      return {
        ...phone,
        telephonyId: result.externalId ?? phone.telephonyId,
        sync: {
          provider: "telephony",
          externalId: result.externalId ?? phone.sync?.externalId,
          status: result.status === "synced" ? "synced" : result.status === "failed" ? "failed" : "pending",
          syncedAt: result.syncedAt ?? phone.sync?.syncedAt,
          error: result.error,
        },
      };
    }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
