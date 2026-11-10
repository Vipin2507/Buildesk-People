import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarLegend, LeaveAgendaList, LeaveMonthGrid, LeaveWeekGrid } from "../components/calendar";
import { Banner, Button, DatePicker, DecisionDialog, EmptyState, Field, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { canReview } from "../lib/access";
import {
  CALENDAR_LEGEND,
  EMPTY_CALENDAR_FILTERS,
  addMonthCursor,
  buildCalendarItems,
  filterCalendarItems,
  filtersActive,
  itemsOnDate,
  monthCursor,
  monthRange,
  paddedMonthRange,
  visibleKindsInItems,
  weekRange,
  type CalendarFilters,
  type CalendarItem,
  type CalendarItemKind,
  type CalendarViewMode,
} from "../domain/calendar";
import { addDays, todayIso } from "../domain/dates";
import { defaultCompOffExpiry, leaveSummaries } from "../domain/leave";
import { formatDate, formatDateLong, fullName, monthLabel, rangeLabel } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { CompanyEvent, Holiday, LeaveRequest, PartialDay } from "../types";

const CAL_STATE_KEY = "buildesk-people-leave-calendar";

export function Leave() {
  const { user, can, state } = useApp();
  if (!user) return null;
  const approvals = state.leaveRequests.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "leave")).length;
  const tabs = [
    { id: "mine", label: "My leave" },
    ...(can("leave.approve") ? [{ id: "approvals", label: "Approvals", count: approvals }] : []),
    { id: "calendar", label: "Calendar" },
    { id: "holidays", label: "Holidays and events" },
    { id: "compoff", label: "Comp-off" },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "mine");
  return (
    <div>
      <PageHeader title="Leave" subtitle="Balances, requests, holidays, and comp-off. Weekends and location holidays are not counted." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <MyLeave />}
      {tab === "approvals" && <Approvals />}
      {tab === "calendar" && <LeaveCalendar />}
      {tab === "holidays" && <Holidays />}
      {tab === "compoff" && <CompOff />}
    </div>
  );
}

function MyLeave() {
  const { state, user, actions } = useApp();
  const [typeId, setType] = useState("casual");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [partial, setPartial] = useState<PartialDay>("none");
  const [reason, setReason] = useState("");
  const [attachmentName, setAttachment] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const summaries = leaveSummaries(state, user.id);
  const mine = state.leaveRequests.filter((item) => item.employeeId === user.id);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Balances this year</h2>
        {summaries.map((item) => (
          <div key={item.typeId} className="notice">
            <div>
              <strong>{item.name}</strong>
              <div className="muted">
                {item.available === null ? "No annual cap" : `${item.available} available`} · {item.used} used · {item.pending} pending
                {item.entitled !== null ? ` · ${item.entitled} entitled` : ""}
                {item.nextExpiry ? ` · soonest expiry ${formatDate(item.nextExpiry)}` : ""}
              </div>
            </div>
            <StatusBadge value={item.paid ? "approved" : "pending"} />
          </div>
        ))}
        <h2>My requests</h2>
        {mine.length === 0 && <EmptyState title="No leave requests" body="Submit a request when you need time away." />}
        {mine.map((item) => <RequestRow key={item.id} item={item} />)}
      </section>
      <section className="panel">
        <h2>Request leave</h2>
        <form noValidate onSubmit={async (event) => {
          event.preventDefault();
          const result = await actions.submitLeave({ typeId, startDate, endDate, partial, reason, attachmentName });
          if (!result.ok) setError(result.message);
          else { setError(""); setReason(""); setAttachment(""); }
        }}>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Type">
            <select value={typeId} onChange={(event) => setType(event.target.value)}>
              {state.settings.leaveTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Start"><DatePicker value={startDate} onChange={setStart} /></Field>
            <Field label="End"><DatePicker value={endDate} onChange={setEnd} min={startDate || undefined} /></Field>
          </div>
          <Field label="Day portion">
            <select value={partial} onChange={(event) => setPartial(event.target.value as PartialDay)}>
              <option value="none">Full day</option>
              <option value="first_half">First half</option>
              <option value="second_half">Second half</option>
            </select>
          </Field>
          <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field label="Attachment (optional)" hint="The file name is stored. The file itself is not uploaded.">
            <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
          </Field>
          <Button type="submit">Submit request</Button>
        </form>
      </section>
    </div>
  );
}

function RequestRow({ item }: { item: LeaveRequest }) {
  const { state } = useApp();
  const type = state.settings.leaveTypes.find((entry) => entry.id === item.typeId);
  return (
    <div className="notice">
      <div>
        <strong>{type?.name ?? "Leave"} · {rangeLabel(item.startDate, item.endDate)}</strong>
        <div className="muted">{item.days} day{item.days === 1 ? "" : "s"} · {item.reason}</div>
        {item.reviewComment && <div className="muted">Reviewer: {item.reviewComment}</div>}
      </div>
      <StatusBadge value={item.status} />
    </div>
  );
}

function Approvals() {
  const { state, user, actions } = useApp();
  const [active, setActive] = useState<LeaveRequest | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  if (!user) return null;
  const rows = state.leaveRequests.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "leave"));
  return (
    <section className="panel">
      <h2>Waiting for your review</h2>
      {rows.length === 0 && <EmptyState title="Nothing to review" body="New requests from your team, or from employees whose manager can't review, will show up here." />}
      {rows.map((item) => {
        const person = state.employees.find((entry) => entry.id === item.employeeId);
        const type = state.settings.leaveTypes.find((entry) => entry.id === item.typeId);
        return (
          <div key={item.id} className="notice">
            <div>
              <strong>{person ? fullName(person) : "Employee"} · {type?.name}</strong>
              <div className="muted">{rangeLabel(item.startDate, item.endDate)} · {item.days} day{item.days === 1 ? "" : "s"} · {item.reason}</div>
            </div>
            <div className="actions">
              <Button size="sm" onClick={async () => { setActive(item); setDecision("approved"); }}>Approve</Button>
              <Button size="sm" variant="danger" onClick={async () => { setActive(item); setDecision("rejected"); }}>Reject</Button>
            </div>
          </div>
        );
      })}
      <DecisionDialog
        open={Boolean(active)}
        title={decision === "approved" ? "Approve leave" : "Reject leave"}
        body={active ? `${fullName(state.employees.find((item) => item.id === active.employeeId)!)} · ${rangeLabel(active.startDate, active.endDate)}` : ""}
        confirmLabel={decision === "approved" ? "Approve leave" : "Reject leave"}
        tone={decision === "approved" ? "primary" : "danger"}
        requireComment={decision === "rejected"}
        onClose={() => setActive(null)}
        onConfirm={async (comment) => {
          if (!active) return;
          const result = await actions.decideLeave(active.id, decision, comment);
          if (result.ok) setActive(null);
        }}
      />
    </section>
  );
}

function readCalState(): { cursor: string; view: CalendarViewMode; filters: CalendarFilters; selected: string } {
  const today = todayIso();
  const preferAgenda = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
  const fallback = {
    cursor: monthCursor(today),
    view: (preferAgenda ? "agenda" : "month") as CalendarViewMode,
    filters: { ...EMPTY_CALENDAR_FILTERS },
    selected: today,
  };
  try {
    const raw = sessionStorage.getItem(CAL_STATE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : fallback.cursor,
      view: parsed.view === "week" || parsed.view === "agenda" || parsed.view === "month" ? parsed.view : fallback.view,
      filters: { ...EMPTY_CALENDAR_FILTERS, ...(parsed.filters ?? {}) },
      selected: typeof parsed.selected === "string" ? parsed.selected : fallback.selected,
    };
  } catch {
    return fallback;
  }
}

function LeaveCalendar() {
  const { state, user, can } = useApp();
  const initial = useMemo(() => readCalState(), []);
  const [cursor, setCursor] = useState(initial.cursor);
  const [view, setView] = useState<CalendarViewMode>(initial.view);
  const [selected, setSelected] = useState(initial.selected);
  const [filters, setFilters] = useState<CalendarFilters>(initial.filters);
  const [detail, setDetail] = useState<CalendarItem | null>(null);
  const today = todayIso();

  useEffect(() => {
    sessionStorage.setItem(CAL_STATE_KEY, JSON.stringify({ cursor, view, filters, selected }));
  }, [cursor, view, filters, selected]);

  const teamScope = Boolean(user && (can("leave.team") || can("leave.manage")));
  const manage = Boolean(user && can("leave.manage"));
  const rangeStart = view === "week"
    ? weekRange(selected).start
    : view === "agenda"
      ? monthRange(cursor).start
      : paddedMonthRange(cursor).start;
  const rangeEnd = view === "week"
    ? weekRange(selected).end
    : view === "agenda"
      ? monthRange(cursor).end
      : paddedMonthRange(cursor).end;

  const allItems = useMemo(
    () => (user ? buildCalendarItems(state, user, rangeStart, rangeEnd) : []),
    [state, user, rangeStart, rangeEnd],
  );
  const items = useMemo(() => filterCalendarItems(allItems, filters), [allItems, filters]);
  const dayItems = useMemo(() => itemsOnDate(items, selected), [items, selected]);
  const legendKinds = useMemo(() => visibleKindsInItems(allItems), [allItems]);
  const [year, month] = cursor.split("-").map(Number);
  const monthItems = useMemo(() => {
    const { start, end } = monthRange(cursor);
    return items.filter((item) => item.date >= start && item.date <= end);
  }, [items, cursor]);

  const peopleOptions = useMemo(() => {
    if (!user || !teamScope) return [];
    return state.employees
      .filter((person) => {
        if (person.status === "inactive") return false;
        if (manage) return true;
        return person.managerId === user.id || person.id === user.id;
      })
      .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  }, [state.employees, teamScope, manage, user]);

  if (!user) return null;

  const toggleKind = (kind: CalendarItemKind) => {
    setFilters((current) => ({
      ...current,
      kinds: current.kinds.includes(kind) ? current.kinds.filter((item) => item !== kind) : [...current.kinds, kind],
    }));
  };

  const selectDate = (date: string) => {
    setSelected(date);
    setCursor(monthCursor(date));
    setDetail(null);
  };

  const goToday = () => {
    selectDate(today);
  };

  const chipFilters: Array<{ key: string; label: string; clear: () => void }> = [];
  filters.kinds.forEach((kind) => {
    chipFilters.push({
      key: `kind-${kind}`,
      label: CALENDAR_LEGEND.find((item) => item.kind === kind)?.label ?? kind,
      clear: () => setFilters((current) => ({ ...current, kinds: current.kinds.filter((item) => item !== kind) })),
    });
  });
  if (filters.departmentId !== "all") {
    chipFilters.push({
      key: "dept",
      label: state.departments.find((item) => item.id === filters.departmentId)?.name ?? "Department",
      clear: () => setFilters((current) => ({ ...current, departmentId: "all" })),
    });
  }
  if (filters.locationId !== "all") {
    chipFilters.push({
      key: "loc",
      label: state.locations.find((item) => item.id === filters.locationId)?.name ?? "Location",
      clear: () => setFilters((current) => ({ ...current, locationId: "all" })),
    });
  }
  if (filters.employeeId !== "all") {
    const person = state.employees.find((item) => item.id === filters.employeeId);
    chipFilters.push({
      key: "emp",
      label: person ? fullName(person) : "Employee",
      clear: () => setFilters((current) => ({ ...current, employeeId: "all" })),
    });
  }
  if (filters.status !== "all") {
    chipFilters.push({
      key: "status",
      label: filters.status === "approved" ? "Approved leave" : "Pending leave",
      clear: () => setFilters((current) => ({ ...current, status: "all" })),
    });
  }

  return (
    <div className="leave-calendar">
      <section className="panel">
        <div className="leave-cal-intro">
          <div>
            <h2>{teamScope ? "Team and company calendar" : "My calendar"}</h2>
            <p className="muted">
              Holidays, events, birthdays, and leave you are allowed to see. Dates use your local calendar day; the office clock is Asia/Kolkata.
            </p>
          </div>
          {manage && <Link className="btn btn-secondary btn-sm" to="/leave?tab=holidays">Manage holidays & events</Link>}
        </div>

        <div className="panel-toolbar leave-cal-toolbar">
          <div className="leave-cal-nav">
            <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => {
              if (view === "week") selectDate(addDays(selected, -7));
              else setCursor(addMonthCursor(cursor, -1));
            }}>
              Prev
            </Button>
            <strong className="leave-cal-title">
              {view === "week"
                ? `${formatDate(weekRange(selected).start)} – ${formatDate(weekRange(selected).end)}`
                : monthLabel(year, (month || 1) - 1)}
            </strong>
            <Button variant="secondary" size="sm" aria-label="Next" onClick={() => {
              if (view === "week") selectDate(addDays(selected, 7));
              else setCursor(addMonthCursor(cursor, 1));
            }}>
              Next
            </Button>
            <Button variant="secondary" size="sm" onClick={goToday}>Today</Button>
          </div>
          <div className="panel-toolbar-actions" role="tablist" aria-label="Calendar view">
            {([
              ["month", "Month"],
              ["week", "Week"],
              ["agenda", "Agenda"],
            ] as const).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={view === id ? "primary" : "secondary"}
                aria-pressed={view === id}
                onClick={() => setView(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="leave-cal-filters filters">
          <Field label="Event type">
            <select
              value={filters.kinds[0] && filters.kinds.length === 1 ? filters.kinds[0] : "all"}
              onChange={(event) => {
                const value = event.target.value;
                setFilters((current) => ({
                  ...current,
                  kinds: value === "all" ? [] : [value as CalendarItemKind],
                }));
              }}
            >
              <option value="all">All types</option>
              {CALENDAR_LEGEND.map((item) => (
                <option key={item.kind} value={item.kind}>{item.label}</option>
              ))}
            </select>
          </Field>
          {(teamScope || manage) && (
            <Field label="Leave status">
              <select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value as CalendarFilters["status"] })}>
                <option value="all">All statuses</option>
                <option value="approved">Approved leave</option>
                <option value="pending">Pending leave</option>
              </select>
            </Field>
          )}
          {teamScope && (
            <Field label="Employee">
              <select value={filters.employeeId} onChange={(event) => setFilters({ ...filters, employeeId: event.target.value })}>
                <option value="all">Everyone in view</option>
                {peopleOptions.map((person) => <option key={person.id} value={person.id}>{fullName(person)}</option>)}
              </select>
            </Field>
          )}
          {(teamScope || manage) && (
            <Field label="Department">
              <select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })}>
                <option value="all">All departments</option>
                {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
          {(teamScope || manage) && (
            <Field label="Location">
              <select value={filters.locationId} onChange={(event) => setFilters({ ...filters, locationId: event.target.value })}>
                <option value="all">All locations</option>
                {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          )}
        </div>

        {chipFilters.length > 0 && (
          <div className="filter-chips" aria-label="Active filters">
            {chipFilters.map((chip) => (
              <button key={chip.key} type="button" className="filter-chip" onClick={chip.clear}>
                {chip.label} ×
              </button>
            ))}
            {filtersActive(filters) && (
              <Button size="sm" variant="ghost" onClick={() => setFilters({ ...EMPTY_CALENDAR_FILTERS })}>Clear filters</Button>
            )}
          </div>
        )}

        <CalendarLegend kinds={legendKinds} />

        <div className="leave-cal-type-toggles" aria-label="Quick type filters">
          {CALENDAR_LEGEND.filter((item) => legendKinds.includes(item.kind)).map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`filter-chip kind-toggle ${filters.kinds.includes(item.kind) ? "on" : ""}`}
              aria-pressed={filters.kinds.includes(item.kind)}
              onClick={() => toggleKind(item.kind)}
            >
              <i className={`kind-${item.kind}`} aria-hidden />
              {item.label}
            </button>
          ))}
        </div>

        {view === "month" && (
          <LeaveMonthGrid
            cursor={cursor}
            selected={selected}
            today={today}
            items={items}
            onSelect={selectDate}
            onCursorChange={setCursor}
          />
        )}
        {view === "week" && (
          <LeaveWeekGrid selected={selected} today={today} items={items} onSelect={selectDate} />
        )}
        {view === "agenda" && (
          <LeaveAgendaList
            items={monthItems}
            selected={selected}
            onSelect={selectDate}
            emptyTitle="Nothing in this month"
            emptyBody="Try another month or clear filters."
          />
        )}

        <div className="actions leave-cal-cta">
          <Link className="btn btn-primary btn-sm" to="/leave?tab=mine">Request leave</Link>
          {can("leave.approve") && <Link className="btn btn-secondary btn-sm" to="/leave?tab=approvals">Open approvals</Link>}
        </div>
      </section>

      <section className="panel leave-cal-day-panel" aria-live="polite">
        <h2>{formatDateLong(selected)}</h2>
        <p className="muted">Selected day details for your visibility.</p>
        {dayItems.length === 0 ? (
          <EmptyState title="Nothing scheduled" body="No holidays, events, birthdays, or leave on this date for your view." />
        ) : (
          <ul className="leave-day-list">
            {dayItems.map((item) => (
              <li key={item.id}>
                <button type="button" className={`leave-day-item kind-${item.kind}`} onClick={() => setDetail(item)}>
                  <span className="leave-day-kind">{CALENDAR_LEGEND.find((entry) => entry.kind === item.kind)?.label ?? item.kind}</span>
                  <strong>{item.title}</strong>
                  <span className="muted">{item.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <div className="modal-back" onMouseDown={() => setDetail(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={detail.title} onMouseDown={(event) => event.stopPropagation()}>
            <div className="spread">
              <h2>{detail.title}</h2>
              <Button variant="ghost" onClick={() => setDetail(null)} aria-label="Close dialog">Close</Button>
            </div>
            <dl className="dl">
              <dt>Type</dt><dd>{CALENDAR_LEGEND.find((item) => item.kind === detail.kind)?.label ?? detail.kind}</dd>
              <dt>Date</dt><dd>{formatDateLong(detail.date)}{detail.endDate && detail.endDate !== detail.date ? ` – ${formatDate(detail.endDate)}` : ""}</dd>
              <dt>Details</dt><dd>{detail.detail}</dd>
            </dl>
            <Banner tone="info">Private leave reasons are not shown on the calendar.</Banner>
            <div className="actions">
              {detail.href && <Link className="btn btn-primary" to={detail.href} onClick={() => setDetail(null)}>Open related page</Link>}
              {(detail.kind === "leave" || detail.kind === "leave_pending") && detail.employeeId === user.id && (
                <Link className="btn btn-secondary" to="/leave?tab=mine" onClick={() => setDetail(null)}>My leave</Link>
              )}
              <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const EMPTY_EVENT: CompanyEvent = { id: "", title: "", date: "", endDate: "", locationId: "all", description: "", kind: "event" };

function Holidays() {
  const { state, user, can, actions } = useApp();
  const [holiday, setHoliday] = useState<Holiday>({ id: "", name: "", date: "", locationId: "all" });
  const [eventForm, setEventForm] = useState<CompanyEvent>(EMPTY_EVENT);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [removeHolidayId, setRemoveHolidayId] = useState<string | null>(null);
  const [removeEventId, setRemoveEventId] = useState<string | null>(null);
  if (!user) return null;
  const manage = can("leave.manage");
  const visibleHolidays = state.holidays
    .filter((item) => manage || item.locationId === "all" || item.locationId === user.locationId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const visibleEvents = state.events
    .filter((item) => manage || item.locationId === "all" || item.locationId === user.locationId)
    .sort((a, b) => a.date.localeCompare(b.date));
  const locationName = (locationId: string) => (locationId === "all" ? "All offices" : state.locations.find((loc) => loc.id === locationId)?.name ?? "One office");

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Holidays for your location</h2>
        <p className="muted">Company holidays block leave counting for the selected offices. Configure dates here — national lists are not imported automatically.</p>
        {visibleHolidays.length === 0 && <EmptyState title="No holidays yet" body={manage ? "Add company holidays for the offices that observe them." : "No holidays apply to your location yet."} />}
        {visibleHolidays.map((item) => (
          <div key={item.id} className="notice split">
            <div>
              <strong>{item.name}</strong>
              <div className="muted">{formatDate(item.date)} · {locationName(item.locationId)}</div>
            </div>
            {manage && (
              <div className="actions">
                <Button size="sm" variant="secondary" onClick={() => { setHoliday(item); setError(""); }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoveHolidayId(item.id)}>Remove</Button>
              </div>
            )}
          </div>
        ))}
        <h2>Company events and festivals</h2>
        <p className="muted">Events are all-day. Festivals and national observances use the festival type so they appear distinctly on the calendar.</p>
        {visibleEvents.length === 0 && <EmptyState title="No events yet" body={manage ? "Add company events or festivals for the calendar." : "No events apply to your location yet."} />}
        {visibleEvents.map((item) => (
          <div key={item.id} className="notice split">
            <div>
              <strong>{item.title}</strong>
              <div className="muted">
                {item.kind === "festival" ? "Festival / national" : "Company event"} · {formatDate(item.date)}
                {item.endDate && item.endDate !== item.date ? ` – ${formatDate(item.endDate)}` : ""} · {locationName(item.locationId)}
                {item.description ? ` · ${item.description}` : ""}
              </div>
            </div>
            {manage && (
              <div className="actions">
                <Button size="sm" variant="secondary" onClick={() => { setEventForm({ ...item, endDate: item.endDate ?? "" }); setPreview(false); setError(""); }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => setRemoveEventId(item.id)}>Remove</Button>
              </div>
            )}
          </div>
        ))}
      </section>
      {manage ? (
        <section className="panel">
          <h2>{holiday.id ? "Edit holiday" : "Add a holiday"}</h2>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Name"><input value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} /></Field>
          <Field label="Date"><DatePicker value={holiday.date} onChange={(date) => setHoliday({ ...holiday, date })} /></Field>
          <Field label="Applies to">
            <select value={holiday.locationId} onChange={(event) => setHoliday({ ...holiday, locationId: event.target.value })}>
              <option value="all">All offices</option>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="actions">
            <Button onClick={async () => {
              const result = await actions.saveHoliday(holiday);
              if (!result.ok) setError(result.message);
              else { setHoliday({ id: "", name: "", date: "", locationId: "all" }); setError(""); }
            }}>{holiday.id ? "Update holiday" : "Save holiday"}</Button>
            {holiday.id && <Button variant="secondary" onClick={() => setHoliday({ id: "", name: "", date: "", locationId: "all" })}>Cancel edit</Button>}
          </div>

          <h2>{eventForm.id ? "Edit event" : "Add an event or festival"}</h2>
          <Banner tone="info">Timed reminders and recurring series are not wired yet. Changes are audited when you save or remove.</Banner>
          <Field label="Title"><input value={eventForm.title} onChange={(event) => setEventForm({ ...eventForm, title: event.target.value })} /></Field>
          <Field label="Type">
            <select value={eventForm.kind} onChange={(event) => setEventForm({ ...eventForm, kind: event.target.value as CompanyEvent["kind"] })}>
              <option value="event">Company event</option>
              <option value="festival">Festival / national holiday</option>
            </select>
          </Field>
          <Field label="Start date"><DatePicker value={eventForm.date} onChange={(date) => setEventForm({ ...eventForm, date })} /></Field>
          <Field label="End date (optional)">
            <DatePicker value={eventForm.endDate ?? ""} onChange={(endDate) => setEventForm({ ...eventForm, endDate })} min={eventForm.date || undefined} placeholder="Same as start" />
          </Field>
          <Field label="Audience / location">
            <select value={eventForm.locationId} onChange={(event) => setEventForm({ ...eventForm, locationId: event.target.value })}>
              <option value="all">All offices</option>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea value={eventForm.description} onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })} /></Field>
          <label className="check"><input type="checkbox" checked={preview} onChange={(event) => setPreview(event.target.checked)} /><span>Preview before saving</span></label>
          {preview && (
            <div className="notice">
              <div>
                <strong>{eventForm.title || "Untitled"}</strong>
                <div className="muted">
                  {eventForm.kind === "festival" ? "Festival / national" : "Company event"} · All day · {eventForm.date ? formatDate(eventForm.date) : "—"}
                  {eventForm.endDate && eventForm.endDate !== eventForm.date ? ` – ${formatDate(eventForm.endDate)}` : ""} · {locationName(eventForm.locationId)}
                  {eventForm.description ? ` · ${eventForm.description}` : ""}
                </div>
              </div>
            </div>
          )}
          <div className="actions">
            <Button variant="secondary" disabled={preview && !eventForm.title} onClick={async () => {
              if (preview && !window.confirm("Publish this event to the company calendar?")) return;
              const result = await actions.saveEvent(eventForm);
              if (!result.ok) setError(result.message);
              else { setEventForm(EMPTY_EVENT); setPreview(false); setError(""); }
            }}>{eventForm.id ? "Update event" : "Save event"}</Button>
            {eventForm.id && <Button variant="ghost" onClick={() => { setEventForm(EMPTY_EVENT); setPreview(false); }}>Cancel edit</Button>}
          </div>
        </section>
      ) : <Banner tone="info">Holiday dates follow your work location. Company-wide holidays and events apply to every office.</Banner>}

      <DecisionDialog
        open={Boolean(removeHolidayId)}
        title="Remove holiday?"
        body="This removes the holiday from the calendar. Leave calculations will no longer treat that date as a holiday."
        confirmLabel="Remove holiday"
        tone="danger"
        onClose={() => setRemoveHolidayId(null)}
        onConfirm={async () => {
          if (!removeHolidayId) return;
          await actions.deleteHoliday(removeHolidayId);
          setRemoveHolidayId(null);
        }}
      />
      <DecisionDialog
        open={Boolean(removeEventId)}
        title="Remove event?"
        body="This archives the event off the calendar. The change is recorded in audit history."
        confirmLabel="Remove event"
        tone="danger"
        onClose={() => setRemoveEventId(null)}
        onConfirm={async () => {
          if (!removeEventId) return;
          await actions.deleteEvent(removeEventId);
          setRemoveEventId(null);
        }}
      />
    </div>
  );
}

function CompOff() {
  const { state, user, can, actions } = useApp();
  const [employeeId, setEmployee] = useState(user?.id ?? "");
  const [days, setDays] = useState(1);
  const [earnedOn, setEarned] = useState(todayIso());
  const [expiresOn, setExpiry] = useState(defaultCompOffExpiry(todayIso()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const grants = state.compOff.filter((item) => item.employeeId === user.id || can("leave.manage"));
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Comp-off records</h2>
        <p className="muted">Available days can be requested as comp-off leave. Expired days are not usable. A new grant expires after 90 days unless a different date is chosen.</p>
        {grants.length === 0 && <EmptyState title="No comp-off" body="When you work on a weekly off, HR can grant a day here." />}
        {grants.map((item) => {
          const expired = item.status === "available" && item.expiresOn < todayIso();
          const person = state.employees.find((entry) => entry.id === item.employeeId);
          return (
            <div key={item.id} className="notice">
              <div>
                <strong>{person ? fullName(person) : "Employee"} · {item.days} day{item.days === 1 ? "" : "s"}</strong>
                <div className="muted">{item.reason} · earned {formatDate(item.earnedOn)} · expires {formatDate(item.expiresOn)}</div>
              </div>
              <StatusBadge value={expired ? "inactive" : item.status === "used" ? "used" : "available"} />
            </div>
          );
        })}
      </section>
      {can("leave.manage") && (
        <section className="panel">
          <h2>Grant comp-off</h2>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Employee">
            <select value={employeeId} onChange={(event) => setEmployee(event.target.value)}>
              {state.employees.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
            </select>
          </Field>
          <Field label="Days"><input type="number" min={0.5} step={0.5} value={days} onChange={(event) => setDays(Number(event.target.value))} /></Field>
          <Field label="Earned on"><DatePicker value={earnedOn} onChange={(date) => { setEarned(date); setExpiry(defaultCompOffExpiry(date)); }} /></Field>
          <Field label="Expires"><DatePicker value={expiresOn} onChange={setExpiry} min={earnedOn || undefined} /></Field>
          <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Button onClick={async () => {
            const result = await actions.grantCompOff({ employeeId, days, earnedOn, expiresOn, reason });
            if (!result.ok) setError(result.message);
            else { setError(""); setReason(""); }
          }}>Grant comp-off</Button>
        </section>
      )}
    </div>
  );
}
