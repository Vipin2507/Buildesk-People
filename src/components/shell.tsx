import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Clock,
  Laptop,
  Moon,
  ShieldCheck,
  Sun,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Search,
  Settings,
  Ticket,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { navCounts } from "../domain/feed";
import { labelFor } from "../lib/format";
import { photoSrc } from "../lib/photo";
import { useThemeChoice } from "../lib/theme";
import { useApp } from "../store/store";
import { Avatar, Toasts, cx } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/people", label: "People", icon: Users },
  { to: "/attendance", label: "Attendance", icon: Clock },
  { to: "/leave", label: "Leave", icon: CalendarDays },
  { to: "/payroll", label: "Payroll", icon: Wallet },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/tickets", label: "Tickets", icon: Ticket },
  { to: "/assets", label: "Assets", icon: Laptop },
  { to: "/policies", label: "HR Policies", icon: BookOpen },
  { to: "/users", label: "User Management", icon: ShieldCheck },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/automation", label: "Automation", icon: Workflow },
  { to: "/settings", label: "Settings", icon: Settings },
];

function sectionTitle(pathname: string): string {
  if (pathname.startsWith("/people")) return "People";
  if (pathname.startsWith("/tickets")) return "Tickets";
  if (pathname.startsWith("/payroll")) return "Payroll";
  if (pathname.startsWith("/notifications")) return "Notifications";
  if (pathname.startsWith("/profile")) return "Profile";
  if (pathname.startsWith("/policies")) return "HR Policies";
  if (pathname.startsWith("/users")) return "User Management";
  if (pathname.startsWith("/automation")) return "Automation";
  return NAV.find((item) => item.to === pathname)?.label ?? "Buildesk People";
}

export function Shell() {
  const { state, user, can, actions, toasts, dismissToast } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useThemeChoice(user?.id ?? null);
  const searchRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
    setMenuOpen(false);
    setNotesOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!searchRef.current?.contains(target)) setSearchOpen(false);
      if (!menuRef.current?.contains(target)) setMenuOpen(false);
      if (!notesRef.current?.contains(target)) setNotesOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!user) return null;
  const counts = navCounts(state, user);
  const unread = state.notifications.filter((item) => item.userId === user.id && !item.read);
  const showSettings = can("settings.org") || can("settings.payroll") || can("settings.roles");
  const showAutomation = can("automation.manage");
  const results = searchItems(state, user.id, can("assets.manage"), can("tickets.manage"), query);
  const full = `${user.firstName} ${user.lastName}`;

  return (
    <div className="app-shell">
      <a className="skip" href="#content">Skip to content</a>
      {mobileOpen && <button className="scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={cx("sidebar", collapsed && "collapsed", mobileOpen && "open")} aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div className="brand-text hide-collapsed">
            <strong>Buildesk People</strong>
            <span>Human resources</span>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.filter((item) => (item.to !== "/settings" || showSettings) && (item.to !== "/automation" || showAutomation) && (item.to !== "/policies" || can("policies.view") || can("policies.manage")) && (item.to !== "/users" || can("users.manage"))).map((item) => {
            const Icon = item.icon;
            const count = counts[item.to] ?? 0;
            return (
              <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cx("nav-link", isActive && "active")} title={item.label}>
                <Icon size={18} aria-hidden />
                <span className="hide-collapsed">{item.label}</span>
                {count > 0 && <span className="nav-count">{count}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="side-foot">
          <button className="ghost-light" type="button" onClick={() => actions.signOut()}>
            <LogOut size={18} aria-hidden />
            <span className="hide-collapsed">Log out</span>
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-btn"
            type="button"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={() => {
              if (window.matchMedia("(max-width: 960px)").matches) setMobileOpen(true);
              else setCollapsed((value) => !value);
            }}
          >
            <Menu size={18} />
          </button>
          <div className="top-title">{sectionTitle(location.pathname)}</div>
          <div className="search" ref={searchRef}>
            <Search size={16} aria-hidden />
            <input
              aria-label="Search people, tickets, and assets"
              placeholder="Search people, tickets, assets"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setSearchOpen(false);
                if (event.key === "Enter" && results[0]) {
                  navigate(results[0].href);
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && query.trim().length >= 2 && (
              <div className="search-pop" role="listbox">
                {results.length === 0 && <div className="muted" style={{ padding: 8 }}>No matches.</div>}
                {results.map((item) => (
                  <button key={item.href + item.label} type="button" onClick={() => { navigate(item.href); setQuery(""); setSearchOpen(false); }}>
                    <strong>{item.label}</strong>
                    <div className="muted">{item.meta}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="icon-btn theme-toggle"
            type="button"
            aria-label={theme.resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              theme.update(theme.resolved === "dark" ? "light" : "dark", {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
              });
            }}
          >
            <span className="theme-icon" key={theme.resolved} aria-hidden="true">
              {theme.resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </span>
          </button>
          <div ref={notesRef} style={{ position: "relative" }}>
            <button className="icon-btn" type="button" aria-label="Notifications" aria-expanded={notesOpen} onClick={() => setNotesOpen((value) => !value)}>
              <Bell size={18} />
              {unread.length > 0 && <span className="dot" />}
            </button>
            {notesOpen && (
              <div className="menu" style={{ minWidth: 320 }}>
                {unread.length === 0 && <div className="muted" style={{ padding: 8 }}>You're caught up.</div>}
                {unread.slice(0, 6).map((item) => (
                  <button key={item.id} type="button" onClick={() => { actions.markNotification(item.id); navigate(item.href); }}>
                    <strong>{item.title}</strong>
                    <div className="muted">{item.body}</div>
                  </button>
                ))}
                <button type="button" onClick={() => navigate("/notifications")}>View all notifications</button>
              </div>
            )}
          </div>
          <div ref={menuRef} style={{ position: "relative" }}>
            <button className="profile-btn" type="button" aria-label={`${full}, ${labelFor(user.role)}`} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <Avatar name={full} color={user.avatarColor} size={32} photoSrc={photoSrc(user.id, user.photoUpdatedAt)} />
              <span className="profile-name">
                <strong style={{ display: "block", lineHeight: 1.2 }}>{full}</strong>
                <span className="muted" style={{ fontSize: 12 }}>{labelFor(user.role)}</span>
              </span>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <button type="button" onClick={() => navigate("/profile")}>View profile</button>
                <button type="button" onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  theme.update("system", { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                }}>Use device theme</button>
                <button type="button" onClick={() => navigate("/notifications")}>Notifications</button>
                <button type="button" onClick={() => actions.signOut()}>Log out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content" id="content">
          <Outlet />
          <footer className="footer">Buildesk People · {state.settings.orgName}</footer>
        </main>
      </div>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function searchItems(
  state: ReturnType<typeof useApp>["state"],
  userId: string,
  manageAssets: boolean,
  manageTickets: boolean,
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const people = state.employees
    .filter((item) => item.status !== "inactive" && `${item.firstName} ${item.lastName} ${item.employeeCode} ${item.jobTitle}`.toLowerCase().includes(q))
    .slice(0, 5)
    .map((item) => ({ href: `/people/${item.id}`, label: `${item.firstName} ${item.lastName}`, meta: `${item.employeeCode} · ${item.jobTitle}` }));
  const tickets = state.tickets
    .filter((item) => (item.employeeId === userId || manageTickets) && `${item.subject} ${item.number}`.toLowerCase().includes(q))
    .slice(0, 4)
    .map((item) => ({ href: `/tickets/${item.id}`, label: item.subject, meta: item.number }));
  const assets = state.assets
    .filter((item) => (item.assignedTo === userId || manageAssets) && `${item.name} ${item.tag} ${item.serial} ${item.brand}`.toLowerCase().includes(q))
    .slice(0, 4)
    .map((item) => ({ href: `/assets/${item.id}`, label: item.name, meta: item.tag }));
  return [...people, ...tickets, ...assets];
}
