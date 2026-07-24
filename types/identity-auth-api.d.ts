import { IdentityAccessTokenVerifier, IdentityJwksRegistry, type IdentityTokenVerificationRequirements } from "./identity-auth.js";
export interface IdentityAuthApiOptions {
    jwks: IdentityJwksRegistry;
    verifier: IdentityAccessTokenVerifier;
    requirements?: IdentityTokenVerificationRequirements;
}
export interface IdentityAuthApi {
    handle(request: Request): Promise<Response>;
}
export declare function createIdentityAuthApi(options: IdentityAuthApiOptions): IdentityAuthApi;
