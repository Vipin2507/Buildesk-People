import { useEffect, useMemo, useState } from "react";
import { Banner, Button, DecisionDialog } from "./ui";
import { buildPayslipDto } from "../domain/payslip";
import { formatMoney, rangeLabel } from "../lib/format";
import { downloadBlob } from "../lib/download";
import { downloadPayslipPdf, previewPayslipPdf } from "../lib/payslip-api";
import { useApp } from "../store/store";
import type { Payslip, PayrollRun } from "../types";

export function PayslipWorkbench({
  run,
  employeeId,
  slip,
  onClose,
}: {
  run: PayrollRun;
  employeeId: string;
  slip?: Payslip | null;
  onClose?: () => void;
}) {
  const { state, actions, can } = useApp();
  const manage = can("payroll.manage");
  const built = useMemo(() => buildPayslipDto(state, run, employeeId, {
    slip: slip ?? null,
    official: run.status === "finalized" || run.status === "paid",
  }), [state, run, employeeId, slip]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const currentSlip = slip ?? state.payslips.find((item) => item.runId === run.id && item.employeeId === employeeId && item.status !== "superseded") ?? null;

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      if (!manage) return;
      setBusy("Loading PDF preview…");
      const preview = await previewPayslipPdf(run.id, employeeId);
      if (cancelled) return;
      setBusy("");
      if (!preview.ok) {
        setError(preview.message);
        return;
      }
      const url = URL.createObjectURL(preview.blob);
      revoked = url;
      setPdfUrl(url);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [manage, run.id, employeeId, currentSlip?.version, currentSlip?.status]);

  if (!built.ok) {
    return (
      <div>
        <Banner tone="error">{built.message}</Banner>
        {built.missing && built.missing.length > 0 && (
          <ul className="muted">{built.missing.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
        {onClose && <Button variant="secondary" onClick={onClose}>Close</Button>}
      </div>
    );
  }

  const dto = built.dto;
  const statusLabel = currentSlip?.published
    ? "Published"
    : currentSlip?.status === "generated"
      ? "Generated (not published)"
      : currentSlip?.status === "ready"
        ? "Ready to generate"
        : run.status === "finalized" || run.status === "paid"
          ? "Approved run"
          : "Internal preview";

  return (
    <div className="payslip-workbench">
      <div className="spread">
        <div>
          <strong>{dto.employee.name}</strong>
          <div className="muted">{rangeLabel(dto.periodStart, dto.periodEnd)} · {statusLabel} · Run {labelForStatus(run.status)}</div>
        </div>
        {onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}
      </div>
      {!dto.official && <Banner tone="warning">Internal preview only. Approve the payroll run before generating an official payslip.</Banner>}
      {!built.validation.ok && (
        <Banner tone="error">
          Official generation is blocked until these are fixed: {built.validation.missing.join("; ")}.
        </Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {busy && <Banner tone="info">{busy}</Banner>}

      <div className="payslip-sheet" aria-label="Payslip summary">
        <div className="payslip-sheet-head">
          <h3>{dto.company.legalName}</h3>
          {dto.company.address && <p>{dto.company.address}</p>}
          {dto.company.registrationId && <p>{dto.company.registrationId}</p>}
          <strong>{dto.periodTitle}</strong>
        </div>
        <dl className="dl">
          <dt>Employee Name</dt><dd>{dto.employee.name}</dd>
          <dt>Employee ID</dt><dd>{dto.employee.employeeCode}</dd>
          <dt>Designation</dt><dd>{dto.employee.designation}</dd>
          <dt>Department</dt><dd>{dto.employee.department}</dd>
          <dt>Location</dt><dd>{dto.employee.location}</dd>
          <dt>Paid Days / LOP</dt><dd>{dto.paidDays} / {dto.lopDays}</dd>
        </dl>
        <div className="payslip-cols">
          <table className="data">
            <thead><tr><th>Earnings</th><th>Amount</th></tr></thead>
            <tbody>
              {dto.earnings.map((item) => (
                <tr key={item.key}><td>{item.label}</td><td>{formatMoney(item.amount, dto.company.currency)}</td></tr>
              ))}
              <tr><td><strong>Gross Salary</strong></td><td><strong>{formatMoney(dto.grossEarnings, dto.company.currency)}</strong></td></tr>
            </tbody>
          </table>
          <table className="data">
            <thead><tr><th>Deductions</th><th>Amount</th></tr></thead>
            <tbody>
              {dto.deductions.length === 0 && <tr><td colSpan={2} className="muted">No deductions entered</td></tr>}
              {dto.deductions.map((item) => (
                <tr key={item.key}><td>{item.label}</td><td>{formatMoney(item.amount, dto.company.currency)}</td></tr>
              ))}
              <tr><td><strong>Total Deductions</strong></td><td><strong>{formatMoney(dto.totalDeductions, dto.company.currency)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <div className="payslip-net">
          <strong>NET PAY / IN-HAND SALARY</strong>
          <div>{formatMoney(dto.netPayable, dto.company.currency)}</div>
          <p className="muted">{dto.netPayableWords}</p>
          <p className="faint">{dto.calculationSummary}</p>
        </div>
        {dto.notes && <p className="muted">Notes: {dto.notes}</p>}
        <p className="faint" style={{ textAlign: "center" }}>This is a system-generated payslip and does not require a signature.</p>
      </div>

      {pdfUrl && (
        <iframe title="Payslip PDF preview" className="payslip-pdf-frame" src={pdfUrl} />
      )}

      <div className="actions">
        {manage && (
          <>
            <Button
              variant="secondary"
              disabled={Boolean(busy)}
              onClick={async () => {
                setError("");
                setBusy("Refreshing preview…");
                const preview = await previewPayslipPdf(run.id, employeeId);
                setBusy("");
                if (!preview.ok) {
                  setError(preview.message);
                  return;
                }
                if (pdfUrl) URL.revokeObjectURL(pdfUrl);
                setPdfUrl(URL.createObjectURL(preview.blob));
                downloadBlob(preview.filename, preview.blob);
              }}
            >
              Download preview PDF
            </Button>
            <Button
              disabled={Boolean(busy) || !dto.official || !built.validation.ok}
              onClick={async () => {
                setError("");
                setBusy("Generating official payslip…");
                const result = await actions.generatePayslip(run.id, employeeId);
                setBusy("");
                if (!result.ok) setError(result.message);
              }}
            >
              Generate payslip
            </Button>
            <Button
              variant="secondary"
              disabled={!currentSlip || (currentSlip.status !== "generated" && currentSlip.status !== "published") || Boolean(busy)}
              onClick={() => setPublishOpen(true)}
            >
              Publish to employee
            </Button>
          </>
        )}
        {currentSlip?.documentKey && (manage || currentSlip.published) && (
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await downloadPayslipPdf(currentSlip.id, dto.filename);
              if (!result.ok) setError(result.message);
            }}
          >
            Download PDF
          </Button>
        )}
      </div>

      <DecisionDialog
        open={publishOpen}
        title="Publish payslip?"
        body={`Publish the generated payslip for ${dto.employee.name} (${rangeLabel(dto.periodStart, dto.periodEnd)}) to their profile. They will be able to view and download it.`}
        confirmLabel="Publish payslip"
        onClose={() => setPublishOpen(false)}
        onConfirm={async () => {
          if (!currentSlip) return;
          const result = await actions.publishPayslip(currentSlip.id);
          setPublishOpen(false);
          if (!result.ok) setError(result.message);
        }}
      />
    </div>
  );
}

function labelForStatus(status: PayrollRun["status"]): string {
  if (status === "finalized") return "approved";
  if (status === "in_review") return "in review";
  return status;
}
