import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronUp, FileDown, FileUp, Plus, Search, X } from "lucide-react";
import {
  audienceLabel,
  canRenderInApp,
  draftVersion,
  employeeCanViewPolicy,
  employeeFacingSummary,
  extractTocFromHtml,
  isUpcomingEffective,
  latestVersion,
  nextPolicyVersion,
  POLICY_CATEGORIES,
  policySearchText,
  publishChecklist,
  publishedVersion,
  versionLabel,
  withHeadingIds,
} from "../domain/policies";
import {
  Banner,
  Button,
  DatePicker,
  DecisionDialog,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  StatusBadge,
  Tabs,
} from "../components/ui";
import { todayIso } from "../domain/dates";
import { formatDate, formatDateTime, fullName } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Policy, PolicyAudience, PolicyStatus } from "../types";

type AdminTab = "published" | "drafts" | "archived" | "needs_review";
type EmployeeView = "all" | "ack";

export function Policies() {
  const { user, can } = useApp();
  const manage = can("policies.manage");
  if (!user) return null;
  if (!can("policies.view") && !manage) {
    return <EmptyState title="Policies are unavailable" body="Your role does not include HR policies." />;
  }
  return manage ? <AdminPolicyLibrary /> : <EmployeePolicyLibrary />;
}

function EmployeePolicyLibrary() {
  const { state, user } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [view, setView] = useState<EmployeeView>("all");
  if (!user) return null;

  const today = todayIso();
  const published = state.policies.filter((item) => employeeCanViewPolicy(item, user, false));
  const categories = [...new Set(published.map((item) => item.category))].sort();

  const rows = published.filter((item) => {
    const ver = publishedVersion(item);
    if (!ver) return false;
    if (category !== "all" && item.category !== category) return false;
    if (audienceFilter === "company" && item.audience.kind !== "all") return false;
    if (audienceFilter !== "all" && audienceFilter !== "company" && item.audience.kind !== audienceFilter) return false;
    if (view === "ack") {
      if (!item.requiresAcknowledgement) return false;
      const done = state.acknowledgements.some((ack) => ack.policyId === item.id && ack.employeeId === user.id && ack.version === ver.version);
      if (done) return false;
    }
    const q = query.trim().toLowerCase();
    if (q && !policySearchText(item).includes(q)) return false;
    return true;
  });

  const chips: { id: string; label: string; clear: () => void }[] = [];
  if (query.trim()) chips.push({ id: "q", label: `Search: ${query.trim()}`, clear: () => setQuery("") });
  if (category !== "all") chips.push({ id: "cat", label: category, clear: () => setCategory("all") });
  if (audienceFilter !== "all") chips.push({ id: "aud", label: audienceFilter === "company" ? "Company-wide" : audienceFilter, clear: () => setAudienceFilter("all") });
  if (view === "ack") chips.push({ id: "view", label: "Needs acknowledgment", clear: () => setView("all") });

  const recent = published.length >= 2
    ? [...published].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3)
    : [];

  const locationName = (id: string) => state.locations.find((item) => item.id === id)?.name ?? "Location";
  const departmentName = (id: string) => state.departments.find((item) => item.id === id)?.name ?? "Department";

  return (
    <div className="policies-module policies-employee">
      <PageHeader
        title="HR Policies"
        subtitle="Read the current company policies that apply to you. Opening a policy does not count as acknowledgement."
      />

      <section className="panel policy-library-toolbar">
        <div className="policy-view-switch" role="tablist" aria-label="Policy views">
          <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All policies</button>
          <button type="button" role="tab" aria-selected={view === "ack"} className={view === "ack" ? "active" : ""} onClick={() => setView("ack")}>Needs acknowledgment</button>
        </div>
        <div className="form-grid policy-filter-grid">
          <Field label="Search">
            <span className="policy-search">
              <Search size={16} aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, category, or policy text" />
            </span>
          </Field>
          <Field label="Category">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Audience">
            <select value={audienceFilter} onChange={(event) => setAudienceFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="company">Company-wide</option>
              <option value="location">Location-scoped</option>
              <option value="department">Department-scoped</option>
            </select>
          </Field>
        </div>
        {chips.length > 0 && (
          <div className="policy-chips" aria-label="Active filters">
            {chips.map((chip) => (
              <button key={chip.id} type="button" className="policy-chip" onClick={chip.clear}>
                {chip.label} <X size={14} aria-hidden />
              </button>
            ))}
          </div>
        )}
        <p className="policy-result-count" aria-live="polite">{rows.length} polic{rows.length === 1 ? "y" : "ies"}</p>
      </section>

      {recent.length > 0 && view === "all" && !query && category === "all" && (
        <section className="panel policy-featured">
          <h2>Recently updated</h2>
          <ul className="policy-featured-list">
            {recent.map((item) => {
              const ver = publishedVersion(item)!;
              return (
                <li key={item.id}>
                  <Link to={`/policies/${item.id}`}>{item.title}</Link>
                  <span className="muted">{item.category}{ver.effectiveDate ? ` · Effective ${formatDate(ver.effectiveDate)}` : ""}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={published.length === 0 ? "No published policies yet" : "No matching policies"}
          body={published.length === 0
            ? "When HR publishes a policy that applies to you, it will appear here for in-app reading."
            : "Try clearing filters or searching a different title or category."}
        />
      ) : (
        <section className="panel policy-list" aria-label="Policy library">
          {rows.map((item) => {
            const ver = publishedVersion(item)!;
            const summary = employeeFacingSummary(ver.summary);
            const upcoming = isUpcomingEffective(ver.effectiveDate, today);
            const needsAck = Boolean(item.requiresAcknowledgement)
              && !state.acknowledgements.some((ack) => ack.policyId === item.id && ack.employeeId === user.id && ack.version === ver.version);
            return (
              <article key={item.id} className="policy-row">
                <div className="policy-row-main">
                  <div className="policy-row-tags">
                    <span className="policy-cat">{item.category}</span>
                    {upcoming && <span className="policy-upcoming">Upcoming</span>}
                    {needsAck && <span className="policy-ack-needed">Acknowledgment required</span>}
                  </div>
                  <h2><Link to={`/policies/${item.id}`}>{item.title}</Link></h2>
                  {summary && <p className="policy-row-summary">{summary}</p>}
                  {ver.effectiveDate && (
                    <p className="policy-row-meta muted">
                      {upcoming ? "Effective from" : "Effective"} {formatDate(ver.effectiveDate)}
                      {item.audience.kind !== "all" ? ` · ${audienceLabel(item, locationName, departmentName)}` : ""}
                    </p>
                  )}
                </div>
                <div className="policy-row-actions">
                  <Link className="btn btn-primary" to={`/policies/${item.id}`}>Read policy</Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function AdminPolicyLibrary() {
  const { state, user, actions } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importReport, setImportReport] = useState<Array<{ fileName: string; ok: boolean; message: string; skippedDuplicate?: boolean }> | null>(null);
  const [error, setError] = useState("");
  const tabs: { id: AdminTab; label: string; count?: number }[] = [
    { id: "published", label: "Published", count: state.policies.filter((item) => item.status === "published").length },
    { id: "needs_review", label: "Needs review", count: state.policies.filter((item) => item.status === "needs_review").length },
    { id: "drafts", label: "Drafts", count: state.policies.filter((item) => item.status === "draft").length },
    { id: "archived", label: "Archived", count: state.policies.filter((item) => item.status === "archived" || item.status === "superseded").length },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "needs_review");
  if (!user) return null;

  const rows = state.policies.filter((item) => {
    if (tab === "published" && item.status !== "published") return false;
    if (tab === "drafts" && item.status !== "draft") return false;
    if (tab === "needs_review" && item.status !== "needs_review") return false;
    if (tab === "archived" && item.status !== "archived" && item.status !== "superseded") return false;
    if (category !== "all" && item.category !== category) return false;
    if (query.trim() && !policySearchText(item).includes(query.trim().toLowerCase())) return false;
    return true;
  });

  return (
    <div className="policies-module">
      <PageHeader
        title="HR Policies"
        subtitle="Review imports, edit drafts, and publish only when title, version, effective date, audience, and content are confirmed."
        actions={
          <div className="actions">
            <Button variant="secondary" disabled={refreshing} onClick={async () => {
              setRefreshing(true);
              await actions.backfillPolicyExtractions();
              setRefreshing(false);
            }}>
              {refreshing ? "Refreshing…" : "Refresh document text"}
            </Button>
            <Button variant="secondary" disabled={importing} onClick={async () => {
              setImporting(true);
              setError("");
              const result = await actions.importHrPoliciesFolder();
              setImportReport(result.report ?? null);
              if (!result.ok) setError(result.message);
              setImporting(false);
            }}>
              <FileUp size={16} aria-hidden /> {importing ? "Importing…" : "Import folder"}
            </Button>
            <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> Add policy</Button>
          </div>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {importReport && (
        <section className="panel">
          <h2>Import report</h2>
          <p className="muted">Import status is separate from publication. Nothing was published automatically.</p>
          <ul className="policy-import-report">
            {importReport.map((item) => (
              <li key={item.fileName}>
                <StatusBadge value={item.ok ? (item.skippedDuplicate ? "archived" : "published") : "failed"} />
                <span><strong>{item.fileName}</strong> — {item.message}</span>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" onClick={() => setImportReport(null)}>Dismiss</Button>
        </section>
      )}
      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as AdminTab)} />
      <section className="panel filters-bar">
        <div className="form-grid">
          <Field label="Search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, category, keywords" /></Field>
          <Field label="Category">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {[...new Set([...POLICY_CATEGORIES, ...state.policies.map((item) => item.category)])].sort().map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
        </div>
        <p className="policy-result-count">{rows.length} result{rows.length === 1 ? "" : "s"}</p>
      </section>
      {creating && <PolicyEditor onDone={() => setCreating(false)} onCancel={() => setCreating(false)} />}
      {rows.length === 0 ? (
        <EmptyState title="No policies in this view" body="Import the HR Policies folder or create a draft, then complete the review checklist before publishing." action={<Button onClick={() => setCreating(true)}>Add policy</Button>} />
      ) : (
        <section className="panel policy-list">
          {rows.map((item) => {
            const ver = publishedVersion(item) ?? latestVersion(item);
            return (
              <article key={item.id} className="policy-row admin">
                <div className="policy-row-main">
                  <div className="policy-row-tags">
                    <StatusBadge value={item.status} />
                    <span className="policy-cat">{item.category}</span>
                    {ver?.renderStatus && <span className="muted">Render: {ver.renderStatus}</span>}
                  </div>
                  <h2><Link to={`/policies/${item.id}`}>{item.title}</Link></h2>
                  <p className="policy-row-meta muted">
                    v{versionLabel(ver?.version || "Unspecified")}
                    {ver?.effectiveDate ? ` · Effective ${formatDate(ver.effectiveDate)}` : " · Effective date not set"}
                    {" · "}Updated {formatDate(item.updatedAt)}
                  </p>
                </div>
                <div className="policy-row-actions">
                  <Link className="btn btn-secondary" to={`/policies/${item.id}`}>Open</Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

export function PolicyDetail() {
  const { id } = useParams();
  const { state, user, can } = useApp();
  const manage = can("policies.manage");
  const policy = state.policies.find((item) => item.id === id);
  if (!user) return null;
  if (!policy) return <EmptyState title="Policy not found" body="That policy is not in this workspace." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  if (!employeeCanViewPolicy(policy, user, manage)) {
    return <EmptyState title="This policy is not available to you" body="Only published policies that apply to you are shown." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  }
  return manage ? <AdminPolicyDetail policy={policy} /> : <EmployeePolicyReader policy={policy} />;
}

function EmployeePolicyReader({ policy }: { policy: Policy }) {
  const { state, user, actions } = useApp();
  const [ackOpen, setAckOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  if (!user) return null;

  const version = publishedVersion(policy);
  if (!version || policy.status !== "published") {
    return <EmptyState title="Policy unavailable" body="This policy is not published." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  }

  const today = todayIso();
  const upcoming = isUpcomingEffective(version.effectiveDate, today);
  const summary = employeeFacingSummary(version.summary);
  const readable = canRenderInApp(version);
  const html = version.contentHtml ? withHeadingIds(version.contentHtml) : "";
  const toc = html ? extractTocFromHtml(html) : [];
  const locationName = (locationId: string) => state.locations.find((item) => item.id === locationId)?.name ?? "Location";
  const departmentName = (departmentId: string) => state.departments.find((item) => item.id === departmentId)?.name ?? "Department";
  const requiresAck = Boolean(policy.requiresAcknowledgement);
  const acknowledged = state.acknowledgements.some((item) => item.policyId === policy.id && item.employeeId === user.id && item.version === version.version);

  return (
    <div className="policies-module policy-reader-page">
      <PageHeader
        title={policy.title}
        subtitle={undefined}
        crumbs={[{ label: "HR Policies", to: "/policies" }, { label: policy.title }]}
        actions={
          <div className="actions">
            {version.fileKey && (
              <Button variant="secondary" onClick={() => actions.downloadPolicyFile(policy.id, version.id)}>
                <FileDown size={16} aria-hidden /> Download original
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>Print</Button>
          </div>
        }
      />

      <header className="policy-reader-header panel">
        <div className="policy-row-tags">
          <span className="policy-cat">{policy.category}</span>
          {upcoming && <span className="policy-upcoming">Upcoming</span>}
          {requiresAck && !acknowledged && <span className="policy-ack-needed">Acknowledgment required</span>}
          {acknowledged && <span className="policy-ack-done">Acknowledged</span>}
        </div>
        {summary && <p className="policy-reader-summary">{summary}</p>}
        <p className="policy-reader-kicker muted">
          {version.effectiveDate
            ? `${upcoming ? "Effective from" : "Effective"} ${formatDate(version.effectiveDate)}`
            : null}
          {version.effectiveDate ? " · " : ""}
          Applies to {audienceLabel(policy, locationName, departmentName)}
        </p>
        <button type="button" className="policy-details-toggle" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}>
          Policy details {detailsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {detailsOpen && (
          <dl className="dl policy-details-dl">
            <dt>Version</dt><dd>{versionLabel(version.version)}</dd>
            <dt>Published</dt><dd>{version.publishedAt ? formatDateTime(version.publishedAt) : "Not set"}</dd>
            {version.fileName && <><dt>Source file</dt><dd>{version.fileName}</dd></>}
          </dl>
        )}
      </header>

      {error && <Banner tone="error">{error}</Banner>}

      {upcoming && (
        <Banner tone="info">This policy is published but its effective date is in the future. It is labeled Upcoming until that date.</Banner>
      )}

      <div className={`policy-reader-layout ${toc.length > 2 ? "has-toc" : ""}`}>
        {toc.length > 2 && (
          <nav className="policy-toc panel" aria-label="On this page">
            <h2>On this page</h2>
            <ol>
              {toc.map((item) => (
                <li key={item.id} className={`level-${item.level}`}>
                  <a href={`#${item.id}`}>{item.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <article className="panel policy-document">
          {readable ? (
            html ? (
              <div className="policy-html" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="policy-body">{version.content}</div>
            )
          ) : (
            <div className="policy-unavailable">
              <Banner tone="warning">
                This policy could not be rendered in-app from the source document. Use Download original if you are authorized, or ask HR to refresh document text.
              </Banner>
              {version.fileKey && (
                <Button onClick={() => actions.downloadPolicyFile(policy.id, version.id)}>Download original document</Button>
              )}
            </div>
          )}
        </article>
      </div>

      {requiresAck && (
        <section className="panel policy-ack-panel">
          <h2>Acknowledgment</h2>
          {acknowledged ? (
            <Banner tone="success">You acknowledged version {versionLabel(version.version)}. Opening or downloading alone does not create this record.</Banner>
          ) : (
            <>
              <p>Confirm that you have read and understood this policy. This records your employee ID, the policy version, and the time.</p>
              <label className="check">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                <span>I have read and understood “{policy.title}” version {versionLabel(version.version)}.</span>
              </label>
              <Button disabled={!confirmed} onClick={() => setAckOpen(true)}>Acknowledge this version</Button>
            </>
          )}
        </section>
      )}

      <div className="actions">
        <Link className="btn btn-secondary" to="/policies">Back to policies</Link>
      </div>

      <DecisionDialog
        open={ackOpen}
        title="Acknowledge policy"
        body={`I confirm I have read and understood ${policy.title} version ${versionLabel(version.version)}.`}
        confirmLabel="I acknowledge"
        onClose={() => setAckOpen(false)}
        onConfirm={async () => {
          const result = await actions.acknowledgePolicy(policy.id);
          if (!result.ok) setError(result.message);
          setAckOpen(false);
        }}
      />
    </div>
  );
}

function AdminPolicyDetail({ policy }: { policy: Policy }) {
  const { state, actions } = useApp();
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publishOpen, setPublish] = useState(false);
  const [archiveOpen, setArchive] = useState(false);
  const [restoreOpen, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const current = publishedVersion(policy);
  const pending = draftVersion(policy);
  const showing = pending && policy.status !== "published" ? pending : current ?? pending ?? policy.versions[0];
  const checklist = publishChecklist(policy);
  const locationName = (locationId: string) => state.locations.find((item) => item.id === locationId)?.name ?? "Location";
  const departmentName = (departmentId: string) => state.departments.find((item) => item.id === departmentId)?.name ?? "Department";
  const requiresAck = Boolean(policy.requiresAcknowledgement);

  return (
    <div className="policies-module">
      <PageHeader
        title={policy.title}
        subtitle={`${policy.category} · ${audienceLabel(policy, locationName, departmentName)}`}
        crumbs={[{ label: "HR Policies", to: "/policies" }, { label: policy.title }]}
        actions={<StatusBadge value={policy.status} />}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {policy.status === "archived" && <Banner tone="warning">Archived — not shown to employees as current policy.</Banner>}
      {policy.status === "needs_review" && <Banner tone="info">Needs review — not visible to employees until published.</Banner>}
      {policy.status === "draft" && <Banner tone="info">Draft — not visible to employees until published.</Banner>}
      {policy.status === "published" && pending && <Banner tone="info">A draft version exists. Employees still see the published version until you publish the draft.</Banner>}

      {(policy.status === "needs_review" || policy.status === "draft") && (
        <section className="panel">
          <h2>Review checklist</h2>
          <ul className="policy-checklist">
            {checklist.map((item) => (
              <li key={item.id} className={item.ok ? "ok" : "todo"}>
                <span aria-hidden>{item.ok ? "✓" : "○"}</span>
                <span>{item.label}{item.ok ? "" : " — still needed"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing ? (
        <PolicyEditor policy={policy} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : showing && (
        <section className="panel">
          <h2>Version {versionLabel(showing.version)}</h2>
          <dl className="dl">
            <dt>Effective date</dt><dd>{showing.effectiveDate ? formatDate(showing.effectiveDate) : "Not set"}</dd>
            <dt>Summary</dt><dd>{showing.summary?.trim() || "Not set"}</dd>
            <dt>Render status</dt><dd>{showing.renderStatus || "Not set"}</dd>
            <dt>Source file</dt><dd>{showing.fileName || "Not set"}</dd>
            <dt>Published at</dt><dd>{showing.publishedAt ? formatDateTime(showing.publishedAt) : "Not published"}</dd>
          </dl>
          {canRenderInApp(showing) ? (
            showing.contentHtml
              ? <div className="policy-html" dangerouslySetInnerHTML={{ __html: withHeadingIds(showing.contentHtml) }} />
              : <div className="policy-body">{showing.content}</div>
          ) : (
            <Banner tone="warning">In-app text is not available for this version. Attach a DOCX/TXT or use Refresh document text after fixing the source.</Banner>
          )}
          <div className="actions">
            {(showing.fileKey || showing.fileName) && (
              <Button variant="secondary" onClick={() => actions.downloadPolicyFile(policy.id, showing.id)}>Download source</Button>
            )}
            <label className="btn btn-secondary">
              {uploading ? "Uploading…" : "Replace / attach file"}
              <input
                type="file"
                hidden
                accept=".pdf,.docx,.doc,.txt"
                disabled={uploading}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  if (!window.confirm(`Attach “${file.name}” to the draft version?`)) return;
                  setUploading(true);
                  const result = await actions.uploadPolicyFile(policy.id, file);
                  setUploading(false);
                  if (!result.ok) setError(result.message);
                }}
              />
            </label>
            <Button variant="secondary" onClick={() => setPreview(true)}>Preview employee view</Button>
            <Button onClick={() => setEditing(true)}>{policy.status === "published" ? "New version / edit draft" : "Edit draft"}</Button>
            {policy.status === "draft" && (
              <Button variant="secondary" disabled={busy} onClick={async () => {
                setBusy(true);
                const result = await actions.submitPolicyForReview(policy.id);
                setBusy(false);
                if (!result.ok) setError(result.message);
              }}>Mark needs review</Button>
            )}
            {(policy.status === "draft" || policy.status === "needs_review" || pending) && (
              <Button onClick={() => setPublish(true)}>Publish…</Button>
            )}
            {policy.status !== "archived" && policy.status !== "superseded" && (
              <Button variant="danger" onClick={() => setArchive(true)}>Archive…</Button>
            )}
            {(policy.status === "archived" || policy.status === "superseded") && (
              <Button onClick={() => setRestore(true)}>Restore to draft…</Button>
            )}
            <Button variant="secondary" onClick={async () => {
              const result = await actions.setPolicyAcknowledgementRequired(policy.id, !requiresAck);
              if (!result.ok) setError(result.message);
            }}>
              {requiresAck ? "Turn off acknowledgement" : "Require acknowledgement"}
            </Button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Version history</h2>
        {policy.versions.map((item) => {
          const isCurrent = current?.id === item.id && policy.status === "published";
          const status: PolicyStatus = isCurrent ? "published" : item.publishedAt ? "superseded" : "draft";
          return (
            <div key={item.id} className="notice split">
              <div>
                <strong>Version {versionLabel(item.version)}</strong>
                <div className="muted">
                  Effective {item.effectiveDate ? formatDate(item.effectiveDate) : "not set"}
                  {" · "}
                  {item.publishedAt ? `published ${formatDateTime(item.publishedAt)}` : "draft"}
                  {item.fileName ? ` · ${item.fileName}` : ""}
                </div>
              </div>
              <div className="actions">
                <StatusBadge value={status} />
                {item.fileKey && <Button size="sm" variant="ghost" onClick={() => actions.downloadPolicyFile(policy.id, item.id)}>Download</Button>}
              </div>
            </div>
          );
        })}
      </section>

      <Modal open={preview} title="Employee preview" onClose={() => setPreview(false)} className="modal-wide">
        <p className="muted">This is how applicable employees will see the content after publish. Status and review banners are admin-only.</p>
        <h3>{policy.title}</h3>
        {(pending ?? showing) && canRenderInApp(pending ?? showing) ? (
          (pending ?? showing)!.contentHtml
            ? <div className="policy-html" dangerouslySetInnerHTML={{ __html: withHeadingIds((pending ?? showing)!.contentHtml!) }} />
            : <div className="policy-body">{(pending ?? showing)!.content}</div>
        ) : (
          <Banner tone="warning">In-app content is not ready for this version.</Banner>
        )}
        <Button variant="secondary" onClick={() => setPreview(false)}>Close</Button>
      </Modal>
      <DecisionDialog open={publishOpen} title="Publish policy" body="Employees who match the audience will be able to read this version in-app. Publishing does not mark it acknowledged." confirmLabel="Publish" onClose={() => setPublish(false)} onConfirm={async () => {
        const result = await actions.publishPolicy(policy.id);
        if (!result.ok) setError(result.message);
        setPublish(false);
      }} />
      <DecisionDialog open={archiveOpen} title="Archive policy" body="Archived policies stay in history and are no longer current for employees." confirmLabel="Archive" tone="danger" onClose={() => setArchive(false)} onConfirm={async () => {
        const result = await actions.archivePolicy(policy.id);
        if (!result.ok) setError(result.message);
        setArchive(false);
      }} />
      <DecisionDialog open={restoreOpen} title="Restore policy" body="Restore as draft for HR review before publishing again." confirmLabel="Restore to draft" onClose={() => setRestore(false)} onConfirm={async () => {
        const result = await actions.restorePolicy(policy.id);
        if (!result.ok) setError(result.message);
        setRestore(false);
      }} />
    </div>
  );
}

function PolicyEditor({ policy, onDone, onCancel }: { policy?: Policy; onDone: () => void; onCancel: () => void }) {
  const { state, actions } = useApp();
  const pending = policy ? draftVersion(policy) : undefined;
  const source = pending ?? (policy ? latestVersion(policy) : undefined);
  const creatingNewVersion = Boolean(policy?.status === "published" && !pending);
  const [title, setTitle] = useState(policy?.title ?? "");
  const [category, setCategory] = useState(policy?.category ?? "Workplace");
  const [summary, setSummary] = useState(employeeFacingSummary(source?.summary) || source?.summary || "");
  const [content, setContent] = useState(source?.content ?? "");
  const [version, setVersion] = useState(policy ? (creatingNewVersion ? nextPolicyVersion(policy) : pending?.version ?? source?.version ?? "1.0") : "1.0");
  const [effectiveDate, setEffective] = useState(creatingNewVersion ? "" : source?.effectiveDate ?? "");
  const [reviewDate, setReview] = useState(source?.reviewDate ?? "");
  const [fileName, setFileName] = useState(source?.fileName ?? "");
  const fileMeta = {
    fileKey: source?.fileKey,
    fileSize: source?.fileSize,
    contentType: source?.contentType,
    checksum: source?.checksum,
  };
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [audienceKind, setKind] = useState<PolicyAudience["kind"]>(policy?.audience.kind ?? "all");
  const [locationId, setLocation] = useState(policy?.audience.kind === "location" ? policy.audience.locationId : state.locations[0]?.id ?? "");
  const [departmentId, setDepartment] = useState(policy?.audience.kind === "department" ? policy.audience.departmentId : state.departments[0]?.id ?? "");
  const [employmentType, setEmploymentType] = useState<"full_time" | "contract">(policy?.audience.kind === "employment_type" ? policy.audience.employmentType : "full_time");
  const [requiresAck, setRequiresAck] = useState(Boolean(policy?.requiresAcknowledgement));
  const [keywords, setKeywords] = useState((policy?.keywords ?? []).join(", "));
  const [ownerId, setOwnerId] = useState(policy?.ownerId ?? "");
  const [markReview, setMarkReview] = useState(policy?.status === "needs_review");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const audience: PolicyAudience = audienceKind === "location"
    ? { kind: "location", locationId }
    : audienceKind === "department"
      ? { kind: "department", departmentId }
      : audienceKind === "employment_type"
        ? { kind: "employment_type", employmentType }
        : { kind: "all" };

  return (
    <form
      className="panel"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        const result = await actions.savePolicy({
          id: policy?.id,
          title,
          category,
          summary,
          content,
          version,
          effectiveDate,
          reviewDate: reviewDate || undefined,
          fileName: pendingFile?.name || fileName,
          fileKey: fileMeta.fileKey,
          fileSize: fileMeta.fileSize,
          contentType: fileMeta.contentType,
          checksum: fileMeta.checksum,
          audience,
          ownerId: ownerId || null,
          requiresAcknowledgement: requiresAck,
          keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean),
          status: markReview ? "needs_review" : "draft",
          newVersion: creatingNewVersion,
        });
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
        const policyId = result.id || policy?.id;
        if (pendingFile && policyId) {
          const upload = await actions.uploadPolicyFile(policyId, pendingFile);
          if (!upload.ok) {
            setError(upload.message);
            setSaving(false);
            return;
          }
        }
        setSaving(false);
        onDone();
      }}
    >
      <h2>{policy ? (creatingNewVersion ? "New version" : "Edit draft") : "New policy"}</h2>
      <p className="muted">Leave summary blank rather than inventing one. Effective date is required before publish.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {POLICY_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Version"><input value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
        <Field label="Effective date"><DatePicker value={effectiveDate} onChange={setEffective} /></Field>
        <Field label="Review date (optional)"><DatePicker value={reviewDate} onChange={setReview} /></Field>
        <Field label="Applies to">
          <select value={audienceKind} onChange={(event) => setKind(event.target.value as PolicyAudience["kind"])}>
            <option value="all">All employees</option>
            <option value="location">One location</option>
            <option value="department">One department</option>
            <option value="employment_type">Employment type</option>
          </select>
        </Field>
        {audienceKind === "location" && (
          <Field label="Location">
            <select value={locationId} onChange={(event) => setLocation(event.target.value)}>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        )}
        {audienceKind === "department" && (
          <Field label="Department">
            <select value={departmentId} onChange={(event) => setDepartment(event.target.value)}>
              {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
        )}
        {audienceKind === "employment_type" && (
          <Field label="Employment type">
            <select value={employmentType} onChange={(event) => setEmploymentType(event.target.value as "full_time" | "contract")}>
              <option value="full_time">Full-time</option>
              <option value="contract">Contract</option>
            </select>
          </Field>
        )}
        <Field label="Policy owner">
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Unassigned</option>
            {state.employees.filter((item) => item.role === "hr" || item.role === "admin").map((item) => (
              <option key={item.id} value={item.id}>{fullName(item)}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Keywords"><input value={keywords} onChange={(event) => setKeywords(event.target.value)} /></Field>
      <Field label="Short summary (optional)"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
      <Field label="Policy text (optional if DOCX attached)"><textarea value={content} onChange={(event) => setContent(event.target.value)} rows={12} /></Field>
      <Field label="Source document">
        <input type="file" accept=".pdf,.docx,.doc,.txt" onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setPendingFile(file);
          if (file) setFileName(file.name);
        }} />
        {(fileName || pendingFile) && <p className="muted">Selected: {pendingFile?.name || fileName}</p>}
      </Field>
      <label className="check"><input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} /><span>Require explicit acknowledgement after publish</span></label>
      <label className="check"><input type="checkbox" checked={markReview} onChange={(event) => setMarkReview(event.target.checked)} /><span>Mark as Needs review</span></label>
      <div className="actions">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save draft"}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
