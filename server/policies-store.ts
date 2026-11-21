import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTenantContext } from "./tenant/context.ts";

function policiesDirectory(): string {
  const ctx = getTenantContext();
  if (!ctx) throw new Error("Tenant context is required for policy file storage.");
  return join(ctx.dataDir, "policies");
}

function safeKey(key: string): string | null {
  return /^[a-zA-Z0-9._-]+$/.test(key) && key.length <= 200 ? key : null;
}

export function policyFilePath(fileKey: string): string | null {
  const key = safeKey(fileKey);
  if (!key) return null;
  return join(policiesDirectory(), key);
}

export function writePolicyFile(fileKey: string, bytes: Buffer): string | null {
  const file = policyFilePath(fileKey);
  if (!file) return "Invalid policy file key.";
  mkdirSync(policiesDirectory(), { recursive: true });
  writeFileSync(file, bytes);
  return null;
}

export function readPolicyFile(fileKey: string): Buffer | null {
  const file = policyFilePath(fileKey);
  if (!file || !existsSync(file)) return null;
  return readFileSync(file);
}

export function checksumBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function makePolicyFileKey(policyId: string, versionId: string, originalName: string): string {
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")).toLowerCase().replace(/[^a-z0-9.]/g, "") : "";
  const safePol = policyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeVer = versionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const nonce = randomBytes(4).toString("hex");
  return `${safePol}_${safeVer}_${nonce}${ext || ".bin"}`;
}

export function contentTypeForName(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
