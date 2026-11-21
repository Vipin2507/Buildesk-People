import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTenantContext } from "./tenant/context.ts";

function payslipsDirectory(): string {
  const ctx = getTenantContext();
  if (!ctx) throw new Error("Tenant context is required for payslip storage.");
  return join(ctx.dataDir, "payslips");
}

function safeKey(key: string): string | null {
  return /^[a-zA-Z0-9._-]+$/.test(key) && key.length <= 180 ? key : null;
}

export function payslipPath(documentKey: string): string | null {
  const key = safeKey(documentKey);
  if (!key) return null;
  return join(payslipsDirectory(), key);
}

export function writePayslipPdf(documentKey: string, bytes: Buffer): string | null {
  const file = payslipPath(documentKey);
  if (!file) return "Invalid payslip document key.";
  mkdirSync(payslipsDirectory(), { recursive: true });
  writeFileSync(file, bytes);
  return null;
}

export function readPayslipPdf(documentKey: string): Buffer | null {
  const file = payslipPath(documentKey);
  if (!file || !existsSync(file)) return null;
  return readFileSync(file);
}

export function makeDocumentKey(slipId: string, version: number): string {
  const safeId = slipId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeId}_v${Math.max(1, version)}.pdf`;
}
