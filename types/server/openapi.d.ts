export declare function buildOpenApiDocument(version: string): {
    openapi: string;
    info: {
        title: string;
        version: string;
        description: string;
    };
    servers: {
        url: string;
    }[];
    components: {
        securitySchemes: {
            ApiKeyAuth: {
                type: string;
                in: string;
                name: string;
            };
        };
        schemas: {
            Identity: {
                type: string;
                description: string;
                additionalProperties: boolean;
                properties: {
                    id: {
                        type: string;
                    };
                    kind: {
                        type: string;
                        enum: string[];
                    };
                    fullName: {
                        type: string;
                    };
                    displayName: {
                        type: string;
                    };
                    createdAt: {
                        type: string;
                    };
                    updatedAt: {
                        type: string;
                    };
                };
                required: string[];
            };
            IdentityContactCard: {
                type: string;
                properties: {
                    id: {
                        type: string;
                    };
                    kind: {
                        type: string;
                    };
                    fullName: {
                        type: string;
                    };
                    displayName: {
                        type: string;
                    };
                    identifier: {
                        type: string;
                    };
                    primaryEmail: {
                        type: string;
                    };
                    primaryPhone: {
                        type: string;
                    };
                };
                required: string[];
            };
            CreateIdentityInput: {
                type: string;
                additionalProperties: boolean;
                properties: {
                    id: {
                        type: string;
                    };
                    kind: {
                        type: string;
                        enum: string[];
                    };
                    fullName: {
                        type: string;
                    };
                    displayName: {
                        type: string;
                    };
                    uniqueIdentifier: {
                        oneOf: ({
                            type: string;
                            properties?: undefined;
                            required?: undefined;
                        } | {
                            type: string;
                            properties: {
                                scheme: {
                                    type: string;
                                };
                                value: {
                                    type: string;
                                };
                                issuer: {
                                    type: string;
                                };
                                country: {
                                    type: string;
                                };
                            };
                            required: string[];
                        })[];
                    };
                    identifiers: {
                        type: string;
                        items: {
                            oneOf: ({
                                type: string;
                                properties?: undefined;
                                required?: undefined;
                            } | {
                                type: string;
                                properties: {
                                    scheme: {
                                        type: string;
                                    };
                                    value: {
                                        type: string;
                                    };
                                    issuer: {
                                        type: string;
                                    };
                                    country: {
                                        type: string;
                                    };
                                };
                                required: string[];
                            })[];
                        };
                    };
                    emails: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                    phones: {
                        type: string;
                        items: {
                            type: string;
                        };
                    };
                };
                required: string[];
            };
            UpdateIdentityInput: {
                type: string;
                additionalProperties: boolean;
                properties: {
                    kind: {
                        type: string;
                        enum: string[];
                    };
                    fullName: {
                        type: string;
                    };
                    displayName: {
                        type: string;
                    };
                    uniqueIdentifier: {
                        oneOf: ({
                            type: string;
                            properties?: undefined;
                            required?: undefined;
                        } | {
                            type: string;
                            properties: {
                                scheme: {
                                    type: string;
                                };
                                value: {
                                    type: string;
                                };
                                issuer: {
                                    type: string;
                                };
                                country: {
                                    type: string;
                                };
                            };
                            required: string[];
                        })[];
                    };
                };
            };
            LinkEmailInput: {
                type: string;
                properties: {
                    address: {
                        type: string;
                    };
                    label: {
                        type: string;
                    };
                    primary: {
                        type: string;
                    };
                };
                required: string[];
            };
            LinkPhoneInput: {
                type: string;
                properties: {
                    number: {
                        type: string;
                    };
                    label: {
                        type: string;
                    };
                    primary: {
                        type: string;
                    };
                };
                required: string[];
            };
            IdentityListResponse: {
                type: string;
                properties: {
                    identities: {
                        type: string;
                        items: {
                            readonly $ref: "#/components/schemas/Identity";
                        };
                    };
                    count: {
                        type: string;
                    };
                };
                required: string[];
            };
            CardListResponse: {
                type: string;
                properties: {
                    cards: {
                        type: string;
                        items: {
                            $ref: string;
                        };
                    };
                    count: {
                        type: string;
                    };
                };
                required: string[];
            };
            DeleteResponse: {
                type: string;
                properties: {
                    deleted: {
                        type: string;
                    };
                    target: {
                        type: string;
                    };
                };
                required: string[];
            };
            ErrorResponse: {
                type: string;
                properties: {
                    error: {
                        type: string;
                    };
                    reason: {
                        type: string;
                    };
                };
                required: string[];
            };
        };
    };
    security: {
        ApiKeyAuth: never[];
    }[];
    paths: {
        "/v1/identities": {
            get: {
                operationId: string;
                summary: string;
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
            post: {
                operationId: string;
                summary: string;
                requestBody: {
                    required: boolean;
                    content: {
                        "application/json": {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        "/v1/cards": {
            get: {
                operationId: string;
                summary: string;
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        "/v1/identities/{target}": {
            get: {
                operationId: string;
                summary: string;
                parameters: {
                    readonly name: "target";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                    };
                }[];
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
            patch: {
                operationId: string;
                summary: string;
                parameters: {
                    readonly name: "target";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        "application/json": {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
            delete: {
                operationId: string;
                summary: string;
                parameters: {
                    readonly name: "target";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                    };
                }[];
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        "/v1/identities/{target}/emails": {
            post: {
                operationId: string;
                summary: string;
                parameters: {
                    readonly name: "target";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        "application/json": {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        "/v1/identities/{target}/phones": {
            post: {
                operationId: string;
                summary: string;
                parameters: {
                    readonly name: "target";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                    };
                }[];
                requestBody: {
                    required: boolean;
                    content: {
                        "application/json": {
                            schema: {
                                $ref: string;
                            };
                        };
                    };
                };
                responses: {
                    [status]: {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "400": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "401": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "403": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    "404": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                };
            };
        };
    };
};
export type IdentitiesOpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
