import type { AppState, Result } from "../types";
import type { ToastTone } from "../store/mutations";
import { request } from "./api";

export type PayslipActionResult = Result & {
  slipId?: string;
  version?: number;
  filename?: string;
  generated?: number;
  failed?: number;
  failures?: Array<{ employeeId: string; message: string }>;
  missing?: string[];
};

function asResult(payload: { ok?: boolean; result?: Result; message?: string }): Result {
  if (payload.result) return payload.result;
  if (payload.ok) return { ok: true };
  return { ok: false, message: payload.message ?? "The payslip request failed." };
}

export async function previewPayslipPdf(runId: string, employeeId: string): Promise<{ ok: true; blob: Blob; filename: string } | { ok: false; message: string; missing?: string[] }> {
  const response = await fetch("/api/payslips/preview", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, employeeId }),
  });
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("pdf")) {
    const payload = await response.json().catch(() => ({})) as { message?: string; missing?: string[] };
    return { ok: false, message: payload.message ?? "Payslip preview failed.", missing: payload.missing };
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  return { ok: true, blob: await response.blob(), filename: match?.[1] ?? "payslip-preview.pdf" };
}

export async function generatePayslipPdf(
  runId: string,
  employeeId: string,
): Promise<{ result: PayslipActionResult; toast?: string; tone?: ToastTone; state?: AppState | null }> {
  const { payload } = await request("/api/payslips/generate", { runId, employeeId });
  const data = payload as {
    ok?: boolean;
    result?: Result;
    message?: string;
    toast?: string;
    tone?: ToastTone;
    state?: AppState | null;
    slipId?: string;
    version?: number;
    filename?: string;
  };
  const result = asResult(data);
  return {
    result: result.ok
      ? { ...result, slipId: data.slipId, version: data.version, filename: data.filename }
      : { ...result, slipId: data.slipId, version: data.version, filename: data.filename },
    toast: data.toast,
    tone: data.tone,
    state: data.state,
  };
}

export async function generatePayslipBatch(
  runId: string,
): Promise<{ result: PayslipActionResult; toast?: string; tone?: ToastTone; state?: AppState | null }> {
  const { payload } = await request("/api/payslips/generate-batch", { runId });
  const data = payload as {
    ok?: boolean;
    message?: string;
    toast?: string;
    tone?: ToastTone;
    state?: AppState | null;
    generated?: number;
    failed?: number;
    failures?: Array<{ employeeId: string; message: string }>;
  };
  const result: PayslipActionResult = data.ok
    ? { ok: true, generated: data.generated, failed: data.failed, failures: data.failures }
    : { ok: false, message: data.toast ?? data.message ?? "Batch payslip generation failed.", generated: data.generated, failed: data.failed, failures: data.failures };
  return {
    result,
    toast: data.toast,
    tone: data.tone,
    state: data.state,
  };
}

export async function downloadPayslipPdf(slipId: string, filename: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await fetch(`/api/payslips/${encodeURIComponent(slipId)}/pdf`, {
    method: "GET",
    credentials: "include",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    return { ok: false, message: payload.message ?? "Payslip download failed." };
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}
