import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Clock, Laptop, Receipt, Ticket, Users, Wallet } from "lucide-react";
import { MonthCalendar } from "../components/calendar";
import { ClockCard } from "../components/clock";
import { Banner, Button, DecisionDialog, EmptyState, PageHeader, Panel, PersonLink, Stat, StatusBadge } from "../components/ui";
import { upcomingFeed } from "../domain/feed";
import { PAYROLL_ASSUMPTION } from "../domain/payroll";
import {
  approvalQueue,
  attendanceHref,
  attentionItems,
  dayBrief,
  dayContext,
  leaveAvailable,
  overviewKind,
  payrollBrief,
  presenceCounts,
  recentActivity,
  scopedPeople,
  shortcuts,
  type QueueItem,
} from "../domain/overview";
import { formatDate, formatDateLong, formatDateTime, formatMoney, fullName, greeting, labelFor, relativeDay } from "../lib/format";
import { useApp } from "../store/store";

export function Overview() {
  const { state, user, can } = useApp();
  if (!user) return null;
  const context = dayContext(state, user);
  const kind = overviewKind(user.role);
  const attention = attentionItems(state, user);
  const feed = upcomingFeed(state, user, 21);
  const activity = recentActivity(state, user);
  const actions = shortcuts(state, user);
  const payroll = payrollBrief(state, user);
  const showWorkforce = can("attendance.company") || can("attendance.team");
  return (
    <div>
      <PageHeader title="Overview" subtitle="A clear view of the work that needs you today." />
      <section className="welcome">
        <div>
          <p className="eyebrow">{formatDateLong(context.today)} · {context.locationName}</p>
          <h1>{greeting()}, {user.firstName}</h1>
          <p>
            {context.closed === "weekend" && `Today is a weekend. Presence figures use ${formatDate(context.focus)}, the last working day at ${context.locationName}.`}
            {context.closed === "holiday" && `Today is a holiday${context.holidayName ? ` (${context.holidayName})` : ""} at ${context.locationName}. Presence figures use ${formatDate(context.focus)}, the last working day at your location.`}
            {!context.closed && "Presence figures on this page are for today."}
          </p>
        </div>
      </section>

      <Panel title="Needs your attention">
        {attention.length === 0 ? (
          <EmptyState title="You're caught up" body="Nothing is waiting on you right now." />
        ) : (
          <div className="attention-list">
            {attention.map((item) => (
              <Link key={item.id} className="attention-item" to={item.href}>
                <span className={`attention-count tone-${item.priority === "high" ? "amber" : "blue"}`}>{item.count}</span>
                <span>
                  <strong>{item.title}</strong>
                  <span className="muted" style={{ display: "block" }}>{item.status} · {item.action}</span>
                </span>
                <StatusBadge value={item.priority === "high" ? "high" : "pending"} />
              </Link>
            ))}
          </div>
        )}
      </Panel>

      <Summary focus={context.focus} today={context.today} />

      <div className="grid-2">
        <div>
          {showWorkforce ? <Workforce focus={context.focus} today={context.today} closed={context.closed} /> : <EmployeeAttendance />}
          <Approvals />
          {payroll && <PayrollCard />}
          <Panel title="Recent activity" action={activity.source === "audit" ? <Link to="/settings?tab=audit">Audit history</Link> : <Link to="/notifications">Notifications</Link>}>
            <p className="muted">{activity.source === "audit" ? "Changes you are allowed to see." : "Updates sent to you. The wider audit trail is limited to administrators."}</p>
            {activity.items.length === 0 ? (
              <EmptyState title="No recent activity" body={activity.source === "audit" ? "Approvals, payroll changes, and other recorded actions will show up here." : "Requests and decisions that involve you will show up here."} />
            ) : activity.items.map((item) => (
              <div key={item.id} className="notice split">
                <span>
                  <strong>{item.actor}</strong>
                  <span className="muted" style={{ display: "block" }}>{item.action}</span>
                </span>
                <span className="muted">{item.href ? <Link to={item.href}>{formatDateTime(item.at)}</Link> : formatDateTime(item.at)}</span>
              </div>
            ))}
          </Panel>
        </div>
        <div>
          <Panel title="Quick actions">
            {actions.length === 0 ? <p className="muted">No shortcuts are available for your role.</p> : (
              <div className="quick-grid">
                {actions.map((item) => (
                  <Link key={item.id} className="quick-link" to={item.href}><span className="qi tone-blue">{shortcutIcon(item.id)}</span>{item.label}</Link>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Coming up" action={<Link to="/leave?tab=holidays">Holiday calendar</Link>}>
            {feed.length === 0 && <p className="muted">No holidays, events, birthdays, or approved leave in the next three weeks.</p>}
            {feed.slice(0, 6).map((item) => (
              <Link key={item.id} to={item.href} className="notice">
                <span className={`swatch tone-${item.kind === "birthday" ? "violet" : item.kind === "leave" ? "blue" : "amber"}`} />
                <span>
                  <strong>{item.title}</strong>
                  <span className="muted" style={{ display: "block" }}>{relativeDay(item.date)} · {item.detail}</span>
                </span>
              </Link>
            ))}
          </Panel>
          <Panel title="Calendar" action={<Link to="/leave?tab=calendar">Full calendar</Link>}>
            <MonthCalendar
              markers={feed.map((item) => ({ id: item.id, date: item.date, label: item.title, kind: item.kind, href: item.href }))}
              describe={(date) => <DayList date={date} />}
            />
          </Panel>
        </div>
      </div>
      {kind === "payroll" && <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>}
    </div>
  );
}

function shortcutIcon(id: string) {
  if (id === "leave" || id === "reviewLeave") return <CalendarDays size={18} />;
  if (id === "expense") return <Receipt size={18} />;
  if (id === "ticket") return <Ticket size={18} />;
  if (id === "assets") return <Laptop size={18} />;
  if (id === "payslip" || id === "payrollRun" || id === "payrollInputs" || id === "payrollHistory") return <Wallet size={18} />;
  if (id === "addEmployee" || id === "users" || id === "org") return <Users size={18} />;
  return <Clock size={18} />;
}

function Summary({ focus, today }: { focus: string; today: string }) {
  const { state, user, can } = useApp();
  if (!user) return null;
  const kind = overviewKind(user.role);
  const team = scopedPeople(state, user, "team", "all", "all");
  const company = scopedPeople(state, user, "company", "all", "all");
  const people = kind === "manager" ? team : company;
  const counts = presenceCounts(state, people, focus, today);
  const fixes = state.regularizations.filter((item) => item.status === "pending" && (kind === "manager" ? team.some((person) => person.id === item.employeeId) : true)).length;
  const leaveWaiting = state.leaveRequests.filter((item) => item.status === "pending" && (kind === "manager" ? team.some((person) => person.id === item.employeeId) : item.employeeId !== user.id)).length;
  const expenseWaiting = state.expenses.filter((item) => item.status === "pending" && (kind === "manager" ? team.some((person) => person.id === item.employeeId) : item.employeeId !== user.id)).length;
  const own = state.leaveRequests.filter((item) => item.employeeId === user.id && item.status === "pending").length
    + state.regularizations.filter((item) => item.employeeId === user.id && item.status === "pending").length
    + state.expenses.filter((item) => item.employeeId === user.id && item.status === "pending").length;
  const balance = leaveAvailable(state, user.id);
  const record = state.attendance.find((item) => item.employeeId === user.id && item.date === today);
  const upcoming = upcomingFeed(state, user, 45).find((item) => item.kind === "holiday" || item.kind === "event");
  const tickets = state.tickets.filter((item) => item.employeeId === user.id && item.status !== "resolved").length;
  const assets = state.assets.filter((item) => item.assignedTo === user.id).length;
  const payroll = payrollBrief(state, user);
  const cards = kind === "employee" ? [
    { label: "Today's attendance", value: record ? labelFor(record.status) : "Not clocked in", hint: record?.workMode ? labelFor(record.workMode) : "No work location recorded", icon: <Clock size={18} />, tone: "green", to: "/attendance?tab=mine" },
    { label: "Leave available", value: String(balance.total), hint: balance.hint, icon: <CalendarDays size={18} />, tone: "blue", to: "/leave?tab=mine" },
    { label: "Awaiting a decision", value: String(own), hint: "Your leave, corrections, and expenses", icon: <Clock size={18} />, tone: "amber", to: "/leave?tab=mine" },
    { label: "Next on the calendar", value: upcoming ? relativeDay(upcoming.date) : "None", hint: upcoming ? upcoming.title : "No holiday or event soon", icon: <CalendarDays size={18} />, tone: "violet", to: upcoming?.href ?? "/leave?tab=holidays" },
    { label: "Open tickets", value: String(tickets), hint: "Requests you opened", icon: <Ticket size={18} />, tone: "blue", to: "/tickets" },
    { label: "Assigned assets", value: String(assets), hint: "Equipment in your name", icon: <Laptop size={18} />, tone: "teal", to: "/assets" },
  ] : kind === "manager" ? [
    { label: "Team", value: String(counts.headcount), hint: "Active direct reports", icon: <Users size={18} />, tone: "blue", to: "/people" },
    { label: "Team present", value: String(counts.present), hint: `${formatDate(focus)} · includes late arrivals`, icon: <Clock size={18} />, tone: "green", to: attendanceHref("team", focus, "all", "all", false) },
    { label: "Team on leave", value: String(counts.onLeave), hint: `Approved leave covering ${formatDate(today)}`, icon: <CalendarDays size={18} />, tone: "blue", to: "/leave?tab=calendar" },
    { label: "Team exceptions", value: String(counts.exceptions), hint: `${formatDate(focus)} · late, missed punch, or absent`, icon: <Clock size={18} />, tone: "amber", to: attendanceHref("team", focus, "all", "all", false) },
    { label: "Awaiting your review", value: String(leaveWaiting + fixes + expenseWaiting), hint: `${leaveWaiting} leave · ${fixes} corrections · ${expenseWaiting} expenses`, icon: <Receipt size={18} />, tone: "violet", to: leaveWaiting >= fixes && leaveWaiting >= expenseWaiting ? "/leave?tab=approvals" : fixes >= expenseWaiting ? "/attendance?tab=corrections" : "/expenses?tab=approvals" },
  ] : kind === "payroll" ? payrollCards(payroll, state.expenses.filter((item) => item.status === "approved").length, state.settings.currency) : [
    { label: "Active employees", value: String(counts.headcount), hint: "Inactive records stay in history", icon: <Users size={18} />, tone: "blue", to: "/people" },
    { label: "Present", value: String(counts.present), hint: `${formatDate(focus)} · includes late arrivals`, icon: <Clock size={18} />, tone: "green", to: attendanceHref("company", focus, "all", "all", false) },
    { label: "On leave today", value: String(counts.onLeave), hint: `Approved leave covering ${formatDate(today)}`, icon: <CalendarDays size={18} />, tone: "blue", to: "/leave?tab=calendar" },
    { label: "Corrections waiting", value: String(state.regularizations.filter((item) => item.status === "pending").length), hint: "Attendance regularizations", icon: <Clock size={18} />, tone: "amber", to: "/attendance?tab=corrections" },
    { label: "Other approvals", value: String(leaveWaiting + expenseWaiting), hint: `${leaveWaiting} leave · ${expenseWaiting} expenses`, icon: <Receipt size={18} />, tone: "violet", to: "/leave?tab=approvals" },
    { label: "Payroll", value: payroll?.status ? labelFor(payroll.status) : "No run", hint: payroll ? payroll.periodLabel : "Current period is not configured", icon: <Wallet size={18} />, tone: "teal", to: can("payroll.manage") ? (payroll?.run ? `/payroll/${payroll.run.id}` : "/payroll") : undefined },
  ];
  return (
    <div className="stats">
      {cards.map((card) => <Stat key={card.label} {...card} />)}
    </div>
  );
}

function payrollCards(payroll: ReturnType<typeof payrollBrief>, toPay: number, currency: string) {
  const href = payroll?.href ?? "/payroll";
  return [
    { label: "Current period", value: payroll?.periodLabel ?? "—", hint: "From payroll settings", icon: <CalendarDays size={18} />, tone: "blue", to: "/payroll" },
    { label: "Run status", value: payroll?.status ? labelFor(payroll.status) : "No run", hint: payroll?.run ? "Open the run to continue" : "Create a draft when inputs are ready", icon: <Wallet size={18} />, tone: "violet", to: href },
    { label: "Employees in run", value: payroll?.employees === null || payroll?.employees === undefined ? "—" : String(payroll.employees), hint: "Included on the current run", icon: <Users size={18} />, tone: "green", to: href },
    { label: "Exceptions", value: payroll?.exceptions === null || payroll?.exceptions === undefined ? "—" : String(payroll.exceptions), hint: "People who need a look", icon: <Clock size={18} />, tone: "amber", to: href },
    { label: "Payable", value: payroll?.showMoney && payroll.payable !== null ? formatMoney(payroll.payable, currency) : "—", hint: "Gross, adjustments, and reimbursements", icon: <Wallet size={18} />, tone: "teal", to: href },
    { label: "Expenses to pay", value: String(toPay), hint: "Approved and not yet paid", icon: <Receipt size={18} />, tone: "amber", to: "/expenses?tab=pay" },
  ];
}

function EmployeeAttendance() {
  return (
    <div>
      <ClockCard showLinks />
    </div>
  );
}

function Workforce({ focus, today, closed }: { focus: string; today: string; closed: "weekend" | "holiday" | null }) {
  const { state, user, can } = useApp();
  const [scope, setScope] = useState<"company" | "team">(can("attendance.company") ? "company" : "team");
  const [department, setDepartment] = useState("all");
  const [location, setLocation] = useState("all");
  if (!user) return null;
  const people = scopedPeople(state, user, scope, department, location);
  const counts = presenceCounts(state, people, focus, today);
  const tab = scope === "team" && can("attendance.team") ? "team" : "company";
  const href = attendanceHref(tab, focus, department, location, scope === "team");
  return (
    <Panel title="Attendance" action={<Link to={href}>Open attendance</Link>}>
      <p className="muted">
        {closed ? `Counts use ${formatDate(focus)}, the last working day.` : `Counts use ${formatDate(focus)}.`}
        {" "}Work location is the office, remote, or client choice recorded for the day. GPS is not collected.
      </p>
      <div className="filters">
        {can("attendance.company") && can("attendance.team") && (
          <label className="field">People
            <select value={scope} onChange={(event) => setScope(event.target.value as "company" | "team")}>
              <option value="company">Everyone</option>
              <option value="team">My direct reports</option>
            </select>
          </label>
        )}
        <label className="field">Department
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All departments</option>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Work location
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="all">All locations</option>
            {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>
      <div className="snapshot">
        <Link to={href}><strong>{counts.present}</strong><span>Present</span></Link>
        <Link to={href}><strong>{counts.remote}</strong><span>Remote</span></Link>
        <Link to="/leave?tab=calendar"><strong>{counts.onLeave}</strong><span>On leave today</span></Link>
        <Link to={href}><strong>{counts.absent}</strong><span>Absent</span></Link>
        <Link to={href}><strong>{counts.exceptions}</strong><span>Exceptions</span></Link>
      </div>
      {people.length === 0 ? <EmptyState title="No one matches" body="Try another department, location, or team." /> : (
        <p className="faint">{counts.headcount} people in this view. {can("attendance.self") && <Link to="/attendance?tab=mine">Record your own time</Link>}</p>
      )}
    </Panel>
  );
}

function Approvals() {
  const { state, user, actions } = useApp();
  const [active, setActive] = useState<{ item: QueueItem; decision: "approved" | "rejected" } | null>(null);
  const [error, setError] = useState("");
  if (!user) return null;
  const queue = approvalQueue(state, user).slice(0, 6);
  return (
    <Panel title="Pending requests" action={<Link to="/leave?tab=approvals">Leave approvals</Link>}>
      {error && <Banner tone="error">{error}</Banner>}
      {queue.length === 0 ? (
        <EmptyState title="No pending requests" body="Leave, attendance corrections, and expenses that involve you will be listed here." />
      ) : queue.map((item) => {
        const person = state.employees.find((entry) => entry.id === item.employeeId);
        const name = person ? fullName(person) : "Employee";
        return (
          <div key={item.id} className="notice queue-row">
            <PersonLink name={name} color={person?.avatarColor ?? "#1d4ed8"} to={person ? `/people/${person.id}` : "/people"} meta={item.summary} />
            <span>
              <StatusBadge value="pending" />
              <span className="muted" style={{ display: "block" }}>{formatDate(item.submittedAt.slice(0, 10))}</span>
            </span>
            <span className="actions">
              <Link className="btn btn-secondary btn-sm" to={item.href}>Open</Link>
              {item.canDecide && <Button size="sm" onClick={() => { setError(""); setActive({ item, decision: "approved" }); }}>Approve</Button>}
              {item.canDecide && <Button size="sm" variant="danger" onClick={() => { setError(""); setActive({ item, decision: "rejected" }); }}>Reject</Button>}
            </span>
          </div>
        );
      })}
      <DecisionDialog
        open={Boolean(active)}
        title={active?.decision === "rejected" ? "Reject request" : "Approve request"}
        body={active ? `${active.item.summary}. This decision is recorded.` : ""}
        confirmLabel={active?.decision === "rejected" ? "Reject" : "Approve"}
        tone={active?.decision === "rejected" ? "danger" : "primary"}
        requireComment={active?.decision === "rejected"}
        onClose={() => setActive(null)}
        onConfirm={async (comment) => {
          if (!active) return;
          const result = active.item.kind === "leave"
            ? await actions.decideLeave(active.item.id, active.decision, comment)
            : active.item.kind === "expense"
              ? await actions.decideExpense(active.item.id, active.decision, comment)
              : await actions.decideRegularization(active.item.id, active.decision, comment, active.item.requestedIn && active.item.requestedOut ? { requestedIn: active.item.requestedIn, requestedOut: active.item.requestedOut } : undefined);
          if (result.ok) setActive(null);
          else setError(result.message);
        }}
      />
    </Panel>
  );
}

function PayrollCard() {
  const { state, user, can } = useApp();
  if (!user) return null;
  const payroll = payrollBrief(state, user);
  if (!payroll) return null;
  return (
    <Panel title="Payroll" action={can("payroll.manage") ? <Link to={payroll.href}>Open payroll</Link> : undefined}>
      <p><strong>{payroll.periodLabel}</strong> <span className="muted">Configured period</span></p>
      {payroll.status ? <p><StatusBadge value={payroll.status} /> {payroll.latest && <span className="muted"> Latest run is outside the current period.</span>}</p> : <p className="muted">No payroll run for this period.</p>}
      <p>{payroll.step}</p>
      {payroll.showMoney && payroll.payable !== null && (
        <p>{payroll.employees} employees · {payroll.exceptions} to review · Payable {formatMoney(payroll.payable, state.settings.currency)}</p>
      )}
      {!payroll.showMoney && payroll.run?.warnings[0] && <p className="muted">{payroll.run.warnings[0]}</p>}
      {can("payroll.manage") && <p className="faint">Finalizing a run stays on the payroll page and asks you to confirm.</p>}
    </Panel>
  );
}

function DayList({ date }: { date: string }) {
  const { state, user } = useApp();
  if (!user) return null;
  const lines = dayBrief(state, user, date);
  if (lines.length === 0) return <p className="muted">Nothing scheduled on {formatDate(date)}.</p>;
  return (
    <div className="stack">
      {lines.map((line) => (
        <Link key={line.id} to={line.href} className="notice">
          <span><strong>{line.title}</strong><span className="muted" style={{ display: "block" }}>{line.detail}</span></span>
        </Link>
      ))}
    </div>
  );
}
