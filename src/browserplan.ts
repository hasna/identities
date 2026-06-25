import { listBrowserPlanProfilesForIdentity, normalizeMachineId } from "./core.js";
import type {
  BrowserPlanCoverageReport,
  BrowserPlanIdentityProfile,
  BrowserPlanMachineCoverage,
  Identity,
  IdentityMachineAssignment,
} from "./types.js";

export const browserPlanDefaultMachineIds = Array.from({ length: 11 }, (_, index) => {
  return `machine${String(index + 1).padStart(3, "0")}`;
});

export const browserPlanExcludedMachineIds = ["spark01", "spark02"];

export interface BrowserPlanCoverageOptions {
  machineIds?: string[];
  excludedMachineIds?: string[];
  targetPerMachine?: number;
}

export interface ListBrowserPlanProfilesOptions {
  requiredCount?: number;
  readyOnly?: boolean;
}

export function listBrowserPlanProfiles(
  identities: Identity[],
  machineId: string,
  options: ListBrowserPlanProfilesOptions = {},
): BrowserPlanIdentityProfile[] {
  const normalizedMachineId = normalizeMachineId(machineId);
  const profiles = identities.flatMap((identity) => listBrowserPlanProfilesForIdentity(identity, normalizedMachineId));
  const readyProfiles = profiles.filter((profile) => profile.emailReady);
  if (options.requiredCount !== undefined && readyProfiles.length < options.requiredCount) {
    throw new Error(
      `Insufficient ready BrowserPlan profiles for ${normalizedMachineId}: required ${options.requiredCount}, found ${readyProfiles.length}`,
    );
  }
  return options.readyOnly ? readyProfiles : profiles;
}

export function createBrowserPlanCoverageReport(
  identities: Identity[],
  options: BrowserPlanCoverageOptions = {},
): BrowserPlanCoverageReport {
  const machineIds = (options.machineIds ?? browserPlanDefaultMachineIds).map(normalizeMachineId);
  const excludedMachineIds = (options.excludedMachineIds ?? browserPlanExcludedMachineIds).map(normalizeMachineId);
  const targetPerMachine = options.targetPerMachine ?? 8;
  if (!Number.isInteger(targetPerMachine) || targetPerMachine < 1) {
    throw new Error("targetPerMachine must be a positive integer");
  }

  const machines: BrowserPlanMachineCoverage[] = machineIds.map((machineId) => {
    const assignedIdentities = identities.filter((identity) => hasBrowserPlanMachineAssignment(identity, machineId));
    const profiles = identities.flatMap((identity) => listBrowserPlanProfilesForIdentity(identity, machineId));
    const ready = profiles.filter((profile) => profile.emailReady).length;
    return {
      machineId,
      target: targetPerMachine,
      assigned: assignedIdentities.length,
      withEmail: assignedIdentities.filter((identity) => identity.emails.length > 0).length,
      reserved: profiles.filter((profile) => profile.reservationStatus === "reserved").length,
      ready,
      usable: ready,
      missing: Math.max(0, targetPerMachine - ready),
    };
  });

  return {
    targetPerMachine,
    machines,
    excludedMachineIds,
    totals: {
      machines: machines.length,
      target: machines.length * targetPerMachine,
      usable: machines.reduce((sum, machine) => sum + machine.usable, 0),
      missing: machines.reduce((sum, machine) => sum + machine.missing, 0),
    },
  };
}

function hasBrowserPlanMachineAssignment(identity: Identity, machineId: string): boolean {
  return (identity.machineAssignments ?? []).some((assignment) => isBrowserPlanAssignment(assignment, machineId));
}

function isBrowserPlanAssignment(assignment: IdentityMachineAssignment, machineId: string): boolean {
  return (
    assignment.machineId === machineId &&
    assignment.status !== "released" &&
    (!assignment.purpose || assignment.purpose === "browserplan")
  );
}
