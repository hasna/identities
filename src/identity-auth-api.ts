import {
  IdentityAccessTokenVerifier,
  IdentityAuthError,
  IdentityJwksRegistry,
  type IdentityTokenVerificationRequirements,
} from "./identity-auth.js";

export interface IdentityAuthApiOptions {
  jwks: IdentityJwksRegistry;
  verifier: IdentityAccessTokenVerifier;
  requirements?: IdentityTokenVerificationRequirements;
}

export interface IdentityAuthApi {
  handle(request: Request): Promise<Response>;
}

export function createIdentityAuthApi(options: IdentityAuthApiOptions): IdentityAuthApi {
  if (!options.verifier.isBoundToJwksRegistry(options.jwks)) {
    throw new IdentityAuthError(
      "invalid_configuration",
      "identity auth API publication and verification must use the same JWKS registry",
      500,
    );
  }
  const requirements = {
    ...(options.requirements?.tenant === undefined ? {} : { tenant: options.requirements.tenant }),
    ...(options.requirements?.scopes === undefined ? {} : { scopes: [...options.requirements.scopes] }),
  };
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
        return json(options.jwks.publicDocument(), 200, {
          "cache-control": "public, max-age=60, must-revalidate",
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/auth/verify") {
        try {
          const token = bearerToken(request.headers.get("authorization"));
          const claims = await options.verifier.verify(token, requirements);
          return json({ active: true, claims });
        } catch (error) {
          if (error instanceof IdentityAuthError) {
            return json({ active: false, reason: error.reason }, error.status);
          }
          return json({ active: false, reason: "invalid_token" }, 401);
        }
      }
      return json({ error: "not_found" }, 404);
    },
  };
}

function bearerToken(value: string | null): string {
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value ?? "");
  if (!match) throw new IdentityAuthError("invalid_token", "bearer access token is required");
  return match[1]!;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}
