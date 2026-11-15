import type { Employee, Policy, PolicyAudience, PolicyStatus, PolicyVersion } from "../types";

export const POLICY_CATEGORIES = [
  "Attendance",
  "Leave",
  "Payroll",
  "Expenses",
  "Assets",
  "Conduct",
  "Grievance",
  "Exit",
  "Workplace",
  "Other",
] as const;

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: "Draft",
  needs_review: "Needs review",
  published: "Published",
  archived: "Archived",
  superseded: "Superseded",
};

export const ALLOWED_POLICY_UPLOAD = {
  extensions: [".pdf", ".docx", ".doc", ".txt"],
  mime: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
  ],
  maxBytes: 15 * 1024 * 1024,
};

export function policyApplies(policy: Policy, employee: Employee): boolean {
  if (policy.audience.kind === "all") return true;
  if (policy.audience.kind === "location") return employee.locationId === policy.audience.locationId;
  if (policy.audience.kind === "department") return employee.departmentId === policy.audience.departmentId;
  if (policy.audience.kind === "employment_type") return employee.employmentType === policy.audience.employmentType;
  return false;
}

/** Current instruction for employees — published only. */
export function isCurrentPublished(policy: Policy): boolean {
  return policy.status === "published";
}

export function publishedVersion(policy: Policy): PolicyVersion | undefined {
  return [...policy.versions].reverse().find((item) => item.publishedAt);
}

export function latestVersion(policy: Policy): PolicyVersion | undefined {
  return policy.versions[policy.versions.length - 1];
}

export function draftVersion(policy: Policy): PolicyVersion | undefined {
  return [...policy.versions].reverse().find((item) => !item.publishedAt);
}

export function audienceLabel(
  policy: Policy,
  locationName: (id: string) => string,
  departmentName: (id: string) => string,
): string {
  if (policy.audience.kind === "all") return "All employees";
  if (policy.audience.kind === "location") return locationName(policy.audience.locationId);
  if (policy.audience.kind === "department") return departmentName(policy.audience.departmentId);
  if (policy.audience.kind === "employment_type") {
    return policy.audience.employmentType === "contract" ? "Contract employees" : "Full-time employees";
  }
  return "Restricted audience";
}

export function normalizePolicy(policy: Policy): Policy {
  return {
    ...policy,
    requiresAcknowledgement: Boolean(policy.requiresAcknowledgement),
    keywords: Array.isArray(policy.keywords) ? policy.keywords : [],
    ownerId: policy.ownerId ?? null,
    createdAt: policy.createdAt ?? policy.updatedAt,
    createdBy: policy.createdBy ?? null,
    importSourceKey: policy.importSourceKey ?? null,
    sensitive: Boolean(policy.sensitive ?? policy.category === "Grievance"),
    versions: policy.versions.map((item) => ({
      ...item,
      fileKey: item.fileKey ?? null,
      fileSize: item.fileSize ?? null,
      contentType: item.contentType ?? null,
      checksum: item.checksum ?? null,
      reviewDate: item.reviewDate ?? null,
      createdAt: item.createdAt ?? policy.updatedAt,
      createdBy: item.createdBy ?? null,
    })),
  };
}

export function policySearchText(policy: Policy): string {
  const current = publishedVersion(policy) ?? latestVersion(policy);
  return [
    policy.title,
    policy.category,
    policy.status,
    ...(policy.keywords ?? []),
    current?.version,
    current?.summary,
    current?.content,
    current?.fileName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function nextPolicyVersion(policy: Policy): string {
  const latest = policy.versions[policy.versions.length - 1]?.version ?? "1.0";
  if (latest === "Unspecified" || !/^\d+(\.\d+)?$/.test(latest)) return "1.0";
  const parts = latest.split(".").map(Number);
  const major = parts[0] || 1;
  const minor = parts[1] ?? 0;
  return `${major}.${minor + 1}`;
}

export function versionLabel(version: string): string {
  return version === "Unspecified" || !version ? "Unspecified" : version;
}

export function categoryForImportTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("grievance")) return "Grievance";
  if (t.includes("attendance") || t.includes("punctuality")) return "Attendance";
  if (t.includes("maternity") || t.includes("paternity") || t.includes("leave") || t.includes("time-off") || t.includes("time off")) return "Leave";
  if (t.includes("payroll") || t.includes("salary")) return "Payroll";
  if (t.includes("expense") || t.includes("reimbursement")) return "Expenses";
  if (t.includes("asset") || t.includes("productivity")) return "Assets";
  if (t.includes("conduct")) return "Conduct";
  if (t.includes("resignation") || t.includes("termination") || (t.includes("full") && t.includes("final")) || t.includes("settlement")) return "Exit";
  return "Workplace";
}

export function titleFromPolicyFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base
    .replace(/^Buildesk[_-]?/i, "")
    .replace(/_Policy(_v[\d.]+.*)?$/i, "")
    .replace(/_v[\d.]+.*$/i, "")
    .replace(/_With_Punctuality$/i, "")
    .replace(/_Final$/i, "")
    .replace(/_Revised$/i, "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim() || fileName;
}

export function versionFromFilename(fileName: string): string {
  const match = fileName.match(/_v(\d+(?:\.\d+)?)/i);
  return match?.[1] ?? "Unspecified";
}

export function validateAudience(state: { locations: { id: string }[]; departments: { id: string }[] }, audience: PolicyAudience): string | null {
  if (audience.kind === "all") return null;
  if (audience.kind === "location" && !state.locations.some((item) => item.id === audience.locationId)) return "Choose a location for this policy.";
  if (audience.kind === "department" && !state.departments.some((item) => item.id === audience.departmentId)) return "Choose a department for this policy.";
  if (audience.kind === "employment_type" && audience.employmentType !== "full_time" && audience.employmentType !== "contract") {
    return "Choose an employment type.";
  }
  return null;
}

export function employeeCanViewPolicy(policy: Policy, employee: Employee, manage: boolean): boolean {
  if (manage) return true;
  if (!isCurrentPublished(policy)) return false;
  return policyApplies(policy, employee);
}

/** Never show import/admin review copy as an employee-facing summary. */
export function employeeFacingSummary(summary: string | undefined | null): string {
  const text = (summary || "").trim();
  if (!text) return "";
  if (/pending HR review|imported source|needs review|not published/i.test(text)) return "";
  return text;
}

export function isUpcomingEffective(effectiveDate: string, today: string): boolean {
  return Boolean(effectiveDate && effectiveDate > today);
}

export function canRenderInApp(version: PolicyVersion | undefined | null): boolean {
  if (!version) return false;
  if (version.contentHtml && version.contentHtml.trim().length > 40) return true;
  if (version.content && version.content.trim().length > 40) return true;
  return false;
}

export function extractTocFromHtml(html: string): { id: string; label: string; level: number }[] {
  const items: { id: string; label: string; level: number }[] = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(html)) && index < 40) {
    const label = match[2].replace(/<[^>]+>/g, "").trim();
    if (!label) continue;
    const id = `section-${index + 1}`;
    items.push({ id, label, level: Number(match[1]) });
    index += 1;
  }
  return items;
}

/** Inject stable ids into heading tags for TOC anchors. */
export function withHeadingIds(html: string): string {
  let index = 0;
  return html.replace(/<h([1-3])([^>]*)>/gi, (_full, level: string, attrs: string) => {
    index += 1;
    if (/\sid=/i.test(attrs)) return `<h${level}${attrs}>`;
    return `<h${level}${attrs} id="section-${index}">`;
  });
}

export function publishChecklist(policy: Policy): { id: string; label: string; ok: boolean }[] {
  const draft = draftVersion(policy) ?? latestVersion(policy);
  return [
    { id: "title", label: "Title is clear", ok: policy.title.trim().length >= 3 },
    { id: "category", label: "Category is set", ok: policy.category.trim().length >= 2 },
    { id: "version", label: "Version is set (not Unspecified)", ok: Boolean(draft?.version && draft.version !== "Unspecified") },
    { id: "effective", label: "Effective date is set", ok: Boolean(draft?.effectiveDate) },
    { id: "audience", label: "Audience is configured", ok: Boolean(policy.audience?.kind) },
    {
      id: "content",
      label: "In-app content or source file is present",
      ok: Boolean((draft?.content && draft.content.trim().length >= 20) || draft?.contentHtml || draft?.fileKey || draft?.fileName),
    },
  ];
}
