import type { BrowserPlanCoverageReport, BrowserPlanIdentityProfile, Identity } from "./types.js";
export declare const browserPlanDefaultMachineIds: string[];
export declare const browserPlanExcludedMachineIds: string[];
export interface BrowserPlanCoverageOptions {
    machineIds?: string[];
    excludedMachineIds?: string[];
    targetPerMachine?: number;
}
export interface ListBrowserPlanProfilesOptions {
    requiredCount?: number;
    readyOnly?: boolean;
}
export declare function listBrowserPlanProfiles(identities: Identity[], machineId: string, options?: ListBrowserPlanProfilesOptions): BrowserPlanIdentityProfile[];
export declare function createBrowserPlanCoverageReport(identities: Identity[], options?: BrowserPlanCoverageOptions): BrowserPlanCoverageReport;
