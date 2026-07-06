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
    },
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
