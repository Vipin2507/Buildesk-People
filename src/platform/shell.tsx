import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { usePlatform } from "./store";

const NAV = [
  { to: "/admin", end: true, label: "Overview" },
  { to: "/admin/workspaces", label: "Client Workspaces" },
  { to: "/admin/plans", label: "Plans & Entitlements" },
  { to: "/admin/operators", label: "Platform Operators" },
  { to: "/admin/audits", label: "Audit Log" },
];

export function PlatformShell() {
  const { operator, signOut } = usePlatform();
  const navigate = useNavigate();

  return (
    <div className="platform-shell">
      <aside className="platform-nav" aria-label="Platform Admin">
        <div className="platform-brand">
          <div className="brand-mark">B</div>
          <div>
            <strong>Buildesk</strong>
            <span>Platform Admin</span>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "is-active" : undefined)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="platform-nav-foot">
          <p>{operator?.displayName}</p>
          <p className="muted">{operator?.email}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              await signOut();
              navigate("/admin/signin", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="platform-main">
        <Outlet />
      </div>
    </div>
  );
}
