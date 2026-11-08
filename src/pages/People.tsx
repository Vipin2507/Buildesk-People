import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmployeeForm } from "../components/employee-form";
import { Button, DataTable, Modal, PageHeader, Pager, PersonLink, StatusBadge, usePage } from "../components/ui";
import { fullName, labelFor } from "../lib/format";
import { useApp } from "../store/store";
import type { Employee } from "../types";

export function People() {
  const { state, can } = useApp();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState("active");
  const [sort, setSort] = useState<"name" | "department" | "joined">("name");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(params.get("add") === "1" && can("people.manage"));
  const closeAdd = () => {
    setAdding(false);
    if (params.get("add")) {
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
  };
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.employees
      .filter((item) => {
        if (status === "active" && item.status === "inactive") return false;
        if (status !== "all" && status !== "active" && item.status !== status) return false;
        if (department !== "all" && item.departmentId !== department) return false;
        if (location !== "all" && item.locationId !== location) return false;
        if (!q) return true;
        return `${item.firstName} ${item.lastName} ${item.employeeCode} ${item.jobTitle} ${item.email}`.toLowerCase().includes(q);
      })
      .sort((a, b) => compare(a, b, sort, state));
  }, [state, query, department, location, status, sort]);
  const page = usePage(rows, 8, `${query}|${department}|${location}|${status}|${sort}`);
  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Find employees, open a profile, or review the reporting structure."
        actions={
          <>
            <Link className="btn btn-secondary" to="/people/org">Organization chart</Link>
            {can("people.manage") && <Button onClick={() => setAdding(true)}>Add employee</Button>}
          </>
        }
      />
      <div className="filters">
        <label className="field">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID, title, email" /></label>
        <label className="field">Department
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All departments</option>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Location
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="all">All locations</option>
            {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="active">Active and on notice</option>
            <option value="on_notice">On notice</option>
            <option value="inactive">Inactive</option>
            <option value="all">Everyone</option>
          </select>
        </label>
        <label className="field">Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
            <option value="name">Name</option>
            <option value="department">Department</option>
            <option value="joined">Joining date</option>
          </select>
        </label>
      </div>
      <DataTable
        caption="Employee directory"
        rows={page.slice}
        rowKey={(row) => row.id}
        emptyTitle="No employees match"
        emptyBody="Try a different name, department, location, or status."
        columns={[
          { key: "name", header: "Employee", render: (row) => <PersonLink name={fullName(row)} color={row.avatarColor} to={`/people/${row.id}`} meta={row.employeeCode} /> },
          { key: "title", header: "Title", render: (row) => row.jobTitle },
          { key: "dept", header: "Department", render: (row) => state.departments.find((item) => item.id === row.departmentId)?.name ?? "—" },
          { key: "loc", header: "Location", render: (row) => state.locations.find((item) => item.id === row.locationId)?.name ?? "—" },
          { key: "manager", header: "Manager", render: (row) => state.employees.find((item) => item.id === row.managerId) ? fullName(state.employees.find((item) => item.id === row.managerId)!) : "—" },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          { key: "type", header: "Type", render: (row) => labelFor(row.employmentType) },
        ]}
      />
      <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
      <Modal open={adding} title="Add employee" onClose={closeAdd}>
        <EmployeeForm onDone={closeAdd} />
      </Modal>
    </div>
  );
}

function compare(a: Employee, b: Employee, sort: "name" | "department" | "joined", state: { departments: { id: string; name: string }[] }) {
  if (sort === "joined") return b.joiningDate.localeCompare(a.joiningDate);
  if (sort === "department") {
    const left = state.departments.find((item) => item.id === a.departmentId)?.name ?? "";
    const right = state.departments.find((item) => item.id === b.departmentId)?.name ?? "";
    return left.localeCompare(right) || fullName(a).localeCompare(fullName(b));
  }
  return fullName(a).localeCompare(fullName(b));
}
