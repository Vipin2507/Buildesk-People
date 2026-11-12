import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banner, Button, DatePicker, DecisionDialog, EmptyState, Field, StatusBadge } from "../../components/ui";
import { MASTER_CATEGORIES, mastersInUse } from "../../domain/masters";
import { formatDate, formatDateTime, formatHolidayDate, fullName } from "../../lib/format";
import { useApp } from "../../store/store";
import type { CompanyEvent, Holiday, LeaveType, MasterKind } from "../../types";

type BuiltInKind = "departments" | "locations" | "leave_types" | "expense_categories" | "ticket_categories" | "holidays" | "events";

const BUILT_IN: Array<{ id: BuiltInKind; group: string; label: string; description: string }> = [
  { id: "departments", group: "Organization", label: "Departments", description: "Organization units assigned to people." },
  { id: "locations", group: "Organization", label: "Locations / offices", description: "Work sites used for attendance, holidays, and people." },
  { id: "leave_types", group: "Leave & holidays", label: "Leave types", description: "Leave categories, entitlements, and half-day flags." },
  { id: "holidays", group: "Leave & holidays", label: "Company holidays", description: "Configured holiday dates by location. National lists are not invented." },
  { id: "events", group: "Leave & holidays", label: "Company events & festivals", description: "All-day calendar events managed as company data." },
  { id: "expense_categories", group: "Employee support", label: "Expense categories", description: "Categories available on expense claims." },
  { id: "ticket_categories", group: "Employee support", label: "Ticket categories", description: "Categories available on HR tickets." },
];

export function MastersPanel() {
  const { can } = useApp();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState<string>("departments");
  if (!can("settings.org") && !can("leave.manage")) {
    return <EmptyState title="Masters unavailable" body="Only HR or system administrators can manage master values." />;
  }

  const groups = ["all", ...new Set([...BUILT_IN, ...MASTER_CATEGORIES].map((item) => item.group))];
  const catalog = [...BUILT_IN, ...MASTER_CATEGORIES]
    .filter((item) => (group === "all" || item.group === group))
    .filter((item) => {
      if (!can("leave.manage") && (item.id === "leave_types" || item.id === "holidays" || item.id === "events")) return false;
      if (!can("settings.org") && !["leave_types", "holidays", "events"].includes(item.id)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.group.toLowerCase().includes(q);
    });

  const active = catalog.find((item) => item.id === selected) ?? catalog[0];

  return (
    <div className="settings-masters">
      <section className="panel">
        <div className="spread">
          <div>
            <h2>Masters</h2>
            <p className="muted">Searchable company reference lists. Values already used on records are archived instead of deleted.</p>
          </div>
          <Link className="btn btn-secondary btn-sm" to="/leave?tab=holidays">Holiday calendar</Link>
        </div>
        <div className="filters">
          <Field label="Search">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search master lists" />
          </Field>
          <Field label="Group">
            <select value={group} onChange={(event) => setGroup(event.target.value)}>
              {groups.map((item) => <option key={item} value={item}>{item === "all" ? "All groups" : item}</option>)}
            </select>
          </Field>
        </div>
        {catalog.length === 0 ? (
          <EmptyState title="No matching masters" body="Try another search or group." />
        ) : (
          <div className="masters-layout">
            <nav className="masters-nav" aria-label="Master categories">
              {catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === active?.id ? "on" : ""}
                  onClick={() => setSelected(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span className="muted">{item.group}</span>
                </button>
              ))}
            </nav>
            <div className="masters-detail">
              {active && <MasterDetail key={active.id} kind={active.id} label={active.label} description={active.description} />}
            </div>
          </div>
        )}
        <RecentlyChanged />
      </section>
    </div>
  );
}

function RecentlyChanged() {
  const { state } = useApp();
  const rows = state.audits.filter((item) => item.area === "settings" || item.area === "leave").slice(0, 8);
  if (rows.length === 0) return null;
  return (
    <div className="masters-recent">
      <h3>Recently changed</h3>
      {rows.map((item) => {
        const actor = state.employees.find((person) => person.id === item.actorId);
        return (
          <div key={item.id} className="notice split">
            <span>
              <strong>{item.summary}</strong>
              <span className="muted" style={{ display: "block" }}>{actor ? fullName(actor) : "System"} · {item.area}</span>
            </span>
            <span className="muted">{formatDateTime(item.at)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MasterDetail({ kind, label, description }: { kind: string; label: string; description: string }) {
  if (kind === "departments") return <DepartmentsMaster label={label} description={description} />;
  if (kind === "locations") return <LocationsMaster label={label} description={description} />;
  if (kind === "leave_types") return <LeaveTypesMaster label={label} description={description} />;
  if (kind === "expense_categories") return <CategoriesMaster kind="expense" label={label} description={description} />;
  if (kind === "ticket_categories") return <CategoriesMaster kind="ticket" label={label} description={description} />;
  if (kind === "holidays") return <HolidaysMaster label={label} description={description} />;
  if (kind === "events") return <EventsMaster label={label} description={description} />;
  return <ConfigurableMaster kind={kind as MasterKind} label={label} description={description} />;
}

function MasterHeader({ label, description }: { label: string; description: string }) {
  return (
    <div className="masters-detail-head">
      <h3>{label}</h3>
      <p className="muted">{description}</p>
    </div>
  );
}

function DepartmentsMaster({ label, description }: { label: string; description: string }) {
  const { state, actions } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <div>
      <MasterHeader label={label} description={description} />
      {error && <Banner tone="error">{error}</Banner>}
      {state.departments.map((item) => (
        <div key={item.id} className="notice split">
          <div>
            <strong>{item.name}</strong>
            <div className="muted">{item.active === false ? "Archived — hidden from new assignments" : "Active"}</div>
          </div>
          <div className="actions">
            <StatusBadge value={item.active === false ? "inactive" : "active"} />
            {item.active === false
              ? <Button size="sm" variant="secondary" onClick={async () => { const result = await actions.restoreDepartment(item.id); setError(result.ok ? "" : result.message); }}>Restore</Button>
              : <Button size="sm" variant="ghost" onClick={() => setConfirmId(item.id)}>Archive / remove</Button>}
          </div>
        </div>
      ))}
      <Field label="New department"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Button onClick={async () => {
        const result = await actions.addDepartment(name);
        setError(result.ok ? "" : result.message);
        if (result.ok) setName("");
      }}>Add department</Button>
      <DecisionDialog
        open={Boolean(confirmId)}
        title="Archive or remove department?"
        body="If employees still use this department it will be archived. Otherwise it is removed."
        confirmLabel="Continue"
        tone="danger"
        onClose={() => setConfirmId(null)}
        onConfirm={async () => {
          if (!confirmId) return;
          const result = await actions.deleteDepartment(confirmId);
          setError(result.ok ? "" : result.message);
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function LocationsMaster({ label, description }: { label: string; description: string }) {
  const { state, actions } = useApp();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [kind, setKind] = useState<"office" | "remote" | "client">("office");
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  return (
    <div>
      <MasterHeader label={label} description={description} />
      {error && <Banner tone="error">{error}</Banner>}
      {state.locations.map((item) => (
        <div key={item.id} className="notice split">
          <div>
            <strong>{item.name}</strong>
            <div className="muted">{item.city} · {item.kind} · {item.active === false ? "Archived" : "Active"}</div>
          </div>
          <div className="actions">
            <StatusBadge value={item.active === false ? "inactive" : "active"} />
            {item.active === false
              ? <Button size="sm" variant="secondary" onClick={async () => { const result = await actions.restoreLocation(item.id); setError(result.ok ? "" : result.message); }}>Restore</Button>
              : <Button size="sm" variant="ghost" onClick={() => setConfirmId(item.id)}>Archive / remove</Button>}
          </div>
        </div>
      ))}
      <div className="form-grid">
        <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="City"><input value={city} onChange={(event) => setCity(event.target.value)} /></Field>
        <Field label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="office">Office</option>
            <option value="remote">Remote</option>
            <option value="client">Client site</option>
          </select>
        </Field>
      </div>
      <Button onClick={async () => {
        const result = await actions.addLocation({ name, city, kind });
        setError(result.ok ? "" : result.message);
        if (result.ok) { setName(""); setCity(""); }
      }}>Add location</Button>
      <DecisionDialog
        open={Boolean(confirmId)}
        title="Archive or remove location?"
        body="If employees, holidays, or events still use this location it will be archived."
        confirmLabel="Continue"
        tone="danger"
        onClose={() => setConfirmId(null)}
        onConfirm={async () => {
          if (!confirmId) return;
          const result = await actions.deleteLocation(confirmId);
          setError(result.ok ? "" : result.message);
          setConfirmId(null);
        }}
      />
    </div>
  );
}

function LeaveTypesMaster({ label, description }: { label: string; description: string }) {
  const { state, actions, can } = useApp();
  const [draft, setDraft] = useState({ name: "", annual: "", paid: true, allowHalfDay: true });
  const [error, setError] = useState("");
  if (!can("leave.manage")) return <Banner tone="info">Leave types require leave.manage permission.</Banner>;
  return (
    <div>
      <MasterHeader label={label} description={description} />
      <Banner tone="info">Changing entitlements updates balance calculations for current requests. Historical payroll is not recalculated here.</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      {state.settings.leaveTypes.map((type) => (
        <LeaveTypeEditor key={type.id} type={type} onError={setError} />
      ))}
      <h4>Add leave type</h4>
      <div className="form-grid">
        <Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
        <Field label="Annual days"><input value={draft.annual} onChange={(event) => setDraft({ ...draft, annual: event.target.value })} placeholder="Blank = no cap" /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={draft.paid} onChange={(event) => setDraft({ ...draft, paid: event.target.checked })} /><span>Paid</span></label>
      <label className="check"><input type="checkbox" checked={draft.allowHalfDay} onChange={(event) => setDraft({ ...draft, allowHalfDay: event.target.checked })} /><span>Allow half day</span></label>
      <Button onClick={async () => {
        const result = await actions.addLeaveType({
          name: draft.name,
          paid: draft.paid,
          allowHalfDay: draft.allowHalfDay,
          annual: draft.annual.trim() === "" ? null : Number(draft.annual),
        });
        setError(result.ok ? "" : result.message);
        if (result.ok) setDraft({ name: "", annual: "", paid: true, allowHalfDay: true });
      }}>Add leave type</Button>
    </div>
  );
}

function LeaveTypeEditor({ type, onError }: { type: LeaveType; onError: (value: string) => void }) {
  const { actions } = useApp();
  const [name, setName] = useState(type.name);
  const [annual, setAnnual] = useState(type.annual === null ? "" : String(type.annual));
  const [paid, setPaid] = useState(type.paid);
  const [half, setHalf] = useState(type.allowHalfDay);
  return (
    <div className="notice">
      <div className="spread">
        <StatusBadge value={type.active === false ? "inactive" : "active"} />
        <div className="actions">
          {type.active === false
            ? <Button size="sm" variant="secondary" onClick={async () => { const result = await actions.setLeaveTypeActive(type.id, true); onError(result.ok ? "" : result.message); }}>Restore</Button>
            : <Button size="sm" variant="ghost" onClick={async () => { const result = await actions.setLeaveTypeActive(type.id, false); onError(result.ok ? "" : result.message); }}>Archive</Button>}
        </div>
      </div>
      <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Annual days"><input value={annual} onChange={(event) => setAnnual(event.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /><span>Paid</span></label>
      <label className="check"><input type="checkbox" checked={half} onChange={(event) => setHalf(event.target.checked)} /><span>Allow half day</span></label>
      <Button size="sm" onClick={async () => {
        const result = await actions.updateLeaveType({ ...type, name, paid, allowHalfDay: half, annual: annual.trim() === "" ? null : Number(annual) });
        onError(result.ok ? "" : result.message);
      }}>Save</Button>
    </div>
  );
}

function CategoriesMaster({ kind, label, description }: { kind: "expense" | "ticket"; label: string; description: string }) {
  const { state, actions } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const list = kind === "expense" ? state.settings.expenseCategories : state.settings.ticketCategories;
  return (
    <div>
      <MasterHeader label={label} description={description} />
      {error && <Banner tone="error">{error}</Banner>}
      {list.map((item) => (
        <div key={item} className="notice split">
          <span>{item}</span>
          <Button size="sm" variant="ghost" onClick={async () => { const result = await actions.removeCategory(kind, item); setError(result.ok ? "" : result.message); }}>Remove</Button>
        </div>
      ))}
      <Field label="New category"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Button onClick={async () => {
        const result = await actions.addCategory(kind, name);
        setError(result.ok ? "" : result.message);
        if (result.ok) setName("");
      }}>Add category</Button>
    </div>
  );
}

function HolidaysMaster({ label, description }: { label: string; description: string }) {
  const { state, actions, can } = useApp();
  const emptyHoliday: Holiday = { id: "", name: "", date: "", locationId: "all", recurrence: "once" };
  const [holiday, setHoliday] = useState<Holiday>(emptyHoliday);
  const [error, setError] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  if (!can("leave.manage")) return <Banner tone="info">Holiday masters require leave.manage.</Banner>;
  return (
    <div>
      <MasterHeader label={label} description={description} />
      <Banner tone="info">
        Fixed days can repeat every year. Lunar festivals stay one-time for the year you configure — do not invent next year’s festival dates.
      </Banner>
      {error && <Banner tone="error">{error}</Banner>}
      {state.holidays.length === 0 && <EmptyState title="No holidays" body="Add company holidays for the offices that observe them." />}
      {state.holidays.sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || a.date.localeCompare(b.date)).map((item) => (
        <div key={item.id} className="notice split">
          <div>
            <strong>{item.name}</strong>
            <div className="muted">{formatHolidayDate(item.date, item.recurrence)} · {item.locationId === "all" ? "All offices" : state.locations.find((loc) => loc.id === item.locationId)?.name}</div>
          </div>
          <div className="actions">
            <Button size="sm" variant="secondary" onClick={() => setHoliday({ ...item, recurrence: item.recurrence ?? "once" })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoveId(item.id)}>Remove</Button>
          </div>
        </div>
      ))}
      <h4>{holiday.id ? "Edit holiday" : "Add holiday"}</h4>
      <Field label="Name"><input value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} /></Field>
      <Field label="Date"><DatePicker value={holiday.date} onChange={(date) => setHoliday({ ...holiday, date })} /></Field>
      <Field label="Repeats">
        <select
          value={holiday.recurrence ?? "once"}
          onChange={(event) => setHoliday({ ...holiday, recurrence: event.target.value as Holiday["recurrence"] })}
        >
          <option value="once">One-time date (this year only)</option>
          <option value="annual">Every year on this month and day</option>
        </select>
      </Field>
      <Field label="Applies to">
        <select value={holiday.locationId} onChange={(event) => setHoliday({ ...holiday, locationId: event.target.value })}>
          <option value="all">All offices</option>
          {state.locations.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.saveHoliday(holiday);
          setError(result.ok ? "" : result.message);
          if (result.ok) setHoliday(emptyHoliday);
        }}>{holiday.id ? "Update holiday" : "Save holiday"}</Button>
        {holiday.id && <Button variant="secondary" onClick={() => setHoliday(emptyHoliday)}>Cancel</Button>}
      </div>
      <DecisionDialog
        open={Boolean(removeId)}
        title="Remove holiday?"
        body="Leave calculations will no longer treat this date as a holiday."
        confirmLabel="Remove"
        tone="danger"
        onClose={() => setRemoveId(null)}
        onConfirm={async () => {
          if (!removeId) return;
          await actions.deleteHoliday(removeId);
          setRemoveId(null);
        }}
      />
    </div>
  );
}

function EventsMaster({ label, description }: { label: string; description: string }) {
  const { state, actions, can } = useApp();
  const empty: CompanyEvent = { id: "", title: "", date: "", endDate: "", locationId: "all", description: "", kind: "event" };
  const [form, setForm] = useState<CompanyEvent>(empty);
  const [error, setError] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  if (!can("leave.manage")) return <Banner tone="info">Event masters require leave.manage.</Banner>;
  return (
    <div>
      <MasterHeader label={label} description={description} />
      {error && <Banner tone="error">{error}</Banner>}
      {state.events.length === 0 && <EmptyState title="No events" body="Add company events or festivals for the calendar." />}
      {state.events.map((item) => (
        <div key={item.id} className="notice split">
          <div>
            <strong>{item.title}</strong>
            <div className="muted">{item.kind} · {formatDate(item.date)}{item.endDate && item.endDate !== item.date ? ` – ${formatDate(item.endDate)}` : ""}</div>
          </div>
          <div className="actions">
            <Button size="sm" variant="secondary" onClick={() => setForm({ ...item, endDate: item.endDate ?? "" })}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoveId(item.id)}>Remove</Button>
          </div>
        </div>
      ))}
      <h4>{form.id ? "Edit event" : "Add event"}</h4>
      <Field label="Title"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></Field>
      <Field label="Type">
        <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as CompanyEvent["kind"] })}>
          <option value="event">Company event</option>
          <option value="festival">Festival / national</option>
        </select>
      </Field>
      <Field label="Start date"><DatePicker value={form.date} onChange={(date) => setForm({ ...form, date })} /></Field>
      <Field label="End date"><DatePicker value={form.endDate ?? ""} onChange={(endDate) => setForm({ ...form, endDate })} placeholder="Same as start" /></Field>
      <Field label="Location">
        <select value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}>
          <option value="all">All offices</option>
          {state.locations.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Description"><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.saveEvent(form);
          setError(result.ok ? "" : result.message);
          if (result.ok) setForm(empty);
        }}>{form.id ? "Update event" : "Save event"}</Button>
        {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Cancel</Button>}
      </div>
      <DecisionDialog
        open={Boolean(removeId)}
        title="Remove event?"
        body="This removes the event from the company calendar. The change is audited."
        confirmLabel="Remove"
        tone="danger"
        onClose={() => setRemoveId(null)}
        onConfirm={async () => {
          if (!removeId) return;
          await actions.deleteEvent(removeId);
          setRemoveId(null);
        }}
      />
    </div>
  );
}

function ConfigurableMaster({ kind, label, description }: { kind: MasterKind; label: string; description: string }) {
  const { state, actions } = useApp();
  const list = useMemo(() => state.masters?.[kind] ?? [], [state.masters, kind]);
  const [draft, setDraft] = useState({ id: "", name: "", code: "", description: "" });
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ id: string; mode: "archive" | "delete" } | null>(null);

  return (
    <div>
      <MasterHeader label={label} description={description} />
      {kind.startsWith("payroll_") && (
        <Banner tone="info">These are display names only. Contribution rates, tax rules, and formulas are not configured here.</Banner>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {list.map((item) => {
        const used = mastersInUse(state, kind, item);
        return (
          <div key={item.id} className="notice split">
            <div>
              <strong>{item.name}</strong>
              <div className="muted">
                {item.code ? `Code ${item.code} · ` : ""}
                {item.active === false ? "Archived" : "Active"}
                {used ? ` · ${used}` : ""}
                {item.updatedAt ? ` · Updated ${formatDateTime(item.updatedAt)}` : ""}
              </div>
              {item.description && <div className="muted">{item.description}</div>}
            </div>
            <div className="actions">
              <StatusBadge value={item.active === false ? "inactive" : "active"} />
              <Button size="sm" variant="secondary" onClick={() => setDraft({ id: item.id, name: item.name, code: item.code ?? "", description: item.description ?? "" })}>Edit</Button>
              {item.active === false
                ? <Button size="sm" variant="secondary" onClick={async () => { const result = await actions.setMasterActive(kind, item.id, true); setError(result.ok ? "" : result.message); }}>Restore</Button>
                : <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: item.id, mode: "archive" })}>Archive</Button>}
              <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: item.id, mode: "delete" })}>Delete</Button>
            </div>
          </div>
        );
      })}
      <h4>{draft.id ? "Edit value" : "Add value"}</h4>
      <Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Code (optional)" hint="Use for values mapped to system codes such as office or laptop.">
        <input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
      </Field>
      <Field label="Description"><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field>
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.saveMasterValue(kind, draft);
          setError(result.ok ? "" : result.message);
          if (result.ok) setDraft({ id: "", name: "", code: "", description: "" });
        }}>{draft.id ? "Update value" : "Add value"}</Button>
        {draft.id && <Button variant="secondary" onClick={() => setDraft({ id: "", name: "", code: "", description: "" })}>Cancel</Button>}
      </div>
      <DecisionDialog
        open={Boolean(confirm)}
        title={confirm?.mode === "delete" ? "Delete master value?" : "Archive master value?"}
        body={confirm?.mode === "delete"
          ? "Deletion is blocked when records still reference this value. Prefer archive for referenced masters."
          : "Archived values stay on historical records but are hidden from new selections."}
        confirmLabel={confirm?.mode === "delete" ? "Delete" : "Archive"}
        tone="danger"
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm) return;
          const result = confirm.mode === "delete"
            ? await actions.deleteMasterValue(kind, confirm.id)
            : await actions.setMasterActive(kind, confirm.id, false);
          setError(result.ok ? "" : result.message);
          setConfirm(null);
        }}
      />
    </div>
  );
}
