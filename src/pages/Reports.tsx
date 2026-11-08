import { useState } from "react";
import { Banner, Button, DataTable, PageHeader } from "../components/ui";
import { addDays, todayIso } from "../domain/dates";
import { downloadCsv } from "../lib/download";
import { fullName, labelFor } from "../lib/format";
import { useApp } from "../store/store";

type ReportId = "attendance" | "leave" | "expenses" | "tickets" | "assets" | "payroll" | "headcount";

export function Reports() {
  const { state, user, can } = useApp();
  const [report, setReport] = useState<ReportId>("attendance");
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [department, setDepartment] = useState("all");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;
  const options: { id: ReportId; label: string; show: boolean }[] = [
    { id: "attendance", label: "Attendance", show: true },
    { id: "leave", label: "Leave", show: true },
    { id: "expenses", label: "Expenses", show: true },
    { id: "tickets", label: "Tickets", show: true },
    { id: "assets", label: "Assets", show: true },
    { id: "headcount", label: "Headcount", show: can("reports.org") || can("reports.team") },
    { id: "payroll", label: "Payroll register", show: can("reports.payroll") },
  ];
  const build = (): string[][] => {
    const people = state.employees.filter((item) => {
      if (department !== "all" && item.departmentId !== department) return false;
      if (can("reports.org") || can("reports.payroll")) return true;
      if (can("reports.team") && (item.managerId === user.id || item.id === user.id)) return true;
      return item.id === user.id;
    });
    const ids = new Set(people.map((item) => item.id));
    if (report === "headcount") {
      return [["Employee", "Department", "Location", "Title", "Status"], ...people.map((item) => [fullName(item), dept(item.departmentId), loc(item.locationId), item.jobTitle, labelFor(item.status)])];
    }
    if (report === "attendance") {
      return [["Employee", "Date", "Status", "In", "Out", "Location"], ...state.attendance.filter((item) => ids.has(item.employeeId) && item.date >= from && item.date <= to).map((item) => [name(item.employeeId), item.date, labelFor(item.status), item.clockIn ?? "", item.clockOut ?? "", item.workMode ? labelFor(item.workMode) : ""])];
    }
    if (report === "leave") {
      return [["Employee", "Type", "Start", "End", "Days", "Status"], ...state.leaveRequests.filter((item) => ids.has(item.employeeId) && item.startDate <= to && item.endDate >= from).map((item) => [name(item.employeeId), state.settings.leaveTypes.find((type) => type.id === item.typeId)?.name ?? item.typeId, item.startDate, item.endDate, String(item.days), labelFor(item.status)])];
    }
    if (report === "expenses") {
      return [["Employee", "Date", "Category", "Amount", "Status", "Description"], ...state.expenses.filter((item) => ids.has(item.employeeId) && item.date >= from && item.date <= to).map((item) => [name(item.employeeId), item.date, item.category, String(item.amount), labelFor(item.status), item.description])];
    }
    if (report === "tickets") {
      return [["Number", "Requester", "Category", "Priority", "Status", "Subject"], ...state.tickets.filter((item) => ids.has(item.employeeId)).map((item) => [item.number, name(item.employeeId), item.category, labelFor(item.priority), labelFor(item.status), item.subject])];
    }
    if (report === "assets") {
      const assets = state.assets.filter((item) => !item.assignedTo || ids.has(item.assignedTo) || can("reports.org"));
      return [["Tag", "Name", "Type", "Status", "Assigned to"], ...assets.map((item) => [item.tag, item.name, labelFor(item.type), labelFor(item.status), item.assignedTo ? name(item.assignedTo) : ""])];
    }
    return [["Employee", "Period", "Gross", "Adjustment", "Reimbursement", "Payable"], ...state.payslips.filter((item) => ids.has(item.employeeId) && item.periodEnd >= from && item.periodStart <= to).map((item) => [name(item.employeeId), `${item.periodStart} to ${item.periodEnd}`, String(item.monthlyGross), String(item.adjustment), String(item.reimbursement), String(item.payable)])];
  };
  const name = (id: string) => {
    const person = state.employees.find((item) => item.id === id);
    return person ? fullName(person) : id;
  };
  const dept = (id: string) => state.departments.find((item) => item.id === id)?.name ?? "";
  const loc = (id: string) => state.locations.find((item) => item.id === id)?.name ?? "";
  return (
    <div>
      <PageHeader title="Reports" subtitle="Exports respect your role. Payroll amounts stay out of general reports." />
      <section className="panel">
        <div className="filters">
          <label className="field">Report
            <select value={report} onChange={(event) => { setReport(event.target.value as ReportId); setRows(null); }}>
              {options.filter((item) => item.show).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="field">To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label className="field">Department
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="all">All departments</option>
              {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <Button onClick={() => {
            setLoading(true);
            setError("");
            window.setTimeout(() => {
              try {
                setRows(build());
              } catch {
                setError("The report could not be prepared.");
                setRows(null);
              } finally {
                setLoading(false);
              }
            }, 250);
          }}>{loading ? "Preparing…" : "Generate"}</Button>
        </div>
        {report === "payroll" && <Banner tone="info">This register includes demo compensation and is limited to payroll roles.</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        {!rows && !loading && <p className="muted">Choose a report and select Generate. You'll get a preview and a CSV download.</p>}
        {rows && rows.length <= 1 && <p className="muted">No rows match those filters.</p>}
        {rows && rows.length > 1 && (
          <>
            <div className="spread">
              <p className="muted">{rows.length - 1} rows · showing the first {Math.min(12, rows.length - 1)}</p>
              <Button variant="secondary" onClick={() => downloadCsv(`buildesk-${report}-${from}.csv`, rows)}>Download CSV</Button>
            </div>
            <DataTable
              caption={`${report} report preview`}
              rows={rows.slice(1, 13).map((row, index) => ({ id: String(index), cells: row }))}
              rowKey={(row) => row.id}
              emptyTitle="No rows"
              emptyBody="Nothing matched."
              columns={rows[0].map((header, index) => ({ key: header + index, header, render: (row: { cells: string[] }) => row.cells[index] }))}
            />
          </>
        )}
      </section>
    </div>
  );
}
