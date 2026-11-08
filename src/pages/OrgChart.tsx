import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { orgTree, type OrgNode } from "../domain/org";
import { fullName } from "../lib/format";
import { useApp } from "../store/store";

export function OrgChart() {
  const { state } = useApp();
  const [showInactive, setShowInactive] = useState(false);
  const tree = orgTree(state.employees, showInactive);
  return (
    <div>
      <PageHeader
        title="Organization chart"
        subtitle="Reporting lines for the demo company. Select a person to open their profile."
        crumbs={[{ label: "People", to: "/people" }, { label: "Organization chart" }]}
        actions={<Link className="btn btn-secondary" to="/people">Directory</Link>}
      />
      <label className="check">
        <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
        <span>Show inactive employees</span>
      </label>
      <div className="org-scroll">
        <ul className="org">
          {tree.map((node) => <OrgNodeView key={node.employee.id} node={node} />)}
        </ul>
      </div>
    </div>
  );
}

function OrgNodeView({ node }: { node: OrgNode }) {
  return (
    <li>
      <Link className="org-card" to={`/people/${node.employee.id}`}>
        <strong>{fullName(node.employee)}</strong>
        <div className="muted">{node.employee.jobTitle}</div>
        <div className="faint">{node.employee.status === "inactive" ? "Inactive" : node.employee.employeeCode}</div>
      </Link>
      {node.reports.length > 0 && (
        <ul>
          {node.reports.map((child) => <OrgNodeView key={child.employee.id} node={child} />)}
        </ul>
      )}
    </li>
  );
}
