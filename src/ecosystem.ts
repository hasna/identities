import type { AgentRegistrationManifest, Identity } from "./types.js";
import { identityToAgentManifest } from "./core.js";

export type EcosystemTarget = "todos" | "mementos" | "conversations" | "mailery" | "telephony" | "eve";

export interface AgentIdentityRef {
  identityId: string;
  identifier: string;
  localAgentId?: string;
  sessionId?: string;
  source: EcosystemTarget | string;
  role?: string;
  metadata: Record<string, unknown>;
}

export interface EcosystemRegistrationManifest {
  identity: AgentRegistrationManifest;
  refs: AgentIdentityRef[];
}

export function createAgentIdentityRef(
  identity: Identity,
  input: {
    source: EcosystemTarget | string;
    localAgentId?: string;
    sessionId?: string;
    role?: string;
    metadata?: Record<string, unknown>;
  },
): AgentIdentityRef {
  const manifest = identityToAgentManifest(identity);
  return {
    identityId: identity.id,
    identifier: manifest.identifier,
    localAgentId: input.localAgentId,
    sessionId: input.sessionId,
    source: input.source,
    role: input.role ?? identity.agent?.role,
    metadata: {
      ...(input.metadata ?? {}),
      openIdentitiesId: identity.id,
      openIdentitiesIdentifier: manifest.identifier,
    },
  };
}

export function createEcosystemRegistrationManifest(
  identity: Identity,
  refs: AgentIdentityRef[] = [],
): EcosystemRegistrationManifest {
  return {
    identity: identityToAgentManifest(identity),
    refs,
  };
}

