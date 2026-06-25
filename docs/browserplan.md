# BrowserPlan Identity Contract

BrowserPlan profiles are built from three inputs:

- a canonical machine id from `open-machines`
- an `open-identities` identity record
- an email address whose operational readiness is owned by `open-mailery`/`open-emails`

`open-identities` owns the identity/profile binding. It does not own remote
machine reachability, mailbox delivery state, credentials, browser profile
installation, or app artifact distribution.

## Target Machines

The default BrowserPlan target set is:

```text
machine001 machine002 machine003 machine004 machine005 machine006
machine007 machine008 machine009 machine010 machine011
```

`spark01` and `spark02` are excluded from the BrowserPlan fleet profile install
target by default.

`open-machines` owns the BrowserPlan fleet contract. Consumers should retrieve
machine eligibility from the `browserplan_fleet` envelope and use its
`machine_id` plus `display_name`/`displayName` fields when naming actors,
profiles, local secrets, and install records. `open-identities` stores the
normalized `machineId` on assignments and reservations, but BrowserPlan and
open-chrome own concrete browser profile naming and launch behavior.

The SDK exports:

- `browserPlanDefaultMachineIds`
- `browserPlanExcludedMachineIds`

## Identity Fields

Normalized identity records include first-class BrowserPlan fields:

```ts
interface Identity {
  machineAssignments: IdentityMachineAssignment[];
  browserPlanProfiles: BrowserPlanProfileReservation[];
}

interface IdentityMachineAssignment {
  machineId: string;
  purpose?: string;
  slot?: string;
  status?: "assigned" | "reserved" | "released";
  assignedAt?: string;
  releasedAt?: string;
  metadata?: Record<string, unknown>;
}

interface BrowserPlanProfileReservation {
  id: string;
  machineId: string;
  profileName: string;
  email: string;
  slot?: string;
  status: "reserved" | "active" | "released";
  reservedAt: string;
  activatedAt?: string;
  releasedAt?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}
```

Machine ids are normalized to lowercase. Email addresses are normalized through
the existing identity email validator.

## SDK Surface

Use `IdentityStore` for durable operations:

```ts
import { IdentityStore } from "@hasna/identities";

const store = new IdentityStore();

await store.create({
  kind: "agent",
  fullName: "Browser Agent 01",
  displayName: "Browser Agent 01",
  uniqueIdentifier: "agent:browser-agent-01",
  emails: [{ address: "browser-agent-01@hasna.xyz", verified: true }],
  machineAssignments: [{ machineId: "machine001", purpose: "browserplan", slot: "profile-01" }],
});

await store.assignMachine("agent:browser-agent-01", {
  machineId: "machine001",
  purpose: "browserplan",
  slot: "profile-01",
});

await store.linkEmail("agent:browser-agent-01", {
  address: "browser-agent-01@hasna.xyz",
  verified: true,
  maileryId: "mailery-address-id",
});

await store.reserveBrowserPlanProfile("agent:browser-agent-01", {
  machineId: "machine001",
  slot: "profile-01",
});

const identities = await store.listByMachine("machine001", { purpose: "browserplan" });
const profiles = await store.listBrowserPlanProfilesByMachine("machine001", { requiredCount: 8 });
const coverage = await store.getBrowserPlanCoverage({ targetPerMachine: 8 });
```

`listBrowserPlanProfilesByMachine(machineId, { requiredCount })` throws an
`Insufficient ready BrowserPlan profiles` error when fewer ready profiles are
available than the caller requires. Ready means the profile is not released and
its attached identity email is both verified and linked to Mailery by
`maileryId` or a synced Mailery `sync` ref.

The package also exports pure helpers from `@hasna/identities/browserplan`:

- `listBrowserPlanProfiles(identities, machineId, { requiredCount })`
- `createBrowserPlanCoverageReport(identities, options)`

## CLI Surface

```bash
identities create \
  --kind agent \
  --name "Browser Agent 01" \
  --display-name "Browser Agent 01" \
  --identifier agent:browser-agent-01 \
  --email browser-agent-01@hasna.xyz \
  --machine machine001 \
  --json

identities machine assign agent:browser-agent-01 machine001 \
  --purpose browserplan \
  --slot profile-01 \
  --json

identities link-email agent:browser-agent-01 browser-agent-01@hasna.xyz \
  --verified \
  --mailery-id mailery-address-id \
  --json

identities browserplan reserve agent:browser-agent-01 \
  --machine machine001 \
  --slot profile-01 \
  --json

identities machine list machine001 --purpose browserplan --json
identities browserplan list --machine machine001 --require 8 --ready-only --json
identities browserplan coverage --target 8 --json
```

`machine list --json` returns a bounded machine identity summary. It does not
include identity documents, private metadata, or asset details.

Without `--json`, these commands render compact tables and summaries suitable
for agent terminals. Use `--limit <n>` for longer `machine list` and
`browserplan list` output, and use `--verbose` only when a full object dump is
needed for debugging.

## Duplicate Rules

The store rejects:

- duplicate identity ids
- duplicate identifiers
- duplicate email addresses
- duplicate phone numbers
- duplicate active machine slots for the same machine and purpose
- duplicate active BrowserPlan reservations for the same machine plus slot
- duplicate active BrowserPlan reservations for the same machine plus email

Reservations also require:

- the identity to be assigned to the requested BrowserPlan machine
- the reservation email to already be attached to that identity

Mailery remains responsible for proving the address is receive-ready. Store
`maileryId` or a synced `sync.provider = "mailery"` ref on `EmailAddress` when
that external readiness contract has linked the address. Coverage counts a
BrowserPlan profile as `usable` only when the email is verified and Mailery
linked.

## Current Coverage Snapshot

Inventory source: default local store `~/.hasna/identities/identities.json` on
2026-06-25. This snapshot is metadata-only and does not list contact values.

- total identities: 71
- identities with at least one email: 66
- identities with a verified email: 42
- identities with Mailery refs: 0
- identities with machine assignment hints: 0
- identities with BrowserPlan reservation hints: 0
- ready/usable BrowserPlan profiles for `machine001` through `machine011`: 0 per machine
- target gap: 8 per machine, 88 total missing ready BrowserPlan profiles
- excluded install targets: `spark01`, `spark02`

Current blocker for full profile readiness: identity records have email fields
but no machine assignments or BrowserPlan reservations. Mailery readiness refs
are also absent from the identity store until `open-mailery`/`open-emails`
links ready addresses back to identities.
