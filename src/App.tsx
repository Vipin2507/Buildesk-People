import { Component, type ReactNode } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Shell } from "./components/shell";
import { EmptyState } from "./components/ui";
import { Assets } from "./pages/Assets";
import { Attendance } from "./pages/Attendance";
import { Expenses } from "./pages/Expenses";
import { Leave } from "./pages/Leave";
import { Notifications } from "./pages/Notifications";
import { OrgChart } from "./pages/OrgChart";
import { Overview } from "./pages/Overview";
import { Payroll } from "./pages/Payroll";
import { People } from "./pages/People";
import { Person } from "./pages/Person";
import { Profile } from "./pages/Profile";
import { Reports } from "./pages/Reports";
import { Settings } from "./pages/Settings";
import { ForgotPassword, SignIn } from "./pages/SignIn";
import { Policies, PolicyDetail } from "./pages/Policies";
import { UserDetail, Users } from "./pages/Users";
import { AssetDetail } from "./pages/Assets";
import { TicketDetail } from "./pages/TicketDetail";
import { Tickets } from "./pages/Tickets";
import { StoreProvider, useApp } from "./store/store";

export function App() {
  return (
    <StoreProvider>
      <BrowserRouter>
        <Boundary>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route element={<RequireAuth />}>
              <Route element={<Shell />}>
                <Route index element={<Overview />} />
                <Route path="people" element={<People />} />
                <Route path="people/org" element={<OrgChart />} />
                <Route path="people/:id" element={<Person />} />
                <Route path="attendance" element={<Attendance />} />
                <Route path="leave" element={<Leave />} />
                <Route path="payroll" element={<Payroll />} />
                <Route path="payroll/:runId" element={<Payroll />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="tickets" element={<Tickets />} />
                <Route path="tickets/:id" element={<TicketDetail />} />
                <Route path="assets" element={<Assets />} />
                <Route path="assets/:id" element={<AssetDetail />} />
                <Route path="policies" element={<Policies />} />
                <Route path="policies/:id" element={<PolicyDetail />} />
                <Route path="users" element={<Users />} />
                <Route path="users/:id" element={<UserDetail />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<Settings />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
                <Route path="*" element={<EmptyState title="Page not found" body="That address is not part of Buildesk People." />} />
              </Route>
            </Route>
          </Routes>
        </Boundary>
      </BrowserRouter>
    </StoreProvider>
  );
}

function RequireAuth() {
  const { user } = useApp();
  if (!user) return <Navigate to="/signin" replace />;
  return <Outlet />;
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="signin-main">
        <h1>This page ran into a problem</h1>
        <p>You can reload, or reset the demo data and start again.</p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => location.reload()}
        >
          Reset demo and reload
        </button>
      </main>
    );
  }
}
