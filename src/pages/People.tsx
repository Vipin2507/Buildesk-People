import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { EmployeeForm } from "../components/employee-form";
import { Button, DataTable, EmptyState, Modal, PageHeader, Pager, PersonLink, StatusBadge, usePage } from "../components/ui";
import { fullName, labelFor } from "../lib/format";
import { photoSrc } from "../lib/photo";
import { useApp } from "../store/store";
import type { Employee } from "../types";

const FILTER_KEY = "buildesk-people-directory";

type SortKey = "name" | "department" | "location" | "status";

type Filters = {
  q: string;
  department: string;
  location: string;
  status: string;
  type: string;
  sort: SortKey;
};

const DEFAULTS: Filters = { q: "", department: "all", location: "all", status: "active", type: "all", sort: "name" };

function readStored(): Filters | null {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    if (!raw) return null;
    return normalizeFilters(JSON.parse(raw) as Partial<Filters>);
  } catch {
    return null;
  }
}

function normalizeFilters(input: Partial<Filters> | null | undefined): Filters {
  const sort = input?.sort;
  return {
    q: typeof input?.q === "string" ? input.q : "",
    department: input?.department || "all",
    location: input?.location || "all",
    status: input?.status || "active",
    type: input?.type || "all",
    sort: sort === "department" || sort === "location" || sort === "status" || sort === "name" ? sort : "name",
  };
}

function filtersFromSearch(params: URLSearchParams): Filters | null {
  const keys = ["q", "department", "location", "status", "type", "sort"];
  if (!keys.some((key) => params.has(key))) return null;
  return normalizeFilters({
    q: params.get("q") ?? "",
    department: params.get("department") ?? "all",
    location: params.get("location") ?? "all",
    status: params.get("status") ?? "active",
    type: params.get("type") ?? "all",
    sort: (params.get("sort") ?? "name") as SortKey,
  });
}

export function People() {
  const { state, can } = useApp();
  const [params, setParams] = useSearchParams();
  const initial = filtersFromSearch(params) ?? readStored() ?? DEFAULTS;
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState(initial.q);
  const [adding, setAdding] = useState(params.get("add") === "1" && can("people.manage"));
  const closeAdd = () => {
    setAdding(false);
    if (params.get("add")) {
      const next = new URLSearchParams(params);
      next.delete("add");
      setParams(next, { replace: true });
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    setParams((current) => {
      const next = new URLSearchParams();
      if (filters.q) next.set("q", filters.q);
      if (filters.department !== "all") next.set("department", filters.department);
      if (filters.location !== "all") next.set("location", filters.location);
      if (filters.status !== "active") next.set("status", filters.status);
      if (filters.type !== "all") next.set("type", filters.type);
      if (filters.sort !== "name") next.set("sort", filters.sort);
      if (current.get("add") === "1") next.set("add", "1");
      return next.toString() === current.toString() ? current : next;
    }, { replace: true });
  }, [filters, setParams]);

  const departments = state.departments.filter((item) => state.employees.some((person) => person.departmentId === item.id));
  const locations = state.locations.filter((item) => state.employees.some((person) => person.locationId === item.id));
  const types = [...new Set(state.employees.map((item) => item.employmentType))];
  const statuses = new Set(state.employees.map((item) => item.status));
  const filtered = filters.q.trim() || filters.department !== "all" || filters.location !== "all" || filters.status !== "active" || filters.type !== "all" || filters.sort !== "name";

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return state.employees
      .filter((item) => {
        if (filters.status === "active" && item.status === "inactive") return false;
        if (filters.status !== "all" && filters.status !== "active" && item.status !== filters.status) return false;
        if (filters.department !== "all" && item.departmentId !== filters.department) return false;
        if (filters.location !== "all" && item.locationId !== filters.location) return false;
        if (filters.type !== "all" && item.employmentType !== filters.type) return false;
        if (!q) return true;
        return `${item.firstName} ${item.lastName} ${item.employeeCode} ${item.jobTitle} ${item.email}`.toLowerCase().includes(q);
      })
      .sort((a, b) => compare(a, b, filters.sort, state));
  }, [state, filters]);
  const page = usePage(rows, 12, `${filters.q}|${filters.department}|${filters.location}|${filters.status}|${filters.type}|${filters.sort}`);
  const clear = () => {
    setSearch("");
    setFilters(DEFAULTS);
  };
  const chips = [
    filters.q.trim() ? { key: "q", label: `Search: ${filters.q.trim()}` } : null,
    filters.department !== "all" ? { key: "department", label: departments.find((item) => item.id === filters.department)?.name ?? "Department" } : null,
    filters.location !== "all" ? { key: "location", label: locations.find((item) => item.id === filters.location)?.name ?? "Location" } : null,
    filters.status !== "active" ? { key: "status", label: filters.status === "all" ? "Everyone" : labelFor(filters.status) } : null,
    filters.type !== "all" ? { key: "type", label: labelFor(filters.type) } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Search the directory, then open a profile for the person you need."
        actions={
          <>
            <Link className="btn btn-secondary" to="/people/org">Organization chart</Link>
            {can("people.manage") && <Button onClick={() => setAdding(true)}>Add employee</Button>}
          </>
        }
      />
      <div className="filters directory-filters">
        <label className="field">Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, ID, title, or email" aria-label="Search by name, ID, title, or email" />
        </label>
        {departments.length > 0 && (
          <label className="field">Department
            <select aria-label="Department" value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
              <option value="all">All departments</option>
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        {locations.length > 0 && (
          <label className="field">Location
            <select aria-label="Location" value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })}>
              <option value="all">All locations</option>
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">Status
          <select aria-label="Employment status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            {(statuses.has("active") || statuses.has("on_notice")) && <option value="active">Active and on notice</option>}
            {statuses.has("on_notice") && <option value="on_notice">On notice</option>}
            {statuses.has("inactive") && <option value="inactive">Inactive</option>}
            <option value="all">Everyone</option>
          </select>
        </label>
        {types.length > 1 && (
          <label className="field">Type
            <select aria-label="Employment type" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
              <option value="all">All types</option>
              {types.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
            </select>
          </label>
        )}
        <label className="field">Sort
          <select aria-label="Sort directory" value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value as SortKey })}>
            <option value="name">Name</option>
            <option value="department">Department</option>
            <option value="location">Location</option>
            <option value="status">Status</option>
          </select>
        </label>
      </div>
      <div className="directory-meta">
        <p>{rows.length === 1 ? "1 person" : `${rows.length} people`}{chips.length > 0 ? " matching these filters" : ""} · sorted by {filters.sort}</p>
        {chips.length > 0 && (
          <div className="chips">
            {chips.map((chip) => (
              <button key={chip.key} type="button" className="chip" aria-label={`Remove ${chip.label}`} onClick={() => {
                if (chip.key === "q") setSearch("");
                const reset = chip.key === "q" ? "" : chip.key === "status" ? "active" : "all";
                setFilters({ ...filters, [chip.key]: reset });
              }}>
                {chip.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={clear}>Clear all</Button>
          </div>
        )}
      </div>
      {state.employees.length === 0 ? (
        <EmptyState title="No employees yet" body="Add the first employee record to start the directory." action={can("people.manage") ? <Button onClick={() => setAdding(true)}>Add employee</Button> : undefined} />
      ) : rows.length === 0 ? (
        <EmptyState title="No employees match" body="Try a different name, department, location, or status." action={filtered ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined} />
      ) : (
        <DataTable
          className="cards-on-mobile"
          caption="Employee directory"
          rows={page.slice}
          rowKey={(row) => row.id}
          emptyTitle="No employees match"
          emptyBody="Try a different name, department, location, or status."
          columns={[
            { key: "name", header: "Employee", render: (row) => <PersonLink name={fullName(row)} color={row.avatarColor} photoSrc={photoSrc(row.id, row.photoUpdatedAt)} to={`/people/${row.id}`} meta={row.employeeCode} /> },
            { key: "title", header: "Title", render: (row) => row.jobTitle },
            { key: "dept", header: "Department", render: (row) => state.departments.find((item) => item.id === row.departmentId)?.name ?? "—" },
            { key: "loc", header: "Location", render: (row) => state.locations.find((item) => item.id === row.locationId)?.name ?? "—" },
            { key: "manager", header: "Manager", render: (row) => state.employees.find((item) => item.id === row.managerId) ? fullName(state.employees.find((item) => item.id === row.managerId)!) : "—" },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "type", header: "Type", render: (row) => labelFor(row.employmentType) },
          ]}
        />
      )}
      {page.count > 1 && <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />}
      <Modal open={adding} title="Add employee" className="modal-wide" onClose={closeAdd}>
        <EmployeeForm onDone={closeAdd} />
      </Modal>
    </div>
  );
}

function compare(a: Employee, b: Employee, sort: SortKey, state: { departments: { id: string; name: string }[]; locations: { id: string; name: string }[] }) {
  const byName = fullName(a).localeCompare(fullName(b));
  if (sort === "department") {
    const left = state.departments.find((item) => item.id === a.departmentId)?.name ?? "";
    const right = state.departments.find((item) => item.id === b.departmentId)?.name ?? "";
    return left.localeCompare(right) || byName;
  }
  if (sort === "location") {
    const left = state.locations.find((item) => item.id === a.locationId)?.name ?? "";
    const right = state.locations.find((item) => item.id === b.locationId)?.name ?? "";
    return left.localeCompare(right) || byName;
  }
  if (sort === "status") return labelFor(a.status).localeCompare(labelFor(b.status)) || byName;
  return byName;
}
