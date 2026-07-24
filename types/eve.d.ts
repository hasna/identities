import type { Identity, IdentityDocumentKey } from "./types.js";
export interface EveExportOptions {
    outDir: string;
    model?: string;
}
export interface EveExportResult {
    outDir: string;
    files: string[];
}
export declare function writeEveAgent(identity: Identity, options: EveExportOptions): Promise<EveExportResult>;
export declare function listEveDocumentKeys(): IdentityDocumentKey[];
