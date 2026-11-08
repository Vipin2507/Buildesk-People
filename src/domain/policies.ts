import type { Employee, Policy, PolicyVersion } from "../types";

export function policyApplies(policy: Policy, employee: Employee): boolean {
  if (policy.audience.kind === "all") return true;
  if (policy.audience.kind === "location") return employee.locationId === policy.audience.locationId;
  return employee.departmentId === policy.audience.departmentId;
}

export function publishedVersion(policy: Policy): PolicyVersion | undefined {
  return [...policy.versions].reverse().find((item) => item.publishedAt);
}

export function latestVersion(policy: Policy): PolicyVersion | undefined {
  return policy.versions[policy.versions.length - 1];
}

export function audienceLabel(policy: Policy, locationName: (id: string) => string, departmentName: (id: string) => string): string {
  if (policy.audience.kind === "all") return "All employees";
  if (policy.audience.kind === "location") return locationName(policy.audience.locationId);
  return departmentName(policy.audience.departmentId);
}
