import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Avatar, Banner, Button, DataTable, EmptyState, Field, Modal, PageHeader, Pager, StatusBadge, usePage } from "../components/ui";
import { isValidEmail, normalizeEmail } from "../lib/auth";
import { formatDateTime, fullName, labelFor } from "../lib/format";
import { accessElevated } from "../store/mutations";
import { useApp } from "../store/store";
import type { Role, UserAccount } from "../types";

const ROLES: Role[] = ["employee", "manager", "hr", "payroll", "admin"];
const ROLE_HELP: Record<Role, string> = {
  employee: "Own attendance, leave, expenses, and profile.",
  manager: "Own work, plus the people who report to them.",
  payroll: "Payroll runs, compensation, and reimbursements.",
  hr: "Full HR access, including people, leave, payroll, and settings.",
  admin: "Full access. The last active System admin cannot be removed.",
};
const COLORS = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#0369a1"];
const FILTER_KEY = "buildesk-people-users";

type Filters = { q: string; role: string; status: string; department: string };
type SortKey = "name" | "role" | "status" | "updated";
type Pending =
  | { kind: "suspend" | "reactivate" | "deactivate" | "delete" | "resend"; account: UserAccount }
  | { kind: "elevate"; draft: Draft };

interface Draft {
  id?: string;
  email: string;
  displayName: string;
  role: Role;
  departmentId: string;
  employeeId: string;
}

const DEFAULTS: Filters = { q: "", role: "all", status: "all", department: "all" };
const blank = (): Draft => ({ email: "", displayName: "", role: "employee", departmentId: "", employeeId: "" });

function accountColor(email: string): string {
  const total = [...email].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLORS[total % COLORS.length];
}

function readFilters(params: URLSearchParams): Filters {
  const stored = readStored();
  const fromUrl = ["q", "role", "status", "department"].some((key) => params.has(key));
  const source = fromUrl
    ? { q: params.get("q") ?? "", role: params.get("role") ?? "all", status: params.get("status") ?? "all", department: params.get("department") ?? "all" }
    : stored ?? DEFAULTS;
  return {
    q: source.q || "",
    role: source.role || "all",
    status: source.status || "all",
    department: source.department || "all",
  };
}

function readStored(): Filters | null {
  try {
    const raw = sessionStorage.getItem(FILTER_KEY);
    return raw ? JSON.parse(raw) as Filters : null;
  } catch {
    return null;
  }
}

export function Users() {
  const { state, can } = useApp();
  const [params, setParams] = useSearchParams();
  const initial = readFilters(params);
  const [filters, setFilters] = useState(initial);
  const [search, setSearch] = useState(initial.q);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [editor, setEditor] = useState<Draft | null>(null);
  const ops = useAccountOps(() => setEditor(null));

  useEffect(() => {
    document.title = can("users.manage") ? "User Management · Buildesk People" : "Access restricted · Buildesk People";
  }, [can]);

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => (current.q === search ? current : { ...current, q: search })), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    setParams((current) => {
      const next = new URLSearchParams();
      if (filters.q) next.set("q", filters.q);
      if (filters.role !== "all") next.set("role", filters.role);
      if (filters.status !== "all") next.set("status", filters.status);
      if (filters.department !== "all") next.set("department", filters.department);
      return next.toString() === current.toString() ? current : next;
    }, { replace: true });
  }, [filters, setParams]);

  const counts = useMemo(() => ({
    total: state.accounts.length,
    active: state.accounts.filter((item) => item.status === "active").length,
    invited: state.accounts.filter((item) => item.status === "invited").length,
    held: state.accounts.filter((item) => item.status === "suspended" || item.status === "deactivated").length,
  }), [state.accounts]);

  const roles = ROLES.filter((item) => state.accounts.some((account) => account.role === item));
  const statuses = ["invited", "active", "suspended", "deactivated"].filter((item) => state.accounts.some((account) => account.status === item));
  const departments = state.departments.filter((item) => state.accounts.some((account) => account.departmentId === item.id));
  const hasUnassigned = state.accounts.some((account) => !account.departmentId);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const filtered = state.accounts.filter((item) => {
      if (q && !`${item.displayName} ${item.email}`.toLowerCase().includes(q)) return false;
      if (filters.role !== "all" && item.role !== filters.role) return false;
      if (filters.status === "held" && item.status !== "suspended" && item.status !== "deactivated") return false;
      if (filters.status !== "all" && filters.status !== "held" && item.status !== filters.status) return false;
      if (filters.department === "none" && item.departmentId) return false;
      if (filters.department !== "all" && filters.department !== "none" && item.departmentId !== filters.department) return false;
      return true;
    });
    const value = (item: UserAccount) => {
      if (sort.key === "role") return labelFor(item.role);
      if (sort.key === "status") return labelFor(item.status);
      if (sort.key === "updated") return item.updatedAt;
      return item.displayName || item.email;
    };
    return [...filtered].sort((a, b) => {
      const compared = value(a).localeCompare(value(b));
      return sort.dir === "asc" ? compared : -compared;
    });
  }, [state.accounts, filters, sort]);
  const page = usePage(rows, 12, `${filters.q}|${filters.role}|${filters.status}|${filters.department}|${sort.key}|${sort.dir}`);
  const filtered = filters.q.trim() || filters.role !== "all" || filters.status !== "all" || filters.department !== "all";

  if (!can("users.manage")) {
    return <EmptyState title="User Management is restricted" body="Your role cannot view or change login accounts." />;
  }

  const clear = () => {
    setSearch("");
    setFilters(DEFAULTS);
  };
  const chips = [
    filters.q.trim() ? { key: "q", label: `Search: ${filters.q.trim()}` } : null,
    filters.role !== "all" ? { key: "role", label: labelFor(filters.role) } : null,
    filters.status !== "all" ? { key: "status", label: filters.status === "held" ? "Suspended or deactivated" : labelFor(filters.status) } : null,
    filters.department !== "all" ? { key: "department", label: filters.department === "none" ? "No department" : state.departments.find((item) => item.id === filters.department)?.name ?? "Department" } : null,
  ].filter((item): item is { key: string; label: string } => Boolean(item));
  const toggle = (key: SortKey) => setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  const header = (key: SortKey, label: string) => <button className="sort-btn" type="button" onClick={() => toggle(key)}>{label}</button>;
  const aria = (key: SortKey): "ascending" | "descending" | "none" => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
  const openCreate = () => setEditor(blank());

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Login accounts are separate from employee records. Inviting someone does not create an employee profile."
        actions={<Button onClick={openCreate}>Add user</Button>}
      />
      <p className="muted user-note">Invitations stay in this workspace. No email is sent. The person signs in with the work email and chooses a password.</p>
      <div className="stats">
        <Summary label="Total accounts" value={counts.total} pressed={filters.status === "all"} onClick={() => setFilters({ ...filters, status: "all" })} />
        <Summary label="Active" value={counts.active} pressed={filters.status === "active"} onClick={() => setFilters({ ...filters, status: "active" })} />
        <Summary label="Invited" value={counts.invited} pressed={filters.status === "invited"} onClick={() => setFilters({ ...filters, status: "invited" })} />
        <Summary label="Suspended or deactivated" value={counts.held} pressed={filters.status === "held"} onClick={() => setFilters({ ...filters, status: "held" })} />
      </div>
      <div className="filters">
        <label className="field">Search
          <input value={search} placeholder="Name or email" aria-label="Search by name or email" onChange={(event) => setSearch(event.target.value)} />
        </label>
        {roles.length > 0 && (
          <label className="field">Role
            <select aria-label="Filter by role" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
              <option value="all">All roles</option>
              {roles.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
            </select>
          </label>
        )}
        {statuses.length > 0 && (
          <label className="field">Status
            <select aria-label="Filter by status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
              <option value="all">All statuses</option>
              {statuses.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
              {(counts.held > 0 || filters.status === "held") && <option value="held">Suspended or deactivated</option>}
            </select>
          </label>
        )}
        {(departments.length > 0 || hasUnassigned) && (
          <label className="field">Department
            <select aria-label="Filter by department" value={filters.department} onChange={(event) => setFilters({ ...filters, department: event.target.value })}>
              <option value="all">All departments</option>
              {hasUnassigned && <option value="none">No department</option>}
              {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className="directory-meta">
        <p>{rows.length === 1 ? "1 account" : `${rows.length} accounts`}{chips.length > 0 ? " matching these filters" : ""} · sorted by {sort.key}</p>
        {chips.length > 0 && (
          <div className="chips">
            {chips.map((chip) => (
              <button key={chip.key} type="button" className="chip" aria-label={`Remove ${chip.label}`} onClick={() => {
                if (chip.key === "q") setSearch("");
                setFilters(chip.key === "q" ? { ...filters, q: "" } : chip.key === "role" ? { ...filters, role: "all" } : chip.key === "status" ? { ...filters, status: "all" } : { ...filters, department: "all" });
              }}>
                {chip.label} <span aria-hidden="true">×</span>
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={clear}>Clear all</Button>
          </div>
        )}
      </div>
      {state.accounts.length === 0 ? (
        <EmptyState title="No login accounts" body="Add a user to invite a login. This does not create an employee profile." action={<Button onClick={openCreate}>Add user</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState title="No accounts match" body="Try a different name, email, role, status, or department." action={filtered ? <Button variant="secondary" onClick={clear}>Clear filters</Button> : undefined} />
      ) : (
        <DataTable
          className="cards-on-mobile"
          caption="Login accounts"
          rows={page.slice}
          rowKey={(row) => row.id}
          emptyTitle="No accounts match"
          emptyBody="Try a different name, email, role, status, or department."
          columns={[
            { key: "user", label: "User", header: header("name", "User"), sort: aria("name"), render: (row) => <Link className="person" to={`/users/${row.id}`}><Avatar name={row.displayName || row.email} color={accountColor(row.email)} /><span><strong>{row.displayName || row.email}</strong><span className="muted" style={{ display: "block", fontWeight: 500 }}>{row.email}</span></span></Link> },
            { key: "role", label: "Role", header: header("role", "Role"), sort: aria("role"), render: (row) => labelFor(row.role) },
            { key: "department", label: "Department", header: "Department", render: (row) => state.departments.find((item) => item.id === row.departmentId)?.name ?? "—" },
            { key: "employee", label: "Employee profile", header: "Employee profile", render: (row) => {
              const employee = row.employeeId ? state.employees.find((item) => item.id === row.employeeId) : undefined;
              return employee ? <Link to={`/people/${employee.id}`}>{fullName(employee)}</Link> : "Not linked";
            } },
            { key: "status", label: "Status", header: header("status", "Status"), sort: aria("status"), render: (row) => <StatusBadge value={row.status} /> },
            { key: "updated", label: "Updated", header: header("updated", "Updated"), sort: aria("updated"), render: (row) => formatDateTime(row.updatedAt) },
            { key: "actions", label: "Actions", header: "Actions", render: (row) => <ActionMenu label={`More actions for ${row.displayName || row.email}`} items={ops.items(row, () => setEditor(accountDraft(row)))} /> },
          ]}
        />
      )}
      {page.count > 1 && <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />}
      <AccountForm editor={editor} onClose={() => { if (!ops.blocking.current) setEditor(null); }} onElevate={(draft) => ops.ask({ kind: "elevate", draft })} />
      {ops.dialog}
    </div>
  );
}

function Summary({ label, value, pressed, onClick }: { label: string; value: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className="stat" aria-pressed={pressed} onClick={onClick}>
      <span>
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
      </span>
    </button>
  );
}

function accountDraft(account: UserAccount): Draft {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName === account.email ? "" : account.displayName,
    role: account.role,
    departmentId: account.departmentId ?? "",
    employeeId: account.employeeId ?? "",
  };
}

function AccountForm({ editor, onClose, onElevate }: { editor: Draft | null; onClose: () => void; onElevate: (draft: Draft) => void }) {
  const { state, actions } = useApp();
  const [draft, setDraft] = useState<Draft | null>(editor);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(editor);
    setErrors({});
    setFormError("");
  }, [editor]);
  if (!draft) return null;
  const existing = draft.id ? state.accounts.find((item) => item.id === draft.id) : undefined;
  const self = existing?.id === state.currentUserId;
  const lastAdmin = Boolean(existing && existing.role === "admin" && existing.status === "active" && state.accounts.filter((item) => item.role === "admin" && item.status === "active").length <= 1);
  const lockRole = self || lastAdmin;
  const changes = existing ? changeLines(draft, existing, state) : [];
  const save = async () => {
    const next: Record<string, string> = {};
    if (!isValidEmail(draft.email)) next.email = "Enter a valid email address.";
    if (!draft.role) next.role = "Choose a role.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (existing && accessElevated(existing.role, draft.role)) {
      onElevate(draft);
      return;
    }
    setSaving(true);
    const result = await actions.saveAccount({ ...draft, email: normalizeEmail(draft.email) });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.message);
      if (/email/i.test(result.message)) setErrors((current) => ({ ...current, email: result.message }));
      return;
    }
    onClose();
  };
  return (
    <Modal open className="modal-wide modal-form" title={draft.id ? "Edit login account" : "Add user"} onClose={onClose}>
      <form noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
        {formError && <Banner tone="error">{formError}</Banner>}
        <fieldset className="form-section">
          <legend>Account details</legend>
          <div className="form-grid">
            <Field label="Email address" required error={errors.email} hint="Required. Stored in lowercase and must be unique.">
              <input data-field="email" type="email" autoComplete="off" aria-required="true" aria-invalid={Boolean(errors.email)} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </Field>
            <Field label="Display name" hint="Optional. The email is shown until a name is provided.">
              <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} />
            </Field>
            <Field className="span-2" label="Role" required error={errors.role} hint={self ? "You can't change your own role." : lastAdmin ? "The last active System admin keeps this role." : ROLE_HELP[draft.role]}>
              <select aria-required="true" aria-invalid={Boolean(errors.role)} value={draft.role} disabled={lockRole} onChange={(event) => setDraft({ ...draft, role: event.target.value as Role })}>
                {ROLES.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
              </select>
            </Field>
            <Field className="span-2" label="Department" hint="Optional. This does not change an employee record.">
              <select value={draft.departmentId} onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}>
                <option value="">No department</option>
                {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="form-section">
          <legend>Employee profile link</legend>
          <Field label="Existing employee" hint="Optional. Linking connects this login to an employee who is already in People. It does not create a second profile.">
            <select value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })}>
              <option value="">Not linked</option>
              {state.employees.filter((item) => item.id === draft.employeeId || !state.accounts.some((account) => account.employeeId === item.id && account.id !== draft.id)).map((item) => (
                <option key={item.id} value={item.id}>{fullName(item)} · {item.employeeCode}</option>
              ))}
            </select>
          </Field>
        </fieldset>
        <fieldset className="form-section">
          <legend>Account access</legend>
          {existing ? (
            <p className="user-form-status">Current status: <StatusBadge value={existing.status} /> · Current role: {labelFor(existing.role)}. Status changes use Suspend, Reactivate, or Deactivate.</p>
          ) : (
            <p className="muted">A new login starts as Invited. No email is sent. The person signs in with this email and chooses a password.</p>
          )}
          {changes.length > 0 && (
            <div>
              <p className="muted">This save will record:</p>
              <ul>{changes.map((line) => <li key={line}>{line}</li>)}</ul>
            </div>
          )}
        </fieldset>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : draft.id ? "Save account" : "Invite user"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function changeLines(draft: Draft, account: UserAccount, state: { departments: { id: string; name: string }[]; employees: { id: string; firstName: string; lastName: string }[] }): string[] {
  const lines: string[] = [];
  const email = normalizeEmail(draft.email);
  const name = draft.displayName.trim() || email;
  if (email !== account.email) lines.push(`Email from ${account.email} to ${email}.`);
  if (name !== account.displayName) lines.push(`Display name from ${account.displayName} to ${name}.`);
  if (draft.role !== account.role) lines.push(`Role from ${labelFor(account.role)} to ${labelFor(draft.role)}.`);
  if ((draft.departmentId || null) !== account.departmentId) {
    const from = state.departments.find((item) => item.id === account.departmentId)?.name ?? "No department";
    const to = state.departments.find((item) => item.id === draft.departmentId)?.name ?? "No department";
    lines.push(`Department from ${from} to ${to}.`);
  }
  if ((draft.employeeId || null) !== account.employeeId) {
    const from = state.employees.find((item) => item.id === account.employeeId);
    const to = state.employees.find((item) => item.id === draft.employeeId);
    lines.push(`Employee link from ${from ? fullName(from) : "not linked"} to ${to ? fullName(to) : "not linked"}.`);
  }
  return lines;
}

function useAccountOps(onElevated: () => void) {
  const { state, actions } = useApp();
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const blocking = useRef(false);
  const elevated = useRef(onElevated);
  blocking.current = Boolean(pending);
  elevated.current = onElevated;
  const selfId = state.currentUserId;
  const ask = (next: Pending) => {
    setError("");
    setPending(next);
  };
  const items = (account: UserAccount, onEdit: () => void) => {
    const self = account.id === selfId;
    const last = account.role === "admin" && account.status === "active" && state.accounts.filter((item) => item.role === "admin" && item.status === "active").length <= 1;
    const protectedAccount = self || last;
    const deletable = !protectedAccount && !account.employeeId && !state.audits.some((item) => item.actorId === account.id) && !state.notifications.some((item) => item.userId === account.id);
    const list: { label: string; to?: string; danger?: boolean; onClick?: () => void }[] = [
      { label: "View", to: `/users/${account.id}` },
      { label: "Edit", onClick: onEdit },
    ];
    if (account.status === "invited") list.push({ label: "Resend invitation", onClick: () => ask({ kind: "resend", account }) });
    if (account.status === "active" && !protectedAccount) list.push({ label: "Suspend", danger: true, onClick: () => ask({ kind: "suspend", account }) });
    if (account.status === "suspended") list.push({ label: "Reactivate", onClick: () => ask({ kind: "reactivate", account }) });
    if (account.status !== "deactivated" && !protectedAccount) list.push({ label: "Deactivate", danger: true, onClick: () => ask({ kind: "deactivate", account }) });
    if (deletable) list.push({ label: "Delete", danger: true, onClick: () => ask({ kind: "delete", account }) });
    return list;
  };
  const run = async () => {
    if (!pending || busy) return;
    setBusy(true);
    const result = pending.kind === "elevate"
      ? await actions.saveAccount({ ...pending.draft, email: normalizeEmail(pending.draft.email) })
      : pending.kind === "resend"
        ? await actions.resendInvitation(pending.account.id)
        : pending.kind === "suspend"
          ? await actions.suspendAccount(pending.account.id)
          : pending.kind === "reactivate"
            ? await actions.reactivateAccount(pending.account.id)
            : pending.kind === "deactivate"
              ? await actions.deactivateAccount(pending.account.id)
              : await actions.deleteAccount(pending.account.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const kind = pending.kind;
    setPending(null);
    if (kind === "elevate") elevated.current();
    if (kind === "delete") navigate("/users");
  };
  const copy = !pending ? { title: "", body: "", confirm: "Confirm", danger: false } : pending.kind === "elevate"
    ? { title: "Confirm access change", body: `Save ${pending.draft.email || "this account"} with the ${labelFor(pending.draft.role)} role. This increases what the account can do.`, confirm: "Save with this role", danger: false }
    : pending.kind === "delete"
      ? { title: "Delete login account", body: "This removes a login that is not linked to an employee and is not in the audit history. Employee and payroll records are not affected.", confirm: "Delete account", danger: true }
      : pending.kind === "deactivate"
        ? { title: "Deactivate account", body: `Deactivate ${pending.account.email}. The person cannot sign in. Employee, payroll, and audit history stay.`, confirm: "Deactivate", danger: true }
        : pending.kind === "suspend"
          ? { title: "Suspend account", body: `Suspend ${pending.account.email}. Sign-in stays closed until the account is reactivated.`, confirm: "Suspend", danger: true }
          : pending.kind === "reactivate"
            ? { title: "Reactivate account", body: `Reactivate ${pending.account.email}. They can sign in again.`, confirm: "Reactivate", danger: false }
            : { title: "Resend invitation", body: `Record another invitation for ${pending.account.email}. No email is sent. They still choose a password on the first sign-in.`, confirm: "Record invitation", danger: false };
  const dialog = (
    <Modal open={Boolean(pending)} title={copy.title} onClose={() => { if (!busy) { setPending(null); setError(""); } }}>
      {error && <Banner tone="error">{error}</Banner>}
      <p>{copy.body}</p>
      <div className="actions">
        <Button variant="secondary" onClick={() => { setPending(null); setError(""); }} disabled={busy}>Cancel</Button>
        <Button variant={copy.danger ? "danger" : "primary"} onClick={run} disabled={busy}>{busy ? "Saving…" : copy.confirm}</Button>
      </div>
    </Modal>
  );
  return { items, dialog, ask, blocking };
}

function ActionMenu({ label, items }: { label: string; items: { label: string; to?: string; danger?: boolean; onClick?: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector("button")?.focus();
      }
    };
    const place = () => {
      const rect = ref.current?.querySelector("button")?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = items.length * 40 + 16;
      const top = rect.bottom + 6 + menuHeight > window.innerHeight && rect.top > menuHeight ? rect.top - menuHeight - 6 : rect.bottom + 6;
      setBox({ top, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  return (
    <div className="action-menu" ref={ref}>
      <Button size="sm" variant="secondary" aria-expanded={open} aria-haspopup="menu" aria-label={label} onClick={() => setOpen((value) => !value)}>More actions</Button>
      {open && box && (
        <div className="menu menu-fixed" role="menu" style={{ top: box.top, right: box.right }}>
          {items.map((item) => item.to ? (
            <Link key={item.label} role="menuitem" to={item.to} onClick={() => setOpen(false)}>{item.label}</Link>
          ) : (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? "menu-danger" : undefined} onClick={() => { setOpen(false); item.onClick?.(); }}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserDetail() {
  const { id } = useParams();
  const { state, can } = useApp();
  const [editor, setEditor] = useState<Draft | null>(null);
  const ops = useAccountOps(() => setEditor(null));
  const account = state.accounts.find((item) => item.id === id);
  if (!can("users.manage")) return <EmptyState title="User Management is restricted" body="Your role cannot view a login account." />;
  if (!account) return <EmptyState title="Account not found" body="That login account is not in this workspace." action={<Link className="btn btn-secondary" to="/users">Back to users</Link>} />;
  const employee = account.employeeId ? state.employees.find((item) => item.id === account.employeeId) : undefined;
  const department = account.departmentId ? state.departments.find((item) => item.id === account.departmentId) : undefined;
  const activity = state.audits.filter((item) => item.area === "users" && (item.actorId === account.id || item.summary.toLowerCase().includes(account.email))).slice(0, 6);
  const actorName = (actorId: string) => {
    const login = state.accounts.find((item) => item.id === actorId);
    if (login) return login.displayName;
    const person = state.employees.find((item) => item.id === actorId);
    return person ? fullName(person) : "Someone";
  };
  return (
    <div>
      <PageHeader
        title={account.displayName || account.email}
        subtitle="Login account. This is not the employee profile."
        crumbs={[{ label: "User Management", to: "/users" }, { label: account.email }]}
        actions={<ActionMenu label={`More actions for ${account.displayName || account.email}`} items={ops.items(account, () => setEditor(accountDraft(account)))} />}
      />
      <section className="profile-hero panel">
        <Avatar name={account.displayName || account.email} color={accountColor(account.email)} size={72} labelled />
        <div>
          <div className="profile-hero-line"><StatusBadge value={account.status} /><span>{labelFor(account.role)}</span></div>
          <p>{account.email}</p>
          <p className="muted">{department?.name ?? "No department"} · {employee ? "Linked to an employee profile" : "Not linked to an employee profile"}</p>
          {account.status === "invited" && <p className="muted">Invited {account.invitedAt ? formatDateTime(account.invitedAt) : ""}. No email was sent. The first sign-in is where they choose a password.</p>}
        </div>
      </section>
      <section className="panel">
        <h2>Login account</h2>
        <dl className="dl">
          <dt>Email</dt><dd>{account.email}</dd>
          <dt>Role</dt><dd>{labelFor(account.role)}</dd>
          <dt>Status</dt><dd><StatusBadge value={account.status} /></dd>
          <dt>Department</dt><dd>{department?.name ?? "—"}</dd>
          <dt>Employee profile</dt><dd>{employee ? <Link to={`/people/${employee.id}`}>{fullName(employee)} · {employee.employeeCode}</Link> : "Not linked. Linking does not copy employee details onto this login."}</dd>
          <dt>Created</dt><dd>{formatDateTime(account.createdAt)}</dd>
          <dt>Updated</dt><dd>{formatDateTime(account.updatedAt)}</dd>
          <dt>Invited</dt><dd>{account.invitedAt ? formatDateTime(account.invitedAt) : "—"}</dd>
          <dt>Activated</dt><dd>{account.activatedAt ? formatDateTime(account.activatedAt) : "—"}</dd>
        </dl>
        <Banner>This record is the login. It does not store a password, and it is not a copy of the employee profile.</Banner>
      </section>
      <section className="panel">
        <h2>Recent account activity</h2>
        {activity.length === 0 ? <p className="muted">No account-management activity is recorded for this login yet.</p> : (
          <ol className="timeline">
            {activity.map((item) => (
              <li key={item.id}>
                <div className="tl-title">{item.summary}</div>
                <div className="tl-meta">{actorName(item.actorId)} · {formatDateTime(item.at)}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <AccountForm editor={editor} onClose={() => { if (!ops.blocking.current) setEditor(null); }} onElevate={(draft) => ops.ask({ kind: "elevate", draft })} />
      {ops.dialog}
    </div>
  );
}
