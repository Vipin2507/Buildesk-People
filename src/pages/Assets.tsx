import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Banner, Button, DataTable, DecisionDialog, EmptyState, Field, PageHeader, StatusBadge, Tabs, Timeline } from "../components/ui";
import { formatDate, formatDateTime, fullName, labelFor } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Asset, AssetCondition, AssetType } from "../types";

export function Assets() {
  const { user, can } = useApp();
  if (!user) return null;
  const tabs = [
    { id: "mine", label: "My assets" },
    ...(can("assets.manage") ? [{ id: "register", label: "Register" }] : []),
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), can("assets.manage") ? "register" : "mine");
  return (
    <div>
      <PageHeader title="Assets" subtitle="Laptops, phones, access cards, and other equipment assigned to employees." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <Mine />}
      {tab === "register" && can("assets.manage") && <Register />}
    </div>
  );
}

function Mine() {
  const { state, user, actions } = useApp();
  if (!user) return null;
  const rows = state.assets.filter((item) => item.assignedTo === user.id);
  return (
    <section className="panel">
      <h2>Assigned to you</h2>
      {rows.length === 0 && <p className="muted">You have no assigned assets.</p>}
      {rows.map((item) => (
        <div key={item.id} className="notice">
          <div>
            <strong>{item.name} · {item.tag}</strong>
            <div className="muted">{labelFor(item.type)} · {item.brand} {item.model} · {labelFor(item.condition)} · assigned {item.assignedAt ? formatDate(item.assignedAt) : "—"}</div>
            <Link to={`/assets/${item.id}`}>View details</Link>
            {!item.acknowledged && <div>Please acknowledge that you received this asset.</div>}
          </div>
          <div className="actions">
            <StatusBadge value={item.status} />
            {!item.acknowledged && <Button size="sm" onClick={() => actions.acknowledgeAsset(item.id)}>Acknowledge</Button>}
          </div>
        </div>
      ))}
    </section>
  );
}

function Register() {
  const { state, actions } = useApp();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [assign, setAssign] = useState<Asset | null>(null);
  const [employeeId, setEmployee] = useState("");
  const [assignError, setAssignError] = useState("");
  const [action, setAction] = useState<{ asset: Asset; kind: "return" | "repair" | "retire" | "transfer" } | null>(null);
  const [transferTo, setTransfer] = useState("");
  const q = query.trim().toLowerCase();
  const rows = state.assets.filter((item) => (type === "all" || item.type === type) && (status === "all" || item.status === status) && (!q || `${item.name} ${item.tag} ${item.serial} ${item.brand} ${item.model}`.toLowerCase().includes(q)));
  return (
    <div>
      <div className="filters">
        <label className="field">Type
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            <option value="laptop">Laptop</option>
            <option value="phone">Phone</option>
            <option value="access_card">Access card</option>
            <option value="monitor">Monitor</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="repair">In repair</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <Field label="Search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, tag, brand, or serial" /></Field>
        <Button onClick={() => setAdding((value) => !value)}>{adding ? "Close form" : "Add asset"}</Button>
      </div>
      {adding && <AssetForm onDone={() => setAdding(false)} />}
      <DataTable
        caption="Asset register"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No assets"
        emptyBody={state.assets.length === 0 ? "Add equipment to the register before assigning it." : "No assets match these filters."}
        columns={[
          { key: "tag", header: "Tag", render: (row) => <Link to={`/assets/${row.id}`}>{row.tag}</Link> },
          { key: "name", header: "Asset", render: (row) => `${row.name}` },
          { key: "type", header: "Type", render: (row) => labelFor(row.type) },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          { key: "who", header: "Assigned to", render: (row) => row.assignedTo ? fullName(state.employees.find((item) => item.id === row.assignedTo)!) : "—" },
          { key: "ack", header: "Acknowledged", render: (row) => row.status === "assigned" ? (row.acknowledged ? "Yes" : "Waiting") : "—" },
          { key: "actions", header: "Actions", render: (row) => (
            <div className="actions">
              {row.status === "available" && <Button size="sm" onClick={() => { setAssign(row); setEmployee(""); setAssignError(""); }}>Assign</Button>}
              {row.status === "assigned" && <Button size="sm" variant="secondary" onClick={() => setAction({ asset: row, kind: "return" })}>Return</Button>}
              {row.status === "assigned" && <Button size="sm" variant="secondary" onClick={() => setAction({ asset: row, kind: "transfer" })}>Transfer</Button>}
              {row.status !== "retired" && row.status !== "repair" && <Button size="sm" variant="secondary" onClick={() => setAction({ asset: row, kind: "repair" })}>Repair</Button>}
              {row.status !== "retired" && <Button size="sm" variant="danger" onClick={() => setAction({ asset: row, kind: "retire" })}>Retire</Button>}
            </div>
          ) },
        ]}
      />
      <DecisionDialog
        open={Boolean(assign)}
        title="Assign asset"
        body={assign ? `${assign.name} (${assign.tag}) will be assigned and the employee will be asked to acknowledge it.` : ""}
        confirmLabel="Assign"
        onClose={() => setAssign(null)}
        onConfirm={async () => {
          if (!assign || !employeeId) {
            setAssignError("Choose an employee before assigning.");
            return;
          }
          const result = await actions.assignAsset(assign.id, employeeId);
          if (result.ok) setAssign(null);
          else setAssignError(result.message);
        }}
      >
        {assignError && <Banner tone="error">{assignError}</Banner>}
        <Field label="Employee">
          <select value={employeeId} onChange={(event) => setEmployee(event.target.value)}>
            <option value="">Choose an employee</option>
            {state.employees.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
          </select>
        </Field>
      </DecisionDialog>
      <DecisionDialog
        open={Boolean(action)}
        title={action ? { return: "Return asset", repair: "Send for repair", retire: "Retire asset", transfer: "Transfer asset" }[action.kind] : "Update asset"}
        body={action?.kind === "repair" ? "Sending an asset for repair marks it returned from the employee until it is available again." : "This writes a note to the asset history."}
        confirmLabel="Confirm"
        tone={action?.kind === "retire" ? "danger" : "primary"}
        requireComment
        onClose={() => setAction(null)}
        onConfirm={async (comment) => {
          if (!action) return;
          const result = await actions.transitionAsset(action.asset.id, action.kind, comment, transferTo);
          if (result.ok) setAction(null);
        }}
      >
        {action?.kind === "transfer" && (
          <Field label="Transfer to">
            <select value={transferTo} onChange={(event) => setTransfer(event.target.value)}>
              <option value="">Choose an employee</option>
              {state.employees.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
            </select>
          </Field>
        )}
      </DecisionDialog>
    </div>
  );
}

function AssetForm({ asset, onDone }: { asset?: Asset; onDone: (id?: string) => void }) {
  const { state, actions } = useApp();
  const [brand, setBrand] = useState(asset?.brand ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [assetType, setType] = useState<AssetType>(asset?.type ?? "laptop");
  const [serial, setSerial] = useState(asset?.serial ?? "");
  const [locationId, setLocation] = useState(asset?.locationId ?? state.locations[0]?.id ?? "");
  const [remarks, setRemarks] = useState(asset?.remarks ?? "");
  const [condition, setCondition] = useState<AssetCondition>(asset?.condition ?? "good");
  const [assignedTo, setAssigned] = useState(asset?.assignedTo ?? "");
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirm] = useState(false);
  const people = state.employees.filter((item) => item.status !== "inactive");
  const matches = people.filter((item) => `${item.firstName} ${item.lastName} ${item.employeeCode}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6);
  const selected = people.find((item) => item.id === assignedTo);
  const assignmentChanged = Boolean(asset) && (asset?.assignedTo ?? "") !== assignedTo && asset?.status !== "repair";

  const save = async () => {
    const next: Record<string, string> = {};
    if (brand.trim().length < 2) next.brand = assetType === "laptop" ? "Enter the laptop brand." : "Enter the brand or maker.";
    if (!model.trim()) next.model = "Enter the model.";
    if (!locationId) next.location = "Choose a location.";
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    const result = await actions.saveAsset({
      id: asset?.id,
      brand,
      model,
      type: assetType,
      serial,
      locationId,
      remarks,
      condition,
      assignedTo: assignedTo || null,
    });
    if (!result.ok) {
      const field = result.message.toLowerCase().includes("serial") ? "serial" : result.message.toLowerCase().includes("employee") ? "assignee" : "form";
      setErrors({ [field]: result.message });
      return;
    }
    onDone(result.id);
  };

  return (
    <section className="panel">
      <h2>{asset ? `Edit ${asset.tag}` : "Add asset"}</h2>
      <p className="muted">Choosing an employee marks the asset assigned. Choosing not assigned clears the employee. Remarks are stored with the asset. An attached document is kept by file name.</p>
      <form noValidate onSubmit={async (event) => {
        event.preventDefault();
        if (assignmentChanged) setConfirm(true);
        else save();
      }}>
        <Field label="Name of employee / Assigned to" error={errors.assignee} hint="Search by name or employee ID, or leave the asset unassigned.">
          <div className="picker">
            <input aria-label="Search employees" value={query} placeholder={selected ? `${fullName(selected)} · ${selected.employeeCode}` : "Search employees"} onChange={(event) => setQuery(event.target.value)} />
            {query.trim().length >= 1 && (
              <div className="picker-list" role="listbox">
                {matches.length === 0 && <div className="muted" style={{ padding: 8 }}>No matching employees.</div>}
                {matches.map((item) => (
                  <button key={item.id} type="button" onClick={() => { setAssigned(item.id); setQuery(""); setErrors((current) => ({ ...current, assignee: "" })); }}>{fullName(item)} · {item.employeeCode}</button>
                ))}
              </div>
            )}
          </div>
        </Field>
        <div className="actions" style={{ marginBottom: 12 }}>
          <Button type="button" variant={assignedTo ? "secondary" : "primary"} onClick={() => setAssigned("")}>Not assigned</Button>
          {selected && <span className="muted">Assigned to {fullName(selected)}</span>}
        </div>
        <div className="form-grid">
          <Field label="Status">
            <select value={assignedTo ? "assigned" : "not_assigned"} onChange={(event) => {
              if (event.target.value === "not_assigned") setAssigned("");
              else if (!assignedTo) setErrors((current) => ({ ...current, assignee: "Choose an employee to mark this asset assigned." }));
            }}>
              <option value="assigned">Assigned</option>
              <option value="not_assigned">Not assigned</option>
            </select>
          </Field>
          <Field label={assetType === "laptop" ? "Laptop brand" : "Brand"} error={errors.brand} hint="Use the maker. For phones, monitors, and cards this is still the brand.">
            <input value={brand} onChange={(event) => setBrand(event.target.value)} />
          </Field>
          <Field label="Asset type">
            <select value={assetType} onChange={(event) => setType(event.target.value as AssetType)}>
              <option value="laptop">Laptop</option>
              <option value="phone">Phone</option>
              <option value="monitor">Monitor</option>
              <option value="access_card">Access card</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Model" error={errors.model}><input value={model} onChange={(event) => setModel(event.target.value)} /></Field>
          <Field label="Serial number" error={errors.serial} hint="Optional. A serial number cannot be reused."><input value={serial} onChange={(event) => setSerial(event.target.value)} /></Field>
          <Field label="Location" error={errors.location}>
            <select value={locationId} onChange={(event) => setLocation(event.target.value)}>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Condition">
            <select value={condition} onChange={(event) => setCondition(event.target.value as AssetCondition)}>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </Field>
        </div>
        <Field label="Remarks" hint="Optional notes about condition, site, or handover.">
          <textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} />
        </Field>
        {errors.form && <Banner tone="error">{errors.form}</Banner>}
        {asset?.status === "repair" && <Banner tone="warning">This asset is in repair, so it cannot be assigned until it is available again.</Banner>}
        <div className="actions">
          <Button type="submit">{asset ? "Save changes" : "Save asset"}</Button>
          <Button type="button" variant="secondary" onClick={() => onDone()}>Cancel</Button>
        </div>
      </form>
      <DecisionDialog
        open={confirmOpen}
        title="Change assignment"
        body="This updates who holds the asset and writes the change, with your name and the time, to the asset history."
        confirmLabel="Save assignment"
        onClose={() => setConfirm(false)}
        onConfirm={async () => { setConfirm(false); await save(); }}
      />
    </section>
  );
}

export function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state, user, can } = useApp();
  const [editing, setEditing] = useState(false);
  const asset = state.assets.find((item) => item.id === id);
  if (!user) return null;
  if (!asset) return <EmptyState title="Asset not found" body="That asset is not in the register." action={<Link className="btn btn-secondary" to="/assets">Back to assets</Link>} />;
  const allowed = can("assets.manage") || asset.assignedTo === user.id;
  if (!allowed) return <EmptyState title="You can't view this asset" body="Employees can open only the assets assigned to them." action={<Link className="btn btn-secondary" to="/assets">Back to assets</Link>} />;
  const holder = state.employees.find((item) => item.id === asset.assignedTo);
  const location = state.locations.find((item) => item.id === asset.locationId)?.name ?? "—";
  return (
    <div>
      <PageHeader
        title={asset.name}
        subtitle={`${asset.tag} · ${labelFor(asset.type)}`}
        crumbs={[{ label: "Assets", to: "/assets" }, { label: asset.tag }]}
        actions={can("assets.manage") && asset.status !== "retired" ? <Button onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit asset"}</Button> : undefined}
      />
      {editing && can("assets.manage") && <AssetForm asset={asset} onDone={() => setEditing(false)} />}
      <div className="grid-2">
        <section className="panel">
          <div className="panel-head"><h2>Details</h2><StatusBadge value={asset.assignedTo ? "assigned" : asset.status === "available" ? "available" : asset.status} /></div>
          <dl className="dl">
            <dt>Assigned to</dt><dd>{holder ? <Link to={`/people/${holder.id}`}>{fullName(holder)}</Link> : "Not assigned"}</dd>
            <dt>Brand</dt><dd>{asset.brand}</dd>
            <dt>Model</dt><dd>{asset.model}</dd>
            <dt>Serial number</dt><dd>{asset.serial || "—"}</dd>
            <dt>Location</dt><dd>{location}</dd>
            <dt>Condition</dt><dd>{labelFor(asset.condition)}</dd>
            <dt>Assigned</dt><dd>{asset.assignedAt ? formatDate(asset.assignedAt) : "—"}</dd>
            <dt>Returned</dt><dd>{asset.returnedAt ? formatDate(asset.returnedAt) : "—"}</dd>
            <dt>Acknowledged</dt><dd>{asset.status === "assigned" ? (asset.acknowledged ? "Yes" : "Waiting") : "—"}</dd>
          </dl>
          {asset.remarks && <p>{asset.remarks}</p>}
        </section>
        <section className="panel">
          <h2>History</h2>
          <Timeline items={[...asset.history].reverse().map((item) => ({
            id: item.id,
            title: item.action,
            meta: `${fullName(state.employees.find((person) => person.id === item.actorId) ?? { firstName: "System", lastName: "" })} · ${formatDateTime(item.at)}`,
            body: item.comment,
          }))} />
        </section>
      </div>
      <Button variant="secondary" onClick={() => navigate("/assets")}>Back to assets</Button>
    </div>
  );
}
