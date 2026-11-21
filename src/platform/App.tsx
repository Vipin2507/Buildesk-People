import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { PlatformShell } from "./shell";
import { PlatformProvider, usePlatform } from "./store";
import { PlatformAdoptLegacy } from "./pages/AdoptLegacy";
import { PlatformAudits } from "./pages/Audits";
import { PlatformCreateWorkspace } from "./pages/CreateWorkspace";
import { PlatformOperators } from "./pages/Operators";
import { PlatformOverview } from "./pages/Overview";
import { PlatformPlans } from "./pages/Plans";
import { PlatformSignIn } from "./pages/SignIn";
import { PlatformWorkspaceDetail } from "./pages/WorkspaceDetail";
import { PlatformWorkspaces } from "./pages/Workspaces";

function RequirePlatform() {
  const { ready, operator } = usePlatform();
  if (!ready) return <div className="platform-loading">Loading…</div>;
  if (!operator) return <Navigate to="/admin/signin" replace />;
  return <Outlet />;
}

export function PlatformApp() {
  return (
    <PlatformProvider>
      <Routes>
        <Route path="signin" element={<PlatformSignIn />} />
        <Route element={<RequirePlatform />}>
          <Route element={<PlatformShell />}>
            <Route index element={<PlatformOverview />} />
            <Route path="workspaces" element={<PlatformWorkspaces />} />
            <Route path="workspaces/new" element={<PlatformCreateWorkspace />} />
            <Route path="workspaces/adopt" element={<PlatformAdoptLegacy />} />
            <Route path="workspaces/:id" element={<PlatformWorkspaceDetail />} />
            <Route path="plans" element={<PlatformPlans />} />
            <Route path="operators" element={<PlatformOperators />} />
            <Route path="audits" element={<PlatformAudits />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>
        </Route>
      </Routes>
    </PlatformProvider>
  );
}
