import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import {
  LayoutDashboard,
  ReceiptText,
  Boxes,
  Users,
  ChartNoAxesCombined,
  Settings2,
  Layers3,
  Store,
  ChevronsUpDown,
  ChevronRight,
  Search,
  Bell,
  Menu,
  PanelLeft,
  Plus,
  BookOpen,
  ShieldCheck,
  ArrowUpRight,
  Command,
  X,
  ChevronDown,
  LockKeyhole,
  LogOut,
  PackageSearch,
  Mail,
  CalendarDays,
  HandCoins,
  Clock3,
  Hourglass,
} from "lucide-react";
import { Brand, Icon, Modal, Avatar, Empty } from "./ui";
import { useShop } from "../lib/store";
import { day, initials, rupee } from "../lib/format";
import {
  loadLastBackupAt,
  loadBackupPreferences,
  runDailyCheck,
} from "../lib/backup";
import {
  dueLoans,
  loanState,
  loanSummary,
} from "../../functions/src/core/loans";
import Dashboard from "../pages/Dashboard";
import { Invoices, InvoiceEditor, InvoiceDetail } from "../pages/Billing";
import { Inventory, Customers, MetalRates } from "../pages/Catalog";
import { Reports, Settings } from "../pages/Management";
import { Loans } from "../pages/Loans";
const links = [
  { path: "/", name: "Dashboard", hi: "डैशबोर्ड", icon: LayoutDashboard },
  {
    path: "/billing",
    name: "Billing & invoices",
    hi: "बिल और इनवॉइस",
    icon: ReceiptText,
  },
  { path: "/inventory", name: "Inventory", hi: "स्टॉक", icon: Boxes },
  { path: "/customers", name: "Customers", hi: "ग्राहक", icon: Users },
  {
    path: "/loans",
    name: "Girvi & EMI",
    hi: "गिरवी और EMI",
    icon: HandCoins,
  },
  { path: "/rates", name: "Metal rates", hi: "धातु के भाव", icon: Layers3 },
  {
    path: "/reports",
    name: "Reports",
    hi: "रिपोर्ट",
    icon: ChartNoAxesCombined,
  },
  {
    path: "/settings",
    name: "Shop settings",
    hi: "दुकान सेटिंग",
    icon: Settings2,
  },
];
export function Shell() {
  const { data, license, demo, logout } = useShop(),
    [mobile, M] = useState(false),
    [popup, V] = useState(""),
    [query, Q] = useState("");
  const nav = useNavigate(),
    loc = useLocation();
  const { profile: p } = data;
  const hi = p.language === "hi";
  useEffect(() => {
    M(false);
    V("");
    Q("");
    window.scrollTo(0, 0);
  }, [loc.pathname, loc.search]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        V((v) => (v === "Search workspace" ? "" : "Search workspace"));
      }
      if (e.key === "Escape") M(false);
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);
  const current =
    links.find((l) => l.path !== "/" && loc.pathname.startsWith(l.path)) ??
    links[0];
  const low = data.products.filter((p) => p.stock < 5);
  // Alerts & reminders (moved here from the top of the Dashboard, Nov
  // 2026 — the dashboard top stays clean; the alerts live on the
  // side instead). Recomputed on every navigation, so backing up in
  // Settings and coming back clears the backup alert without a reload.
  const [backupDue, setBackupDue] = useState(false);
  useEffect(() => {
    try {
      setBackupDue(
        loadBackupPreferences().autoReminder &&
          runDailyCheck(loadLastBackupAt()),
      );
    } catch {
      // Reminder is best-effort; a storage failure must not break the shell.
      setBackupDue(false);
    }
  }, [loc.pathname]);
  const due = useMemo(() => dueLoans(data.loans ?? []), [data.loans]),
    dueBalance = due.reduce((n, l) => n + loanSummary(l).balancePaise, 0),
    overdueCount = due.filter((l) => loanState(l) === "overdue").length;
  const goto = (path: string) => {
    V("");
    M(false);
    nav(path);
  };
  const navItem = (l: (typeof links)[number]) => (
    <NavLink
      end={l.path === "/"}
      key={l.path}
      to={l.path}
      className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
    >
      <Icon as={l.icon} />
      <span>{hi ? l.hi : l.name}</span>
    </NavLink>
  );
  const results = [
    ...links.map((l) => ({ title: l.name, kind: "Page", path: l.path })),
    ...data.products.map((x) => ({
      title: x.name,
      kind: "Product · " + x.sku,
      path: "/inventory?item=" + x.id,
    })),
    ...data.customers.map((c) => ({
      title: c.name,
      kind: "Customer",
      path: "/customers?item=" + c.id,
    })),
    ...(data.loans ?? []).map((l) => ({
      title: l.itemName,
      kind: (l.kind === "girvi" ? "Girvi · " : "EMI · ") +
        (data.customers.find((c) => c.id === l.customerId)?.name ?? ""),
      path: "/loans?item=" + l.id,
    })),
    ...data.invoices
      .slice()
      .reverse()
      .map((i) => ({
        title: i.number,
        kind: i.customer?.name ?? "Walk-in",
        path: "/billing/" + i.id,
      })),
  ]
    .filter((r) =>
      (r.title + " " + r.kind).toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 10);
  return (
    <div className="app">
      {mobile && (
        <button
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => M(false)}
        />
      )}
      <aside className={"sidebar" + (mobile ? " open" : "")}>
        <Link to="/" className="brand-link" aria-label="Aurum dashboard">
          <Brand />
        </Link>
        <button className="shop-switch" onClick={() => V("Workspace details")}>
          <span className="shop-icon">
            {p.logo ? <img src={p.logo} alt="" /> : <Store size={19} />}
          </span>
          <span>
            <strong>{p.shopName}</strong>
            <small>
              <i className="dot" />
              {demo ? "Demo workspace" : "Licensed workspace"}
            </small>
          </span>
          <ChevronsUpDown size={14} />
        </button>
        <div className="nav-group">
          <h2>WORKSPACE</h2>
          {links.slice(0, 4).map(navItem)}
        </div>
        <div className="nav-group">
          <h2>MANAGEMENT</h2>
          {links.slice(4).map(navItem)}
        </div>
        {(backupDue || due.length > 0) && (
          <div className="nav-group">
            <h2>ALERTS &amp; REMINDERS</h2>
            {backupDue && (
              <button
                className="nav-item alert-item"
                onClick={() => goto("/settings")}
              >
                <Icon as={Clock3} />
                <span>
                  Backup not done today
                  <small>Back up now in Settings</small>
                </span>
              </button>
            )}
            {due.length > 0 && (
              <button
                className="nav-item alert-item"
                onClick={() => goto("/loans")}
              >
                <Icon as={Hourglass} />
                <span>
                  {due.length} girvi / EMI due
                  {overdueCount > 0 ? ` (${overdueCount} overdue)` : ""}
                  <small>{rupee(dueBalance, 2)} balance due</small>
                </span>
              </button>
            )}
          </div>
        )}
        <div className="side-bottom">
          <div className="guide-box">
            <span className="guide-star">✧</span>
            <BookOpen size={18} />
            <strong>Workspace guide</strong>
            <p>A little help for your daily work.</p>
            <button onClick={() => V("Workspace guide")}>
              Open guide <ArrowUpRight size={13} />
            </button>
          </div>
          <button
            className="license-link"
            onClick={() => V("License & access")}
          >
            <ShieldCheck size={16} />
            {hi ? "लाइसेंस और एक्सेस" : "License & access"}
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            onClick={() => M(true)}
            aria-label="Open navigation"
          >
            <Menu size={21} />
          </button>
          <div className="crumb">
            <PanelLeft size={16} />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{hi ? current.hi : current.name}</strong>
          </div>
          <div className="top-tools">
            <button
              className="global-search"
              onClick={() => V("Search workspace")}
            >
              <Search size={15} />
              <span>Search anything...</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="bell icon-btn"
              aria-label="View notifications"
              onClick={() => V("Notifications")}
            >
              <Bell size={19} />
              {low.length > 0 && <i />}
            </button>
            <i className="tool-divider" />
            <button
              className="profile-button"
              onClick={() => V("Workspace details")}
              aria-label="Open workspace profile"
            >
              <span className="owner-avatar">{initials(p.ownerName)}</span>
              <ChevronDown size={13} />
            </button>
          </div>
        </header>
        <main
          className="content"
          data-setup-required={!p.setupComplete}
          lang={p.language}
          data-shop-location={loc.pathname + loc.search}
          data-shop-home={
            loc.pathname === "/" && p.setupComplete ? "" : undefined
          }
        >
          {!demo && !p.setupComplete && loc.pathname !== "/settings" ? (
            <Navigate to="/settings?setup=1" replace />
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/billing" element={<Invoices />} />
              <Route
                path="/billing/new"
                element={<InvoiceEditor key={loc.pathname + loc.search} />}
              />
              <Route path="/billing/:id" element={<InvoiceDetail />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/loans" element={<Loans />} />
              <Route path="/rates" element={<MetalRates />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="*"
                element={
                  <Empty
                    title="Page not found"
                    text="This workspace page does not exist."
                  >
                    <Link to="/" className="btn primary">
                      Back to dashboard
                    </Link>
                  </Empty>
                }
              />
            </Routes>
          )}
        </main>
        <footer className="main-footer">
          <span>✧ &nbsp; Aurum Jewellery ERP</span>
          <span>
            {demo
              ? "Sample workspace · Session-only data"
              : "Device-verified workspace"}
          </span>
        </footer>
      </div>
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <LayoutDashboard />
          {hi ? "डैशबोर्ड" : "Overview"}
        </NavLink>
        <NavLink to="/billing" end>
          <ReceiptText />
          {hi ? "बिल" : "Invoices"}
        </NavLink>
        <Link className="quick-bill" to="/billing/new">
          <Plus />
          {hi ? "नया बिल" : "New bill"}
        </Link>
        <NavLink to="/inventory">
          <Boxes />
          {hi ? "स्टॉक" : "Stock"}
        </NavLink>
        <button onClick={() => M(true)}>
          <Menu />
          {hi ? "अन्य" : "More"}
        </button>
      </nav>
      <Modal open={!!popup} onClose={() => V("")} title={popup}>
        {popup === "Search workspace" ? (
          <>
            <label className="search-input full-search">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Search pages, products, customers, invoices…"
                value={query}
                onChange={(e) => Q(e.target.value)}
              />
            </label>
            <div className="pick-list">
              {results.map((r) => (
                <button key={r.path} onClick={() => goto(r.path)}>
                  <span>
                    <strong>{r.title}</strong>
                    <small>{r.kind}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!results.length && (
                <Empty
                  title="No results"
                  text="Try a product name or invoice number."
                />
              )}
            </div>
          </>
        ) : popup === "Notifications" ? (
          <>
            <p className="muted">Stock alerts from your workspace.</p>
            <div className="pick-list">
              {low.map((p) => (
                <button
                  key={p.id}
                  onClick={() => goto("/inventory?item=" + p.id)}
                >
                  <PackageSearch size={19} />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.stock} pieces left in stock</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              {!low.length && (
                <Empty title="All caught up" text="No low-stock alerts." />
              )}
            </div>
          </>
        ) : popup === "Workspace details" ? (
          <>
            <div className="identity-row">
              <Avatar name={p.shopName} />
              <div>
                <h3>{p.shopName}</h3>
                <p>{p.ownerName} · Shop owner</p>
              </div>
            </div>
            <div className="pick-list">
              <button onClick={() => goto("/settings")}>
                <Settings2 size={17} />
                Shop profile & settings
                <ChevronRight size={14} />
              </button>
              <button onClick={() => V("License & access")}>
                <ShieldCheck size={17} />
                License & access
                <ChevronRight size={14} />
              </button>
              {logout && (
                <button onClick={logout}>
                  <LogOut size={17} />
                  Sign out
                </button>
              )}
            </div>
          </>
        ) : popup === "License & access" ? (
          <>
            <div className="info-box">
              <ShieldCheck />
              <div>
                <strong>
                  {demo ? "Demonstration workspace" : "Verified device"}
                </strong>
                <p>
                  {demo
                    ? "This build uses disposable sample records. It does not issue licenses or connect to any shop’s live data. Refreshing the app resets the demo."
                    : `Plan: ${license?.plan} · ${license?.deviceLimit} device(s) allowed`}
                </p>
              </div>
            </div>
            {license && (
              <dl className="details">
                <dt>License</dt>
                <dd>{license.id}</dd>
                <dt>Valid until</dt>
                <dd>
                  {license.expiresAt ? day(license.expiresAt) : "Lifetime"}
                </dd>
                <dt>Platform</dt>
                <dd>{license.platform}</dd>
              </dl>
            )}
            <h3 className="spaced">How activation works</h3>
            <p className="muted">
              In the licensed build, sign in with your shop account, then use
              the one-time code from your provider. Your device must prove
              possession of its private key before accessing shop data.
            </p>
          </>
        ) : popup === "Workspace guide" ? (
          <div className="guide-content">
            {[
              [
                "01",
                "Set up your shop",
                "Change your name, branding and invoice preferences in Shop settings.",
                "/settings",
              ],
              [
                "02",
                "Prepare your inventory",
                "Add a product and record an effective metal rate for its purity.",
                "/inventory",
              ],
              [
                "03",
                "Create your first invoice",
                "Select a customer and items. Check the total and payment before finalizing.",
                "/billing/new",
              ],
              [
                "04",
                "Review your business",
                "View sales, collections and gross profit based on recorded invoices.",
                "/reports",
              ],
            ].map(([n, t, s, path]) => (
              <button key={n} onClick={() => goto(path)}>
                <b>{n}</b>
                <span>
                  <strong>{t}</strong>
                  <small>{s}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
