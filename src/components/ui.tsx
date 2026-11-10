import { useEffect, useState, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { initials, labelFor, toneFor } from "../lib/format";
import type { Toast } from "../store/store";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "primary",
  size,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" }) {
  return <button type={type} className={cx("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} {...props} />;
}

export function StatusBadge({ value }: { value: string }) {
  return <span className={cx("badge", `tone-${toneFor(value)}`)}>{labelFor(value)}</span>;
}

export function Avatar({ name, color, size = 32, photoSrc, labelled = false }: { name: string; color: string; size?: number; photoSrc?: string; labelled?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoSrc]);
  if (photoSrc && !failed) {
    return <img className="avatar" src={photoSrc} alt={labelled ? `${name} profile photo` : ""} width={size} height={size} onError={() => setFailed(true)} />;
  }
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} aria-hidden={!labelled} aria-label={labelled ? `${name} profile photo` : undefined}>
      {initials(name)}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  crumbs?: { label: string; to?: string }[];
}) {
  useEffect(() => {
    document.title = `${title} · Buildesk People`;
  }, [title]);
  return (
    <header className="page-head">
      <div>
        {crumbs && crumbs.length > 0 && (
          <ol className="crumbs">
            {crumbs.map((item, index) => (
              <li key={`${item.label}-${index}`}>
                {item.to && index < crumbs.length - 1 ? <Link to={item.to}>{item.label}</Link> : <span>{item.label}</span>}
                {index < crumbs.length - 1 ? " /" : ""}
              </li>
            ))}
          </ol>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint, icon, tone = "blue", to }: { label: string; value: string; hint: string; icon: ReactNode; tone?: string; to?: string }) {
  const body = (
    <>
      <span className={cx("stat-icon", `tone-${tone}`)}>{icon}</span>
      <span>
        <span className="stat-label">{label}</span>
        <span className="stat-value">{value}</span>
        <span className="stat-hint">{hint}</span>
      </span>
    </>
  );
  return to ? <Link className="stat" to={to}>{body}</Link> : <article className="stat">{body}</article>;
}

export function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="muted">{body}</p>
      {action}
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  return <div className={cx("banner", `banner-${tone}`)} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx("field", className)}>
      <span>
        {label}
        {required && <abbr className="req" title="Required">*</abbr>}
      </span>
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error && <span className="error" role="alert">{error}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-row">
      <input {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string; count?: number }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id} onClick={() => onChange(tab.id)}>
          {tab.label}
          {tab.count ? ` (${tab.count})` : ""}
        </button>
      ))}
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  emptyTitle,
  emptyBody,
  className,
}: {
  columns: { key: string; header: ReactNode; label?: string; render: (row: T) => ReactNode; sort?: "ascending" | "descending" | "none" }[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  emptyTitle: string;
  emptyBody: string;
  className?: string;
}) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} body={emptyBody} />;
  return (
    <div className={cx("table-wrap", className)}>
      <table className="data">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => <th key={column.key} scope="col" aria-sort={column.sort}>{column.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key} data-label={column.label ?? (typeof column.header === "string" ? column.header : undefined)}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({ page, count, total, onPage }: { page: number; count: number; total: number; onPage: (page: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="pager">
      <span className="muted">Page {page} of {count} · {total} records</span>
      <div className="actions">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= count} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function usePage<T>(items: T[], pageSize: number, resetKey: string) {
  const [page, setPage] = useState(1);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setPage(1);
  }
  const count = Math.max(1, Math.ceil(items.length / pageSize));
  const safe = Math.min(page, count);
  const slice = items.slice((safe - 1) * pageSize, safe * pageSize);
  return { page: safe, count, slice, setPage, total: items.length };
}

export function Timeline({ items }: { items: { id: string; title: string; meta: string; body?: string }[] }) {
  if (items.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <ol className="timeline">
      {items.map((item) => (
        <li key={item.id}>
          <div className="tl-title">{item.title}</div>
          <div className="tl-meta">{item.meta}</div>
          {item.body && <p>{item.body}</p>}
        </li>
      ))}
    </ol>
  );
}

export function Modal({ open, title, onClose, className, children }: { open: boolean; title: string; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    // Focus the dialog only when it opens. Re-running on every onClose identity
    // change (inline lambdas) steals focus from inputs after the first keystroke.
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>("button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((item) => !item.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className={cx("modal", className)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onMouseDown={(event) => event.stopPropagation()}>
        <div className="spread">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close dialog">Close</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function DecisionDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  requireComment = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "primary" | "danger";
  requireComment?: boolean;
  onConfirm: (comment: string) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setComment("");
      setError("");
    }
  }, [open]);
  useEffect(() => {
    setError("");
  }, [requireComment]);
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p>{body}</p>
      {children}
      <Field label={requireComment ? "Comment" : "Comment (optional)"} error={error}>
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} />
      </Field>
      <div className="actions">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          onClick={() => {
            if (requireComment && comment.trim().length < 3) {
              setError("Add a short note so the person understands the decision.");
              return;
            }
            onConfirm(comment.trim());
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} role="status">
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss notification">×</button>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function PersonLink({ name, color, to, meta, photoSrc }: { name: string; color: string; to: string; meta?: string; photoSrc?: string }) {
  return (
    <Link className="person" to={to}>
      <Avatar name={name} color={color} photoSrc={photoSrc} />
      <span>
        {name}
        {meta && <span className="muted" style={{ display: "block", fontWeight: 500 }}>{meta}</span>}
      </span>
    </Link>
  );
}

export function NoAccess({ body }: { body: string }) {
  return <EmptyState title="You don't have access to this" body={body} action={<Link className="btn btn-secondary" to="/">Back to overview</Link>} />;
}
