import type { Employee } from "../types";

export interface OrgNode {
  employee: Employee;
  reports: OrgNode[];
}

export function orgTree(employees: Employee[], includeInactive: boolean): OrgNode[] {
  const visible = employees.filter((item) => includeInactive || item.status !== "inactive");
  const nodes = new Map<string, OrgNode>(visible.map((employee) => [employee.id, { employee, reports: [] }]));
  const roots: OrgNode[] = [];
  visible.forEach((employee) => {
    const node = nodes.get(employee.id);
    if (!node) return;
    const manager = employee.managerId ? nodes.get(employee.managerId) : undefined;
    if (manager) manager.reports.push(node);
    else roots.push(node);
  });
  const sortNodes = (list: OrgNode[]) => {
    list.sort((a, b) => a.employee.firstName.localeCompare(b.employee.firstName) || a.employee.lastName.localeCompare(b.employee.lastName));
    list.forEach((item) => sortNodes(item.reports));
  };
  sortNodes(roots);
  return roots;
}

export function createsCycle(employees: Employee[], employeeId: string, managerId: string | null): boolean {
  if (!managerId) return false;
  if (managerId === employeeId) return true;
  const seen = new Set<string>();
  let cursor: string | null = managerId;
  while (cursor) {
    if (cursor === employeeId || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = employees.find((item) => item.id === cursor)?.managerId ?? null;
  }
  return false;
}
