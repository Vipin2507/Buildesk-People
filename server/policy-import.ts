import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  ALLOWED_POLICY_UPLOAD,
  categoryForImportTitle,
  titleFromPolicyFilename,
  versionFromFilename,
} from "../src/domain/policies.ts";
import { nowIso, uid } from "../src/domain/dates.ts";
import type { AppState, Policy } from "../src/types.ts";
import { extractPolicyDocument } from "./policy-extract.ts";
import { checksumBytes, contentTypeForName, makePolicyFileKey, readPolicyFile, writePolicyFile } from "./policies-store.ts";

export const HR_POLICIES_FOLDER = join(process.cwd(), "HR Policies");

export type ImportReportItem = {
  fileName: string;
  ok: boolean;
  message: string;
  policyId?: string;
  skippedDuplicate?: boolean;
};

function allowedExtension(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  return ALLOWED_POLICY_UPLOAD.extensions.includes(ext);
}

function sourceKeyFor(fileName: string, checksum: string): string {
  return `hr-policies:${fileName.toLowerCase()}:${checksum.slice(0, 16)}`;
}

/** Import DOCX/PDF/TXT from the local HR Policies folder. Idempotent by filename+checksum. */
export async function importHrPoliciesFolder(state: AppState, actorId: string): Promise<{ state: AppState; report: ImportReportItem[] }> {
  const report: ImportReportItem[] = [];
  if (!existsSync(HR_POLICIES_FOLDER)) {
    return {
      state,
      report: [{ fileName: "HR Policies", ok: false, message: `Folder not found at ${HR_POLICIES_FOLDER}.` }],
    };
  }

  const entries = readdirSync(HR_POLICIES_FOLDER)
    .filter((name) => !name.startsWith(".") && !name.toLowerCase().endsWith(".zip"))
    .filter((name) => {
      try {
        return statSync(join(HR_POLICIES_FOLDER, name)).isFile();
      } catch {
        return false;
      }
    });

  if (entries.length === 0) {
    return { state, report: [{ fileName: "HR Policies", ok: false, message: "No policy files found in the folder." }] };
  }

  let policies = [...state.policies];
  const at = nowIso();

  for (const fileName of entries) {
    if (!allowedExtension(fileName)) {
      report.push({ fileName, ok: false, message: `Unsupported type (${extname(fileName)}). Allowed: ${ALLOWED_POLICY_UPLOAD.extensions.join(", ")}.` });
      continue;
    }
    const full = join(HR_POLICIES_FOLDER, fileName);
    let bytes: Buffer;
    try {
      bytes = readFileSync(full);
    } catch (error) {
      report.push({ fileName, ok: false, message: error instanceof Error ? error.message : "Could not read file." });
      continue;
    }
    if (bytes.length > ALLOWED_POLICY_UPLOAD.maxBytes) {
      report.push({ fileName, ok: false, message: `File exceeds ${Math.round(ALLOWED_POLICY_UPLOAD.maxBytes / (1024 * 1024))} MB limit.` });
      continue;
    }
    const checksum = checksumBytes(bytes);
    const importSourceKey = sourceKeyFor(basename(fileName), checksum);
    const existing = policies.find((item) => item.importSourceKey === importSourceKey
      || item.versions.some((ver) => ver.checksum === checksum)
      || item.versions.some((ver) => (ver.fileName || "").toLowerCase() === fileName.toLowerCase()));
    if (existing) {
      report.push({
        fileName,
        ok: true,
        skippedDuplicate: true,
        policyId: existing.id,
        message: `Already imported as “${existing.title}” — skipped to avoid duplicates.`,
      });
      continue;
    }

    const title = titleFromPolicyFilename(fileName);
    const category = categoryForImportTitle(title);
    const versionLabel = versionFromFilename(fileName);
    const policyId = uid("pol");
    const versionId = uid("pver");
    const fileKey = makePolicyFileKey(policyId, versionId, fileName);
    const writeError = writePolicyFile(fileKey, bytes);
    if (writeError) {
      report.push({ fileName, ok: false, message: writeError });
      continue;
    }

    const extracted = await extractPolicyDocument(bytes, fileName);
    const policy: Policy = {
      id: policyId,
      title,
      category,
      status: "needs_review",
      audience: { kind: "all" },
      versions: [{
        id: versionId,
        version: versionLabel,
        summary: "",
        content: extracted.content,
        contentHtml: extracted.contentHtml,
        renderStatus: extracted.renderStatus,
        fileName,
        fileKey,
        fileSize: bytes.length,
        contentType: contentTypeForName(fileName),
        checksum,
        effectiveDate: "",
        reviewDate: null,
        publishedAt: null,
        createdAt: at,
        createdBy: actorId,
      }],
      updatedAt: at,
      createdAt: at,
      createdBy: actorId,
      ownerId: actorId,
      requiresAcknowledgement: false,
      keywords: [title, category, fileName.replace(/\.[^.]+$/, "")],
      importSourceKey,
      sensitive: category === "Grievance",
    };
    policies = [policy, ...policies];
    report.push({
      fileName,
      ok: true,
      policyId,
      message: extracted.ok
        ? `Imported as Needs review · ${category} · version ${versionLabel}. In-app text ready (${extracted.renderStatus}). Not published.`
        : `Imported as Needs review · ${category}. ${extracted.message} Not published.`,
    });
  }

  const imported = report.filter((item) => item.ok && !item.skippedDuplicate).length;
  const audits = imported > 0
    ? [{
        id: uid("aud"),
        at,
        actorId,
        area: "policies" as const,
        summary: `Imported ${imported} policy document(s) from HR Policies folder.`,
        scope: "general" as const,
      }, ...state.audits]
    : state.audits;

  return {
    state: { ...state, policies, audits },
    report,
  };
}

/** Re-extract content for versions that have a stored file but empty/unavailable render. Also clears invented import summaries. */
export async function backfillPolicyExtractionsContent(state: AppState): Promise<{ state: AppState; updated: number }> {
  let updated = 0;
  const policies: Policy[] = [];
  for (const policy of state.policies) {
    let changed = false;
    const versions = [];
    for (const version of policy.versions) {
      let next = { ...version };
      if (/pending HR review|imported source document/i.test(next.summary || "")) {
        next = { ...next, summary: "" };
        changed = true;
      }
      const needsExtract = Boolean(next.fileKey)
        && (!next.contentHtml || !next.content || next.renderStatus === "unavailable" || next.renderStatus === "pending" || !next.renderStatus);
      if (needsExtract && next.fileKey) {
        const bytes = readPolicyFile(next.fileKey);
        if (bytes) {
          const extracted = await extractPolicyDocument(bytes, next.fileName || "document.docx");
          next = {
            ...next,
            content: extracted.content || next.content,
            contentHtml: extracted.contentHtml,
            renderStatus: extracted.renderStatus,
          };
          changed = true;
        }
      }
      versions.push(next);
    }
    if (changed) {
      updated += 1;
      policies.push({ ...policy, versions, updatedAt: nowIso() });
    } else {
      policies.push(policy);
    }
  }
  return { state: { ...state, policies }, updated };
}

export function folderChecksumPreview(): { fileName: string; checksum: string; bytes: number }[] {
  if (!existsSync(HR_POLICIES_FOLDER)) return [];
  return readdirSync(HR_POLICIES_FOLDER)
    .filter((name) => allowedExtension(name))
    .map((fileName) => {
      const bytes = readFileSync(join(HR_POLICIES_FOLDER, fileName));
      return { fileName, checksum: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
    });
}
