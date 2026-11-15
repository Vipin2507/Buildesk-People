import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { BookOpen, FileUp, Plus, Search } from "lucide-react";
import {
  audienceLabel,
  draftVersion,
  employeeCanViewPolicy,
  latestVersion,
  nextPolicyVersion,
  POLICY_CATEGORIES,
  policySearchText,
  publishChecklist,
  publishedVersion,
  versionLabel,
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
import { formatDate, formatDateTime, fullName } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Policy, PolicyAudience, PolicyStatus } from "../types";

type LibraryTab = "published" | "drafts" | "archived" | "needs_review";

export function Policies() {
  const { state, user, can, actions } = useApp();
  const manage = can("policies.manage");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<Array<{ fileName: string; ok: boolean; message: string; skippedDuplicate?: boolean }> | null>(null);
  const [error, setError] = useState("");

  const tabs: { id: LibraryTab; label: string; count?: number }[] = manage
    ? [
        { id: "published", label: "Published", count: state.policies.filter((item) => item.status === "published").length },
        { id: "needs_review", label: "Needs review", count: state.policies.filter((item) => item.status === "needs_review").length },
        { id: "drafts", label: "Drafts", count: state.policies.filter((item) => item.status === "draft").length },
        { id: "archived", label: "Archived", count: state.policies.filter((item) => item.status === "archived" || item.status === "superseded").length },
      ]
    : [{ id: "published", label: "Published" }];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "published");

  if (!user) return null;
  if (!can("policies.view") && !manage) {
    return <EmptyState title="Policies are unavailable" body="Your role does not include HR policies." />;
  }

  const categories = [...new Set([...POLICY_CATEGORIES, ...state.policies.map((item) => item.category)])].sort();
  const q = query.trim().toLowerCase();
  const rows = state.policies.filter((item) => {
    if (!employeeCanViewPolicy(item, user, manage)) return false;
    if (manage) {
      if (tab === "published" && item.status !== "published") return false;
      if (tab === "drafts" && item.status !== "draft") return false;
      if (tab === "needs_review" && item.status !== "needs_review") return false;
      if (tab === "archived" && item.status !== "archived" && item.status !== "superseded") return false;
    } else if (item.status !== "published") return false;
    if (category !== "all" && item.category !== category) return false;
    if (audienceFilter === "company" && item.audience.kind !== "all") return false;
    if (audienceFilter !== "all" && audienceFilter !== "company" && item.audience.kind !== audienceFilter) return false;
    const ver = publishedVersion(item) ?? latestVersion(item);
    if (effectiveFrom && (!ver?.effectiveDate || ver.effectiveDate < effectiveFrom)) return false;
    if (q && !policySearchText(item).includes(q)) return false;
    return true;
  });

  const locationName = (id: string) => state.locations.find((item) => item.id === id)?.name ?? "Location";
  const departmentName = (id: string) => state.departments.find((item) => item.id === id)?.name ?? "Department";

  return (
    <div className="policies-module">
      <PageHeader
        title="HR Policies"
        subtitle={manage
          ? "Draft, review, and publish company policies. Employees only see published policies that apply to them."
          : "Current published policies that apply to you. Opening a policy does not count as acknowledgement."}
        actions={manage ? (
          <div className="actions">
            <Button
              variant="secondary"
              disabled={importing}
              onClick={async () => {
                setImporting(true);
                setError("");
                const result = await actions.importHrPoliciesFolder();
                setImportReport(result.report ?? null);
                if (!result.ok) setError(result.message);
                setImporting(false);
              }}
            >
              <FileUp size={16} aria-hidden /> {importing ? "Importing…" : "Import HR Policies folder"}
            </Button>
            <Button onClick={() => setCreating(true)}><Plus size={16} aria-hidden /> Add policy</Button>
          </div>
        ) : undefined}
      />

      {error && <Banner tone="error">{error}</Banner>}
      {importReport && (
        <section className="panel">
          <h2>Import report</h2>
          <p className="muted">Source files stay as stored originals. Nothing was published automatically.</p>
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

      {manage && <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as LibraryTab)} />}

      <section className="panel filters-bar">
        <div className="form-grid">
          <Field label="Search">
            <span className="policy-search">
              <Search size={16} aria-hidden />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, category, version, keywords" />
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
              <option value="all">All audiences</option>
              <option value="company">Company-wide only</option>
              <option value="location">Location-scoped</option>
              <option value="department">Department-scoped</option>
              <option value="employment_type">Employment type</option>
            </select>
          </Field>
          <Field label="Effective from">
            <DatePicker value={effectiveFrom} onChange={setEffectiveFrom} placeholder="Any date" />
          </Field>
        </div>
      </section>

      {creating && manage && (
        <PolicyEditor
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={q || category !== "all" ? "No matching policies" : "No policies yet"}
          body={manage
            ? "Import the HR Policies folder or create a draft, then review title, category, version, effective date, and audience before publishing."
            : "When HR publishes a policy that applies to you, it will appear here."}
          action={manage ? <Button onClick={() => setCreating(true)}>Add policy</Button> : undefined}
        />
      ) : (
        <div className="policy-card-grid">
          {rows.map((item) => {
            const current = publishedVersion(item) ?? latestVersion(item);
            return (
              <Link key={item.id} className="policy-card" to={`/policies/${item.id}`}>
                <div className="policy-card-top">
                  <span className="policy-card-icon" aria-hidden><BookOpen size={18} /></span>
                  <StatusBadge value={item.status} />
                </div>
                <h2>{item.title}</h2>
                <p className="muted">{item.category} · v{versionLabel(current?.version || "Unspecified")}</p>
                <p className="policy-card-summary">{current?.summary || "No summary yet."}</p>
                <dl className="policy-card-meta">
                  <div><dt>Effective</dt><dd>{current?.effectiveDate ? formatDate(current.effectiveDate) : "Unset"}</dd></div>
                  <div><dt>Updated</dt><dd>{formatDate(item.updatedAt)}</dd></div>
                  <div><dt>Audience</dt><dd>{audienceLabel(item, locationName, departmentName)}</dd></div>
                </dl>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PolicyDetail() {
  const { id } = useParams();
  const { state, user, can, actions } = useApp();
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [publishOpen, setPublish] = useState(false);
  const [archiveOpen, setArchive] = useState(false);
  const [restoreOpen, setRestore] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);

  const policy = state.policies.find((item) => item.id === id);
  if (!user) return null;
  if (!policy) {
    return <EmptyState title="Policy not found" body="That policy is not in this workspace." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  }
  const manage = can("policies.manage");
  if (!employeeCanViewPolicy(policy, user, manage)) {
    return <EmptyState title="This policy is not available to you" body="Only published policies that apply to your role, location, or department are shown." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  }

  const current = publishedVersion(policy);
  const pending = draftVersion(policy);
  const showing = manage && pending && (policy.status !== "published" || preview) ? pending : current ?? pending ?? policy.versions[0];
  const requiresAck = Boolean(policy.requiresAcknowledgement);
  const acknowledged = current
    ? state.acknowledgements.some((item) => item.policyId === policy.id && item.employeeId === user.id && item.version === current.version)
    : false;
  const locationName = (locationId: string) => state.locations.find((item) => item.id === locationId)?.name ?? "Location";
  const departmentName = (departmentId: string) => state.departments.find((item) => item.id === departmentId)?.name ?? "Department";
  const checklist = publishChecklist(policy);
  const related = state.policies.filter((item) => item.id !== policy.id && item.status === "published" && item.category === policy.category).slice(0, 4);

  return (
    <div className="policies-module policy-reader">
      <PageHeader
        title={policy.title}
        subtitle={`${policy.category} · ${audienceLabel(policy, locationName, departmentName)}${policy.sensitive ? " · Restricted audience" : ""}`}
        crumbs={[{ label: "HR Policies", to: "/policies" }, { label: policy.title }]}
        actions={<StatusBadge value={policy.status} />}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {policy.status === "archived" && <Banner tone="warning">This policy is archived. It is no longer the current instruction.</Banner>}
      {policy.status === "superseded" && <Banner tone="warning">This policy is superseded. It is kept for history only.</Banner>}
      {policy.status === "published" && <Banner tone="success">Current published policy.</Banner>}
      {manage && pending && policy.status === "published" && (
        <Banner tone="info">Version {pending.version} is a draft and is not visible to employees until you publish it.</Banner>
      )}
      {manage && (policy.status === "needs_review" || policy.importSourceKey) && (
        <section className="panel">
          <h2>Review checklist before publishing</h2>
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

      {editing && manage ? (
        <PolicyEditor policy={policy} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      ) : showing && (
        <section className="panel policy-detail-panel">
          <div className="split">
            <div>
              <h2>Version {versionLabel(showing.version)}</h2>
              <p className="muted">
                Effective {showing.effectiveDate ? formatDate(showing.effectiveDate) : "unset"}
                {showing.reviewDate ? ` · review by ${formatDate(showing.reviewDate)}` : ""}
                {showing.publishedAt ? ` · published ${formatDateTime(showing.publishedAt)}` : " · not published"}
              </p>
            </div>
            {current && showing.id === current.id && policy.status === "published" && <StatusBadge value="published" />}
            {showing.publishedAt && policy.status !== "published" && <StatusBadge value="superseded" />}
          </div>
          <p className="policy-summary">{showing.summary}</p>
          {showing.content?.trim() ? (
            <div className="policy-body">{showing.content}</div>
          ) : (
            <Banner tone="info">
              Full wording is in the attached source document{showing.fileName ? ` (${showing.fileName})` : ""}. Download to read the original file. Text was not rewritten during import.
            </Banner>
          )}
          <div className="actions">
            {(showing.fileKey || showing.fileName) && (manage || showing.publishedAt) && (
              <Button variant="secondary" onClick={() => actions.downloadPolicyFile(policy.id, showing.id)}>Download source</Button>
            )}
            {manage && (
              <label className="btn btn-secondary">
                {uploading ? "Uploading…" : "Replace / attach file"}
                <input
                  type="file"
                  hidden
                  accept=".pdf,.docx,.doc,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  disabled={uploading}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    if (!window.confirm(`Attach “${file.name}” to the draft version? Prior published versions stay unchanged.`)) return;
                    setUploading(true);
                    const result = await actions.uploadPolicyFile(policy.id, file);
                    setUploading(false);
                    if (!result.ok) setError(result.message);
                  }}
                />
              </label>
            )}
            {manage && <Button variant="secondary" onClick={() => setPreview(true)}>Preview</Button>}
            {manage && <Button onClick={() => setEditing(true)}>{policy.status === "published" ? "New version / edit draft" : "Edit draft"}</Button>}
            {manage && policy.status === "draft" && (
              <Button variant="secondary" disabled={busy} onClick={async () => {
                setBusy(true);
                const result = await actions.submitPolicyForReview(policy.id);
                setBusy(false);
                if (!result.ok) setError(result.message);
              }}>Mark needs review</Button>
            )}
            {manage && (policy.status === "draft" || policy.status === "needs_review" || pending) && (
              <Button onClick={() => setPublish(true)}>Publish…</Button>
            )}
            {manage && policy.status !== "archived" && policy.status !== "superseded" && (
              <Button variant="danger" onClick={() => setArchive(true)}>Archive…</Button>
            )}
            {manage && (policy.status === "archived" || policy.status === "superseded") && (
              <Button onClick={() => setRestore(true)}>Restore to draft…</Button>
            )}
            {manage && (
              <Button
                variant="secondary"
                onClick={async () => {
                  const result = await actions.setPolicyAcknowledgementRequired(policy.id, !requiresAck);
                  if (!result.ok) setError(result.message);
                }}
              >
                {requiresAck ? "Turn off acknowledgement" : "Require acknowledgement"}
              </Button>
            )}
            {!manage && policy.status === "published" && current && requiresAck && (
              acknowledged
                ? <Banner tone="success">You acknowledged version {current.version} on record.</Banner>
                : <Button onClick={() => setAckOpen(true)}>Acknowledge version {current.version}</Button>
            )}
          </div>
          <p className="faint">Opening or downloading does not record acknowledgement. Explicit confirmation is required when acknowledgement is enabled.</p>
        </section>
      )}

      <section className="panel">
        <h2>Version history</h2>
        <p className="muted">Published versions are kept. They are not deleted when you archive or create a newer draft.</p>
        {policy.versions.map((item) => {
          const isCurrent = current?.id === item.id && policy.status === "published";
          const status: PolicyStatus = isCurrent ? "published" : item.publishedAt ? "superseded" : "draft";
          return (
            <div key={item.id} className="notice split">
              <div>
                <strong>Version {versionLabel(item.version)}</strong>
                <div className="muted">{item.summary}</div>
                <div className="muted">
                  Effective {item.effectiveDate ? formatDate(item.effectiveDate) : "unset"}
                  {" · "}
                  {item.publishedAt ? `published ${formatDateTime(item.publishedAt)}` : "draft"}
                  {item.fileName ? ` · ${item.fileName}` : ""}
                </div>
              </div>
              <div className="actions">
                <StatusBadge value={status} />
                {(manage || item.publishedAt) && item.fileKey && (
                  <Button size="sm" variant="ghost" onClick={() => actions.downloadPolicyFile(policy.id, item.id)}>Download</Button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      {related.length > 0 && (
        <section className="panel">
          <h2>Related policies</h2>
          <ul className="policy-related">
            {related.map((item) => (
              <li key={item.id}><Link to={`/policies/${item.id}`}>{item.title}</Link></li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={preview} title="Preview before publishing" onClose={() => setPreview(false)} className="modal-wide">
        {(pending ?? showing) && (
          <>
            <p className="muted">Employees who match {audienceLabel(policy, locationName, departmentName)} will see this after you publish.</p>
            <h3>{policy.title} · version {versionLabel((pending ?? showing)!.version)}</h3>
            <p>{(pending ?? showing)!.summary}</p>
            <div className="policy-body">{(pending ?? showing)!.content || "See attached source document."}</div>
            <Button variant="secondary" onClick={() => setPreview(false)}>Close preview</Button>
          </>
        )}
      </Modal>
      <DecisionDialog
        open={publishOpen}
        title="Publish policy"
        body="Employees who match the audience will be able to read this version. Publishing does not mark it acknowledged. Confirm the checklist is complete."
        confirmLabel="Publish"
        onClose={() => setPublish(false)}
        onConfirm={async () => {
          const result = await actions.publishPolicy(policy.id);
          if (!result.ok) setError(result.message);
          setPublish(false);
        }}
      />
      <DecisionDialog
        open={archiveOpen}
        title="Archive policy"
        body="Archived policies stay in history and are no longer shown as current to employees. Published version files are kept."
        confirmLabel="Archive"
        tone="danger"
        onClose={() => setArchive(false)}
        onConfirm={async () => {
          const result = await actions.archivePolicy(policy.id);
          if (!result.ok) setError(result.message);
          setArchive(false);
        }}
      />
      <DecisionDialog
        open={restoreOpen}
        title="Restore policy"
        body="Restore this policy as a draft so HR can review and publish again."
        confirmLabel="Restore to draft"
        onClose={() => setRestore(false)}
        onConfirm={async () => {
          const result = await actions.restorePolicy(policy.id);
          if (!result.ok) setError(result.message);
          setRestore(false);
        }}
      />
      <DecisionDialog
        open={ackOpen}
        title="Acknowledge policy"
        body={`I confirm I have read ${policy.title} version ${current?.version}. This records my employee ID, the policy version, and the time.`}
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

function PolicyEditor({ policy, onDone, onCancel }: { policy?: Policy; onDone: () => void; onCancel: () => void }) {
  const { state, actions } = useApp();
  const pending = policy ? draftVersion(policy) : undefined;
  const source = pending ?? (policy ? latestVersion(policy) : undefined);
  const creatingNewVersion = Boolean(policy?.status === "published" && !pending);
  const [title, setTitle] = useState(policy?.title ?? "");
  const [category, setCategory] = useState(policy?.category ?? "Workplace");
  const [summary, setSummary] = useState(source?.summary ?? "");
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
          if (!window.confirm(`Upload and store “${pendingFile.name}” on the server?`)) {
            setSaving(false);
            onDone();
            return;
          }
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
      <p className="muted">Drafts and Needs review stay private to HR. Employees never see them until you publish.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>
      <div className="form-grid">
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            {POLICY_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Version" hint="Use Unspecified for imports until HR confirms.">
          <input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0 or Unspecified" />
        </Field>
        <Field label="Effective date" hint="Required before publish. Leave blank if unknown.">
          <DatePicker value={effectiveDate} onChange={setEffective} />
        </Field>
        <Field label="Review date (optional)">
          <DatePicker value={reviewDate} onChange={setReview} />
        </Field>
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
        <Field label="Policy owner (optional)">
          <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Unassigned</option>
            {state.employees.filter((item) => item.role === "hr" || item.role === "admin").map((item) => (
              <option key={item.id} value={item.id}>{fullName(item)}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Keywords (optional)" hint="Comma-separated; used in search.">
        <input value={keywords} onChange={(event) => setKeywords(event.target.value)} />
      </Field>
      <Field label="Summary"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
      <Field label="Policy text (optional if a file is attached)">
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={10} />
      </Field>
      <Field label="Source document" hint="PDF, DOCX, DOC, or TXT up to 15 MB. Stored privately on the server.">
        <input
          type="file"
          accept=".pdf,.docx,.doc,.txt"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            setPendingFile(file);
            if (file) setFileName(file.name);
          }}
        />
        {(fileName || pendingFile) && <p className="muted">Selected: {pendingFile?.name || fileName}{fileMeta.fileKey ? " · already stored" : ""}</p>}
      </Field>
      <label className="check">
        <input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} />
        <span>Require explicit employee acknowledgement after publish</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={markReview} onChange={(event) => setMarkReview(event.target.checked)} />
        <span>Mark as Needs review</span>
      </label>
      <div className="actions">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save draft"}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
