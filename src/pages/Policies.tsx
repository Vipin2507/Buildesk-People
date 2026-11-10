import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { audienceLabel, policyApplies, publishedVersion } from "../domain/policies";
import { Banner, Button, DatePicker, DecisionDialog, EmptyState, Field, Modal, PageHeader, StatusBadge } from "../components/ui";
import { downloadText } from "../lib/download";
import { formatDate, formatDateTime } from "../lib/format";
import { useApp } from "../store/store";
import type { Policy, PolicyAudience } from "../types";

export function Policies() {
  const { state, user, can } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [creating, setCreating] = useState(false);
  if (!user) return null;
  if (!can("policies.view") && !can("policies.manage")) return <EmptyState title="Policies are unavailable" body="Your role does not include HR policies." />;
  const categories = [...new Set(state.policies.map((item) => item.category))].sort();
  const q = query.trim().toLowerCase();
  const rows = state.policies.filter((item) => {
    const visible = can("policies.manage") || (item.status === "published" && policyApplies(item, user)) || (item.status === "archived" && policyApplies(item, user));
    if (!visible) return false;
    if (!can("policies.manage") && item.status === "draft") return false;
    if (category !== "all" && item.category !== category) return false;
    if (status !== "all" && item.status !== status) return false;
    if (q && !`${item.title} ${item.category}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return (
    <div>
      <PageHeader
        title="HR Policies"
        subtitle="Published policies that apply to you, with drafts and archives for HR."
        actions={can("policies.manage") ? <Button onClick={() => setCreating((value) => !value)}>{creating ? "Close form" : "New policy"}</Button> : undefined}
      />
      <div className="filters">
        <Field label="Search"><input value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
        <Field label="Category">
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        {can("policies.manage") && (
          <Field label="Status">
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        )}
      </div>
      {creating && <PolicyEditor onDone={() => setCreating(false)} />}
      {rows.length === 0 && <EmptyState title="No policies" body={can("policies.manage") ? "Create a draft, preview it, and publish when it is ready." : "Published policies for your location or department will show up here."} />}
      <div className="stack">
        {rows.map((item) => {
          const current = publishedVersion(item) ?? item.versions[item.versions.length - 1];
          return (
            <Link key={item.id} className="notice" to={`/policies/${item.id}`}>
              <div>
                <strong>{item.title}</strong>
                <div className="muted">{item.category} · version {current?.version ?? "—"} · effective {current ? formatDate(current.effectiveDate) : "—"}</div>
                <div className="muted">{current?.summary}</div>
              </div>
              <StatusBadge value={item.status} />
            </Link>
          );
        })}
      </div>
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
  const policy = state.policies.find((item) => item.id === id);
  if (!user) return null;
  if (!policy) return <EmptyState title="Policy not found" body="That policy is not in this workspace." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  const manage = can("policies.manage");
  const applies = policyApplies(policy, user);
  if (!manage && !(applies && policy.status !== "draft")) {
    return <EmptyState title="This policy is not available to you" body="Drafts stay with HR. Published policies appear when they match your location or department." action={<Link className="btn btn-secondary" to="/policies">Back to policies</Link>} />;
  }
  const current = publishedVersion(policy);
  const pending = [...policy.versions].reverse().find((item) => !item.publishedAt);
  const showing = manage && pending && policy.status !== "published" ? pending : current ?? pending ?? policy.versions[0];
  const acknowledged = current ? state.acknowledgements.some((item) => item.policyId === policy.id && item.employeeId === user.id && item.version === current.version) : false;
  const locationName = (locationId: string) => state.locations.find((item) => item.id === locationId)?.name ?? "Location";
  const departmentName = (departmentId: string) => state.departments.find((item) => item.id === departmentId)?.name ?? "Department";
  return (
    <div>
      <PageHeader
        title={policy.title}
        subtitle={`${policy.category} · ${audienceLabel(policy, locationName, departmentName)}`}
        crumbs={[{ label: "HR Policies", to: "/policies" }, { label: policy.title }]}
        actions={<StatusBadge value={policy.status} />}
      />
      {policy.status === "archived" && <Banner tone="warning">This policy is archived. It is no longer the current instruction.</Banner>}
      {manage && pending && policy.status === "published" && <Banner tone="info">Version {pending.version} is a draft and is not visible to employees until you publish it.</Banner>}
      {editing && manage ? <PolicyEditor policy={policy} onDone={() => setEditing(false)} /> : showing && (
        <section className="panel">
          <h2>Version {showing.version}</h2>
          <p className="muted">Effective {formatDate(showing.effectiveDate)}{showing.publishedAt ? ` · published ${formatDateTime(showing.publishedAt)}` : " · not published"}</p>
          <p>{showing.summary}</p>
          <p className="policy-body">{showing.content}</p>
          <div className="actions">
            <Button variant="secondary" onClick={() => downloadText(showing.fileName || "policy.txt", `${policy.title}\nVersion ${showing.version}\n\n${showing.content}\n\nThe original upload is stored by name only.`)}>Download</Button>
            {manage && <Button variant="secondary" onClick={() => setPreview(true)}>Preview</Button>}
            {manage && <Button onClick={() => setEditing(true)}>{policy.status === "published" ? "New version" : "Edit draft"}</Button>}
            {manage && (policy.status === "draft" || pending) && <Button onClick={() => setPublish(true)}>Publish</Button>}
            {manage && policy.status !== "archived" && <Button variant="danger" onClick={() => setArchive(true)}>Archive</Button>}
            {!manage && policy.status === "published" && current && applies && (
              acknowledged
                ? <Banner tone="success">You acknowledged version {current.version}.</Banner>
                : <Button onClick={() => actions.acknowledgePolicy(policy.id)}>Acknowledge version {current.version}</Button>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Version history</h2>
        {policy.versions.map((item) => {
          const isCurrent = current?.id === item.id && policy.status === "published";
          return (
            <div key={item.id} className="notice">
              <div>
                <strong>Version {item.version}</strong>
                <div className="muted">{item.summary}</div>
                <div className="muted">Effective {formatDate(item.effectiveDate)} · {item.publishedAt ? `published ${formatDateTime(item.publishedAt)}` : "draft"}</div>
              </div>
              <StatusBadge value={isCurrent ? "published" : item.publishedAt ? "archived" : "draft"} />
            </div>
          );
        })}
      </section>
      <Modal open={preview} title="Preview before publishing" onClose={() => setPreview(false)}>
        {showing && (
          <>
            <p className="muted">Employees who match {audienceLabel(policy, locationName, departmentName)} will see this after you publish.</p>
            <h3>{policy.title} · version {showing.version}</h3>
            <p>{showing.summary}</p>
            <p className="policy-body">{showing.content}</p>
            <Button variant="secondary" onClick={() => setPreview(false)}>Close preview</Button>
          </>
        )}
      </Modal>
      <DecisionDialog open={publishOpen} title="Publish policy" body="Employees who match the audience will be able to read this version. Publishing does not mark it acknowledged." confirmLabel="Publish" onClose={() => setPublish(false)} onConfirm={() => { actions.publishPolicy(policy.id); setPublish(false); }} />
      <DecisionDialog open={archiveOpen} title="Archive policy" body="Archived policies stay available as history and are marked as no longer current." confirmLabel="Archive" tone="danger" onClose={() => setArchive(false)} onConfirm={() => { actions.archivePolicy(policy.id); setArchive(false); }} />
    </div>
  );
}

function PolicyEditor({ policy, onDone }: { policy?: Policy; onDone: () => void }) {
  const { state, actions } = useApp();
  const pending = policy ? [...policy.versions].reverse().find((item) => !item.publishedAt) : undefined;
  const source = pending ?? policy?.versions[policy.versions.length - 1];
  const [title, setTitle] = useState(policy?.title ?? "");
  const [category, setCategory] = useState(policy?.category ?? "Workplace");
  const [summary, setSummary] = useState(source?.summary ?? "");
  const [content, setContent] = useState(source?.content ?? "");
  const [version, setVersion] = useState(policy ? nextVersion(policy) : "1.0");
  const [effectiveDate, setEffective] = useState(source?.effectiveDate ?? "");
  const [fileName, setFile] = useState("");
  const [audienceKind, setKind] = useState<PolicyAudience["kind"]>(policy?.audience.kind ?? "all");
  const [locationId, setLocation] = useState(policy?.audience.kind === "location" ? policy.audience.locationId : state.locations[0]?.id ?? "");
  const [departmentId, setDepartment] = useState(policy?.audience.kind === "department" ? policy.audience.departmentId : state.departments[0]?.id ?? "");
  const [error, setError] = useState("");
  const audience: PolicyAudience = audienceKind === "location" ? { kind: "location", locationId } : audienceKind === "department" ? { kind: "department", departmentId } : { kind: "all" };
  return (
    <form className="panel" noValidate onSubmit={async (event) => {
      event.preventDefault();
      const result = await actions.savePolicy({ id: policy?.id, title, category, summary, content, version, effectiveDate, fileName, audience });
      if (!result.ok) setError(result.message);
      else onDone();
    }}>
      <h2>{policy ? "Save a version" : "New draft"}</h2>
      {error && <Banner tone="error">{error}</Banner>}
      <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="form-grid">
        <Field label="Category"><input value={category} onChange={(event) => setCategory(event.target.value)} /></Field>
        <Field label="Version"><input value={version} onChange={(event) => setVersion(event.target.value)} /></Field>
        <Field label="Effective date"><DatePicker value={effectiveDate} onChange={setEffective} /></Field>
        <Field label="Applies to">
          <select value={audienceKind} onChange={(event) => setKind(event.target.value as PolicyAudience["kind"])}>
            <option value="all">All employees</option>
            <option value="location">One location</option>
            <option value="department">One department</option>
          </select>
        </Field>
        {audienceKind === "location" && (
          <Field label="Location">
            <select value={locationId} onChange={(event) => setLocation(event.target.value)}>{state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </Field>
        )}
        {audienceKind === "department" && (
          <Field label="Department">
            <select value={departmentId} onChange={(event) => setDepartment(event.target.value)}>{state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </Field>
        )}
      </div>
      <Field label="Summary"><textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
      <Field label="Policy text"><textarea value={content} onChange={(event) => setContent(event.target.value)} /></Field>
      <Field label="Document" hint="The file name and the text above are stored. A PDF binary is not stored.">
        <input type="file" onChange={(event) => setFile(event.target.files?.[0]?.name ?? "")} />
      </Field>
      <div className="actions">
        <Button type="submit">Save draft</Button>
        <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

function nextVersion(policy: Policy): string {
  const latest = policy.versions[policy.versions.length - 1]?.version ?? "1.0";
  const [major, minor] = latest.split(".").map((item) => Number(item));
  if (Number.isNaN(major) || Number.isNaN(minor)) return "1.0";
  return `${major}.${minor + 1}`;
}
