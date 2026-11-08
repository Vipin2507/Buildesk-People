import { useNavigate } from "react-router-dom";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useApp } from "../store/store";

export function Notifications() {
  const { state, user, actions } = useApp();
  const navigate = useNavigate();
  if (!user) return null;
  const notes = state.notifications.filter((item) => item.userId === user.id);
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Approvals, attendance, leave, payroll, tickets, birthdays, and events." actions={<Button variant="secondary" onClick={() => actions.markAllNotifications()}>Mark all read</Button>} />
      {notes.length === 0 && <EmptyState title="No notifications" body="Updates about your requests will appear here." />}
      {notes.map((item) => (
        <button
          key={item.id}
          type="button"
          className="panel"
          style={{ display: "block", width: "100%", textAlign: "left", fontWeight: item.read ? 500 : 700 }}
          onClick={() => { actions.markNotification(item.id); navigate(item.href); }}
        >
          <strong>{item.title}</strong>
          <div className="muted">{item.body}</div>
          <div className="faint">{formatDateTime(item.createdAt)} · {item.read ? "Read" : "Unread"}</div>
        </button>
      ))}
    </div>
  );
}
