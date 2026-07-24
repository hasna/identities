import { IdentityStore } from "@hasna/identities";
import { IdentityLifecycleService } from "@hasna/identities/user-lifecycle";
import { PgIdentityLifecycleStore } from "@hasna/identities/pg-user-lifecycle";
import { IdentitiesClient } from "@hasna/identities/sdk";

void [IdentityStore, IdentityLifecycleService, PgIdentityLifecycleStore, IdentitiesClient];
