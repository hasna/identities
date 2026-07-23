// OpenAPI 3.1 description of the @hasna/identities cloud HTTP API. This is the
// single source of truth for both the running server routes and the generated
// SDK (see scripts/generate-sdk.ts). Schemas are intentionally pragmatic: the
// Identity record is a rich object, so it is described as an open object while
// the mutating inputs are typed explicitly.

export function buildOpenApiDocument(version: string) {
  const identityRef = { $ref: "#/components/schemas/Identity" } as const;
  const identifierSchema = {
    oneOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          scheme: { type: "string" },
          value: { type: "string" },
          issuer: { type: "string" },
          country: { type: "string" },
        },
        required: ["scheme", "value"],
      },
    ],
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Identities API",
      version,
      description:
        "Open identity records for humans and AI agents. Cloud mode is PURE REMOTE (Amendment A1): all reads and writes hit the shared cloud Postgres directly.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        Identity: {
          type: "object",
          description: "A persisted identity record.",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["human", "agent", "organization", "service"] },
            fullName: { type: "string" },
            displayName: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
          required: ["id", "kind", "fullName"],
        },
        IdentityContactCard: {
          type: "object",
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            fullName: { type: "string" },
            displayName: { type: "string" },
            identifier: { type: "string" },
            primaryEmail: { type: "string" },
            primaryPhone: { type: "string" },
          },
          required: ["id", "kind", "fullName", "identifier"],
        },
        CreateIdentityInput: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["human", "agent", "organization", "service"] },
            fullName: { type: "string" },
            displayName: { type: "string" },
            uniqueIdentifier: identifierSchema,
            identifiers: { type: "array", items: identifierSchema },
            emails: { type: "array", items: { type: "string" } },
            phones: { type: "array", items: { type: "string" } },
          },
          required: ["kind", "fullName"],
        },
        UpdateIdentityInput: {
          type: "object",
          additionalProperties: true,
          properties: {
            kind: { type: "string", enum: ["human", "agent", "organization", "service"] },
            fullName: { type: "string" },
            displayName: { type: "string" },
            uniqueIdentifier: identifierSchema,
          },
        },
        LinkEmailInput: {
          type: "object",
          properties: {
            address: { type: "string" },
            label: { type: "string" },
            primary: { type: "boolean" },
          },
          required: ["address"],
        },
        LinkPhoneInput: {
          type: "object",
          properties: {
            number: { type: "string" },
            label: { type: "string" },
            primary: { type: "boolean" },
          },
          required: ["number"],
        },
        IdentityListResponse: {
          type: "object",
          properties: {
            identities: { type: "array", items: identityRef },
            count: { type: "integer" },
          },
          required: ["identities", "count"],
        },
        CardListResponse: {
          type: "object",
          properties: {
            cards: { type: "array", items: { $ref: "#/components/schemas/IdentityContactCard" } },
            count: { type: "integer" },
          },
          required: ["cards", "count"],
        },
        DeleteResponse: {
          type: "object",
          properties: { deleted: { type: "boolean" }, target: { type: "string" } },
          required: ["deleted", "target"],
        },
        ErrorResponse: {
          type: "object",
          properties: { error: { type: "string" }, reason: { type: "string" } },
          required: ["error"],
        },
        LoginIdentifierInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["email", "username"] },
            value: { type: "string", minLength: 1, maxLength: 320 },
          },
          required: ["kind", "value"],
        },
        SignupInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            identifier: { $ref: "#/components/schemas/LoginIdentifierInput" },
            password: { type: "string", minLength: 12, maxLength: 1024, format: "password", writeOnly: true },
            displayName: { type: "string", minLength: 1, maxLength: 160 },
            inviteToken: { type: "string", minLength: 32, maxLength: 512, writeOnly: true },
          },
          required: ["identifier", "password", "displayName"],
        },
        LoginInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            identifier: { $ref: "#/components/schemas/LoginIdentifierInput" },
            password: { type: "string", minLength: 1, maxLength: 1024, format: "password", writeOnly: true },
            tenantId: { type: "string" },
            scopes: { type: "array", items: { type: "string" }, maxItems: 100 },
          },
          required: ["identifier", "password"],
        },
        RefreshInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            refreshToken: { type: "string", minLength: 32, maxLength: 512, writeOnly: true },
          },
          required: ["refreshToken"],
        },
        AuthSession: {
          type: "object",
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "hasna.identity-user-lifecycle/v1" },
            user: { type: "object", additionalProperties: true },
            tenant: { type: "object", additionalProperties: true },
            membership: { type: "object", additionalProperties: true },
            scopes: { type: "array", items: { type: "string" } },
            accessToken: { type: "string", writeOnly: true },
            accessTokenExpiresAt: { type: "string", format: "date-time" },
            refreshToken: { type: "string", writeOnly: true },
            refreshTokenExpiresAt: { type: "string", format: "date-time" },
          },
          required: [
            "schemaVersion",
            "user",
            "tenant",
            "membership",
            "scopes",
            "accessToken",
            "accessTokenExpiresAt",
            "refreshToken",
            "refreshTokenExpiresAt",
          ],
        },
        VerificationInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 32, maxLength: 512, writeOnly: true },
          },
          required: ["token"],
        },
        RecoveryStartInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            identifier: { $ref: "#/components/schemas/LoginIdentifierInput" },
          },
          required: ["identifier"],
        },
        RecoveryCompleteInput: {
          type: "object",
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 32, maxLength: 512, writeOnly: true },
            newPassword: { type: "string", minLength: 12, maxLength: 1024, format: "password", writeOnly: true },
          },
          required: ["token", "newPassword"],
        },
        ActionAccepted: {
          type: "object",
          additionalProperties: false,
          properties: {
            accepted: { type: "boolean" },
            verified: { type: "boolean" },
            recovered: { type: "boolean" },
            loggedOut: { type: "boolean" },
            loggedOutAll: { type: "boolean" },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }],
    paths: {
      "/v1/identities": {
        get: {
          operationId: "listIdentities",
          summary: "List all identities",
          responses: jsonResponse("IdentityListResponse"),
        },
        post: {
          operationId: "createIdentity",
          summary: "Create an identity",
          requestBody: jsonBody("CreateIdentityInput"),
          responses: jsonResponse("Identity", "201"),
        },
      },
      "/v1/cards": {
        get: {
          operationId: "listCards",
          summary: "List identity contact cards",
          responses: jsonResponse("CardListResponse"),
        },
      },
      "/v1/identities/{target}": {
        get: {
          operationId: "getIdentity",
          summary: "Get an identity by id, identifier, email, or phone",
          parameters: [targetParam()],
          responses: jsonResponse("Identity"),
        },
        patch: {
          operationId: "updateIdentity",
          summary: "Update an identity",
          parameters: [targetParam()],
          requestBody: jsonBody("UpdateIdentityInput"),
          responses: jsonResponse("Identity"),
        },
        delete: {
          operationId: "deleteIdentity",
          summary: "Delete an identity",
          parameters: [targetParam()],
          responses: jsonResponse("DeleteResponse"),
        },
      },
      "/v1/identities/{target}/emails": {
        post: {
          operationId: "linkEmail",
          summary: "Link an email address to an identity",
          parameters: [targetParam()],
          requestBody: jsonBody("LinkEmailInput"),
          responses: jsonResponse("Identity"),
        },
      },
      "/v1/identities/{target}/phones": {
        post: {
          operationId: "linkPhone",
          summary: "Link a phone number to an identity",
          parameters: [targetParam()],
          requestBody: jsonBody("LinkPhoneInput"),
          responses: jsonResponse("Identity"),
        },
      },
      "/v1/auth/signup": {
        post: publicAuthOperation(
          "signupIdentityUser",
          "Register an end user under the configured disabled, invite, or open policy",
          "SignupInput",
          "AuthSession",
          "201",
        ),
      },
      "/v1/auth/login": {
        post: publicAuthOperation(
          "loginIdentityUser",
          "Authenticate an end user with timing-safe errors and tenant-bound scopes",
          "LoginInput",
          "AuthSession",
        ),
      },
      "/v1/auth/refresh": {
        post: publicAuthOperation(
          "refreshIdentitySession",
          "Rotate a hashed refresh token; replay revokes the entire session family",
          "RefreshInput",
          "AuthSession",
        ),
      },
      "/v1/auth/logout": {
        post: bearerAuthOperation("logoutIdentitySession", "Revoke the current JTI and session family"),
      },
      "/v1/auth/logout-all": {
        post: bearerAuthOperation("logoutAllIdentitySessions", "Revoke every session family for the current user"),
      },
      "/v1/auth/verification/complete": {
        post: publicAuthOperation(
          "verifyIdentityLoginIdentifier",
          "Consume a one-time login-identifier verification token",
          "VerificationInput",
          "ActionAccepted",
        ),
      },
      "/v1/auth/recovery/start": {
        post: publicAuthOperation(
          "startIdentityRecovery",
          "Start recovery with an enumeration-safe accepted response",
          "RecoveryStartInput",
          "ActionAccepted",
          "202",
        ),
      },
      "/v1/auth/recovery/complete": {
        post: publicAuthOperation(
          "completeIdentityRecovery",
          "Consume a one-time recovery token, replace the credential, and revoke sessions",
          "RecoveryCompleteInput",
          "ActionAccepted",
        ),
      },
    },
  };
}

function publicAuthOperation(
  operationId: string,
  summary: string,
  requestSchema: string,
  responseSchema: string,
  status = "200",
) {
  return {
    operationId,
    summary,
    security: [],
    requestBody: jsonBody(requestSchema),
    responses: jsonResponse(responseSchema, status),
  };
}

function bearerAuthOperation(operationId: string, summary: string) {
  return {
    operationId,
    summary,
    security: [{ BearerAuth: [] }],
    responses: jsonResponse("ActionAccepted"),
  };
}

function targetParam() {
  return { name: "target", in: "path", required: true, schema: { type: "string" } } as const;
}

function jsonBody(schema: string) {
  return {
    required: true,
    content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
  };
}

function jsonResponse(schema: string, status = "200") {
  return {
    [status]: {
      description: "OK",
      content: { "application/json": { schema: { $ref: `#/components/schemas/${schema}` } } },
    },
    "400": errorResponse(),
    "401": errorResponse(),
    "403": errorResponse(),
    "404": errorResponse(),
  };
}

function errorResponse() {
  return {
    description: "Error",
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
  };
}

export type IdentitiesOpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
