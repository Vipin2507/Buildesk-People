import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Banner, Button, DataTable, DecisionDialog, EmptyState, Field, Modal, PageHeader, Pager, StatusBadge, usePage } from "../components/ui";
import { isValidEmail, normalizeEmail } from "../lib/auth";
import { formatDateTime, fullName, labelFor } from "../lib/format";
import { accessElevated } from "../store/mutations";
import { useApp } from "../store/store";
import type { Role, UserAccount } from "../types";

const ROLES: Role[] = ["employee", "manager", "hr", "payroll", "admin"];
const STATUSES = ["invited", "active", "suspended", "deactivated"] as const;

interface Draft {
  id?: string;
  email: string;
  displayName: string;
  role: Role;
  departmentId: string;
  employeeId: string;
}

const blank = (): Draft => ({ email: "", displayName: "", role: "employee", departmentId: "", employeeId: "" });

export function Users() {
  const { state, can, actions } = useApp();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [department, setDepartment] = useState("all");
  const [sort, setSort] = useState<{ key: "name" | "role" | "status" | "created" | "updated"; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [editor, setEditor] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<{ kind: "suspend" | "reactivate" | "deactivate" | "delete" | "resend"; account: UserAccount } | { kind: "elevate"; draft: Draft } | null>(null);

  useEffect(() => {
    document.title = can("users.manage") ? "User Management · Buildesk People" : "Access restricted · Buildesk People";
    const timer = window.setTimeout(() => {
      if (!Array.isArray(state.accounts)) setLoadError("Login accounts could not be loaded.");
      setLoading(false);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [state.accounts]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = state.accounts.filter((item) => {
      const hay = `${item.displayName} ${item.email}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (role !== "all" && item.role !== role) return false;
      if (status !== "all" && item.status !== status) return false;
      if (department === "none" && item.departmentId) return false;
      if (department !== "all" && department !== "none" && item.departmentId !== department) return false;
      return true;
    });
    const value = (item: UserAccount) => {
      if (sort.key === "name") return item.displayName || item.email;
      if (sort.key === "role") return item.role;
      if (sort.key === "status") return item.status;
      if (sort.key === "created") return item.createdAt;
      return item.updatedAt;
    };
    return [...filtered].sort((a, b) => {
      const compared = value(a).localeCompare(value(b));
      return sort.dir === "asc" ? compared : -compared;
    });
  }, [state.accounts, query, role, status, department, sort]);

  const page = usePage(rows, 8, `${query}|${role}|${status}|${department}|${sort.key}|${sort.dir}`);

  if (!can("users.manage")) {
    return <EmptyState title="User Management is restricted" body="Only a System admin can view or change login accounts. Employees, managers, and HR admins do not have this access." />;
  }
  if (loading) return <p className="muted">Loading login accounts…</p>;
  if (loadError) return <Banner tone="error">{loadError}</Banner>;

  const toggle = (key: typeof sort.key) => setSort((current) => ({ key, dir: current.key === key && current.dir === "asc" ? "desc" : "asc" }));
  const header = (key: typeof sort.key, label: string) => (
    <button className="sort-btn" type="button" onClick={() => toggle(key)}>{label}</button>
  );
  const aria = (key: typeof sort.key): "ascending" | "descending" | "none" => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none");

  const openCreate = () => {
    setEditor(blank());
    setErrors({});
    setFormError("");
  };
  const openEdit = (account: UserAccount) => {
    setEditor({
      id: account.id,
      email: account.email,
      displayName: account.displayName === account.email ? "" : account.displayName,
      role: account.role,
      departmentId: account.departmentId ?? "",
      employeeId: account.employeeId ?? "",
    });
    setErrors({});
    setFormError("");
  };

  const validate = (draft: Draft) => {
    const next: Record<string, string> = {};
    if (!isValidEmail(draft.email)) next.email = "Enter a valid email address.";
    if (!draft.role) next.role = "Choose a role.";
    return next;
  };

  const commit = async (draft: Draft) => {
    const result = await actions.saveAccount({
      id: draft.id,
      email: normalizeEmail(draft.email),
      displayName: draft.displayName,
      role: draft.role,
      departmentId: draft.departmentId,
      employeeId: draft.employeeId,
    });
    if (!result.ok) {
      setFormError(result.message);
      if (/email/i.test(result.message)) setErrors((current) => ({ ...current, email: result.message }));
      return;
    }
    setEditor(null);
    setPending(null);
  };

  const requestSave = () => {
    if (!editor) return;
    const next = validate(editor);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const previous = editor.id ? state.accounts.find((item) => item.id === editor.id)?.role ?? null : null;
    if (accessElevated(previous, editor.role)) {
      setPending({ kind: "elevate", draft: editor });
      return;
    }
    commit(editor);
  };

  const runPending = async () => {
    if (!pending) return;
    if (pending.kind === "elevate") {
      await commit(pending.draft);
      return;
    }
    const id = pending.account.id;
    const result = pending.kind === "resend"
      ? await actions.resendInvitation(id)
      : pending.kind === "suspend"
        ? await actions.suspendAccount(id)
        : pending.kind === "reactivate"
          ? await actions.reactivateAccount(id)
          : pending.kind === "deactivate"
            ? await actions.deactivateAccount(id)
            : await actions.deleteAccount(id);
    if (result.ok) setPending(null);
    else setFormError(result.message);
  };

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Login accounts are separate from employee records. Inviting someone does not create an employee profile."
        actions={<Button onClick={openCreate}>Add User</Button>}
      />
      <p className="muted user-note">Invitations stay in this workspace. No email is sent, and a password is created when the person signs in.</p>
      <div className="filters">
        <Field label="Search">
          <input aria-label="Search by name or email" value={query} placeholder="Name or email" onChange={(event) => setQuery(event.target.value)} />
        </Field>
        <Field label="Role">
          <select aria-label="Filter by role" value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="all">All roles</option>
            {ROLES.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {STATUSES.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select aria-label="Filter by department" value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All departments</option>
            <option value="none">No department</option>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </div>
      <DataTable
        caption="Login accounts"
        rows={page.slice}
        rowKey={(row) => row.id}
        emptyTitle={state.accounts.length === 0 ? "No login accounts" : "No accounts match"}
        emptyBody={state.accounts.length === 0 ? "Add a user to invite a login account." : "Try a different name, email, role, status, or department."}
        columns={[
          { key: "name", header: header("name", "Name / email"), sort: aria("name"), render: (row) => <div><strong>{row.displayName}</strong><div className="muted">{row.email}</div></div> },
          { key: "role", header: header("role", "Role"), sort: aria("role"), render: (row) => labelFor(row.role) },
          { key: "status", header: header("status", "Status"), sort: aria("status"), render: (row) => <StatusBadge value={row.status} /> },
          { key: "created", header: header("created", "Created"), sort: aria("created"), render: (row) => formatDateTime(row.createdAt) },
          { key: "updated", header: header("updated", "Updated"), sort: aria("updated"), render: (row) => formatDateTime(row.updatedAt) },
          {
            key: "actions",
            header: "Actions",
            render: (row) => (
              <div className="row-actions">
                <Link className="btn btn-secondary btn-sm" to={`/users/${row.id}`}>View</Link>
                <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>Edit</Button>
                {row.status === "invited" && <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "resend", account: row })}>Resend invitation</Button>}
                {row.status === "active" && <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "suspend", account: row })}>Suspend</Button>}
                {row.status === "suspended" && <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "reactivate", account: row })}>Reactivate</Button>}
                {row.status !== "deactivated" && <Button size="sm" variant="secondary" onClick={() => setPending({ kind: "deactivate", account: row })}>Deactivate</Button>}
                <Button size="sm" variant="danger" onClick={() => setPending({ kind: "delete", account: row })}>Delete</Button>
              </div>
            ),
          },
        ]}
      />
      <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
      <Modal open={Boolean(editor)} title={editor?.id ? "Edit login account" : "Add user"} onClose={() => setEditor(null)}>
        {editor && (
          <form noValidate onSubmit={(event) => { event.preventDefault(); requestSave(); }}>
            {formError && <Banner tone="error">{formError}</Banner>}
            <Field label="Email address" error={errors.email} hint="Required. Stored in lowercase.">
              <input type="email" value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value })} />
            </Field>
            <Field label="Display name" hint="Optional. The email is shown until a name is provided.">
              <input value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} />
            </Field>
            <Field label="Role" error={errors.role}>
              <select value={editor.role} onChange={(event) => setEditor({ ...editor, role: event.target.value as Role })}>
                {ROLES.map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
              </select>
            </Field>
            <Field label="Department" hint="Optional. This does not change an employee record.">
              <select value={editor.departmentId} onChange={(event) => setEditor({ ...editor, departmentId: event.target.value })}>
                <option value="">No department</option>
                {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
            <Field label="Linked employee profile" hint="Optional. Linking uses an existing employee and does not create another one.">
              <select value={editor.employeeId} onChange={(event) => setEditor({ ...editor, employeeId: event.target.value })}>
                <option value="">Not linked</option>
                {state.employees.filter((item) => !state.accounts.some((account) => account.employeeId === item.id && account.id !== editor.id) || item.id === editor.employeeId).map((item) => (
                  <option key={item.id} value={item.id}>{fullName(item)} · {item.employeeCode}</option>
                ))}
              </select>
            </Field>
            <p className="muted">Account status changes through Suspend, Reactivate, or Deactivate. A new account starts as Invited.</p>
            <div className="actions">
              <Button type="submit">{editor.id ? "Save account" : "Invite user"}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditor(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
      <DecisionDialog
        open={Boolean(pending)}
        title={pending?.kind === "elevate" ? "Confirm access change" : pending?.kind === "delete" ? "Delete login account" : pending?.kind === "deactivate" ? "Deactivate account" : pending?.kind === "suspend" ? "Suspend account" : pending?.kind === "reactivate" ? "Reactivate account" : "Resend invitation"}
        body={pending?.kind === "elevate"
          ? `Save ${pending.draft.email || "this account"} with the ${labelFor(pending.draft.role)} role. This increases what the account can do.`
          : pending?.kind === "delete"
            ? "Permanent deletion is blocked when the account is linked to an employee or appears in audit history. Deactivate is the usual choice."
            : pending?.kind === "deactivate"
              ? "Deactivation keeps employee, payroll, and audit history. The person will not be able to sign in."
              : pending?.kind === "resend"
                ? "This records another invitation. No email is sent from this workspace."
                : pending?.kind === "suspend"
                  ? `Suspend ${pending.account.email}. Sign-in stays closed until the account is reactivated.`
                  : pending
                    ? `Reactivate ${pending.account.email}.`
                    : ""}
        confirmLabel={pending?.kind === "elevate" ? "Save with this role" : pending?.kind === "delete" ? "Delete account" : "Confirm"}
        tone={pending?.kind === "delete" || pending?.kind === "deactivate" || pending?.kind === "suspend" ? "danger" : "primary"}
        onClose={() => { setPending(null); setFormError(""); }}
        onConfirm={runPending}
      >
        {formError && <Banner tone="error">{formError}</Banner>}
      </DecisionDialog>
    </div>
  );
}

export function UserDetail() {
  const { id } = useParams();
  const { state, can } = useApp();
  const account = state.accounts.find((item) => item.id === id);
  if (!can("users.manage")) {
    return <EmptyState title="User Management is restricted" body="Only a System admin can view a login account." />;
  }
  if (!account) return <EmptyState title="Account not found" body="That login account is not in this workspace." />;
  const employee = account.employeeId ? state.employees.find((item) => item.id === account.employeeId) : undefined;
  const department = account.departmentId ? state.departments.find((item) => item.id === account.departmentId) : undefined;
  return (
    <div className="narrow">
      <PageHeader title={account.displayName} subtitle="Login account" crumbs={[{ label: "User Management", to: "/users" }, { label: account.email }]} actions={<Link className="btn btn-secondary" to="/users">Back to list</Link>} />
      <section className="panel">
        <dl className="dl">
          <dt>Email</dt><dd>{account.email}</dd>
          <dt>Role</dt><dd>{labelFor(account.role)}</dd>
          <dt>Status</dt><dd><StatusBadge value={account.status} /></dd>
          <dt>Department</dt><dd>{department?.name ?? "—"}</dd>
          <dt>Employee profile</dt><dd>{employee ? <Link to={`/people/${employee.id}`}>{fullName(employee)} · {employee.employeeCode}</Link> : "Not linked"}</dd>
          <dt>Created</dt><dd>{formatDateTime(account.createdAt)}</dd>
          <dt>Updated</dt><dd>{formatDateTime(account.updatedAt)}</dd>
          <dt>Invited</dt><dd>{account.invitedAt ? formatDateTime(account.invitedAt) : "—"}</dd>
          <dt>Activated</dt><dd>{account.activatedAt ? formatDateTime(account.activatedAt) : "—"}</dd>
        </dl>
        <Banner>This record is the login. It is not a copy of the employee profile, and it does not store a password.</Banner>
      </section>
    </div>
  );
}
