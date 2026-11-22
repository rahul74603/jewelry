import {
  accountDelta,
  accountDocuments,
} from "../../functions/src/core/documents";
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowRight,
  Plus,
  CalendarDays,
  ChevronDown,
  Wallet,
  IndianRupee,
  Boxes,
  Hourglass,
  TrendingUp,
  TrendingDown,
  ReceiptText,
  Layers3,
  Sparkles,
  SlidersHorizontal,
  Clock3,
  Package,
  ChevronRight,
  Coins,
} from "lucide-react";
import { useShop } from "../lib/store";
import { rupee, cash, day, priorRate, compact } from "../lib/format";
import { series, delta, smooth } from "../lib/analytics";
import {
  currentRates,
  indiaDay,
  saleInvoices,
  paymentStatus,
} from "../../functions/src/core/billing";
import { Avatar, Empty, Ingots, Select, Status, Icon } from "../components/ui";
import {
  loadLastBackupAt,
  loadBackupPreferences,
  runDailyCheck,
} from "../lib/backup";
import { prepareAutoSms } from "../lib/autoSms";
import {
  dueLoans,
  loanState,
  loanSummary,
} from "../../functions/src/core/loans";
import type { Invoice, Workspace } from "../../functions/src/core/model";
export function SalesChart({ data }: { data: Workspace }) {
  const [length, N] = useState(7),
    [hover, H] = useState<number | null>(null);
  const rows = useMemo(() => series(data, length), [data, length]);
  const highest = Math.max(...rows.map((r) => r.sales), 10000);
  const step =
    highest > 20000000
      ? 10000000
      : highest > 2000000
        ? 2500000
        : highest > 200000
          ? 250000
          : 25000;
  const max = Math.ceil(highest / step) * step;
  const left = 42,
    right = 568,
    top = 9,
    bottom = 137;
  const xy = (v: number, i: number) => [
    left + (i * (right - left)) / (rows.length - 1),
    bottom - (v / max) * (bottom - top),
  ];
  const pts = rows.map((r, i) => xy(r.sales, i));
  const main = smooth(pts);
  const paid = smooth(rows.map((r, i) => xy(r.paid, i)));
  const yl = (p: number) =>
    p >= 10000000
      ? Math.round(p / 1000000) / 10 + "L"
      : p >= 100000
        ? Math.round(p / 10000) / 10 + "k"
        : String(Math.round(p / 100));
  return (
    <section className="panel chart-card">
      <div className="panel-title">
        <div>
          <div className="section-kicker">
            <i />
            ANALYTICS
          </div>
          <h2>Sales performance</h2>
        </div>
        <Select
          aria-label="Sales chart period"
          value={length}
          onChange={(e) => {
            N(+e.target.value);
            H(null);
          }}
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </Select>
      </div>
      <div className="chart-legend">
        <span>
          <i />
          Sales
        </span>
        <span>
          <i />
          Collections
        </span>
        {hover !== null && (
          <strong>
            {day(rows[hover].date, { day: "numeric", month: "short" })} ·{" "}
            {rupee(rows[hover].sales)}
          </strong>
        )}
      </div>
      <div className="chart-area" onMouseLeave={() => H(null)}>
        <svg
          viewBox="0 0 582 165"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            "Sales and collections over " +
            length +
            " days. Total sales " +
            rupee(rows.reduce((s, r) => s + r.sales, 0))
          }
        >
          <defs>
            <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#83b9a3" stopOpacity=".35" />
              <stop offset="100%" stopColor="#cde2d5" stopOpacity=".07" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((n) => {
            const y = bottom - (n * (bottom - top)) / 4;
            return (
              <g key={n}>
                <line
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  stroke="#dfe6df"
                  strokeDasharray="3 4"
                />
                <text x={left - 8} y={y + 3} textAnchor="end">
                  {n ? "₹" + yl((max * n) / 4) : "₹0"}
                </text>
              </g>
            );
          })}
          <path
            d={`${main} L${right},${bottom} L${left},${bottom} Z`}
            fill="url(#sales-fill)"
          />
          <path
            d={main}
            fill="none"
            stroke="#437964"
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={paid}
            fill="none"
            stroke="#c8a14e"
            strokeDasharray="5 5"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          {pts.map(([x, y], i) => (
            <g key={i}>
              {(length === 7 ||
                i === 0 ||
                i === length - 1 ||
                i % Math.ceil(length / 6) === 0) && (
                <text
                  x={x}
                  y={159}
                  textAnchor={
                    i === length - 1 ? "end" : i === 0 ? "start" : "middle"
                  }
                >
                  {day(
                    rows[i].date,
                    length === 7
                      ? { weekday: "short" }
                      : { day: "numeric", month: "short" },
                  )}
                </text>
              )}
              {(hover === i || length === 7) && (
                <circle
                  cx={x}
                  cy={y}
                  r={hover === i ? 4.5 : 3.2}
                  fill="white"
                  stroke="#437964"
                  strokeWidth="1.8"
                />
              )}
              <rect
                x={x - (right - left) / (length - 1) / 2}
                y={0}
                width={(right - left) / (length - 1)}
                height={bottom + 7}
                fill="transparent"
                onMouseEnter={() => H(i)}
                onTouchStart={() => H(i)}
              >
                <title>
                  {day(rows[i].date)}: sales {rupee(rows[i].sales)}, collections{" "}
                  {rupee(rows[i].paid)}
                </title>
              </rect>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
export function InvoiceTable({ rows }: { rows: Invoice[] }) {
  const nav = useNavigate();
  return rows.length ? (
    <div className="table-scroll">
      <table className="invoices-table">
        <thead>
          <tr>
            <th>Invoice no.</th>
            <th>Customer</th>
            <th>Date</th>
            <th className="right">Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((i, n) => (
            <tr
              className="clickable"
              key={i.id}
              tabIndex={0}
              onClick={() => nav("/billing/" + i.id)}
              onKeyDown={(e) => e.key === "Enter" && nav("/billing/" + i.id)}
            >
              <td className="invoice-num">{i.number}</td>
              <td>
                <div className="person">
                  <Avatar name={i.customer?.name ?? "Walk-in"} index={n} />
                  <span>{i.customer?.name ?? "Walk-in customer"}</span>
                </div>
              </td>
              <td className="muted">
                {day(i.issuedAt, { day: "numeric", month: "short" })}
              </td>
              <td className="right money">{rupee(i.totalPaise)}</td>
              <td>
                <Status text={paymentStatus(i)} />
              </td>
              <td>
                <ChevronRight size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="No invoices yet"
      text="Your finalized invoices will appear here."
    />
  );
}
export default function Dashboard() {
  const { data } = useShop(),
    [period, P] = useState(1),
    [backupDue, setBackupDue] = useState(false);
  // Daily-on-open backup check (MediSmart behaviour): remind once a day
  // when no backup was made today. Not an exact 02:00 run — that needs
  // a native Android WorkManager scheduler, which is not built yet.
  useEffect(() => {
    try {
      if (
        loadBackupPreferences().autoReminder &&
        runDailyCheck(loadLastBackupAt())
      )
        setBackupDue(true);
    } catch {
      // Reminder is best-effort; a storage failure must not break Dashboard.
    }
  }, []);
  const hi = data.profile.language === "hi";
  // Automatic daily SMS reminders (10:00 AM): hand today's due list
  // to the native scheduler on every app open, so the payload stays
  // fresh — a payment can only be recorded by opening the app, which
  // refreshes the payload, so a paid record is never messaged twice.
  // Best-effort: prepareAutoSms never throws and never asks for any
  // permission (the SMS permission is only asked from the Settings
  // toggle). The in-app due list below is the fallback.
  useEffect(() => {
    void prepareAutoSms(data);
  }, [data]);
  // Daily-on-open girvi / EMI check (same pattern as the backup
  // reminder above): every morning the shopkeeper sees which records
  // are due today or overdue, with the balance still owed. When
  // automatic SMS is ON in Settings, the same list is also handed to
  // the native scheduler above, which sends it by SMS at 10:00 AM —
  // the reminder list here and on the Girvi & EMI page is the fallback.
  const due = useMemo(() => dueLoans(data.loans ?? []), [data.loans]),
    dueBalance = due.reduce((n, l) => n + loanSummary(l).balancePaise, 0),
    overdueCount = due.filter((l) => loanState(l) === "overdue").length;
  const rows = series(data, period),
    sales = rows.reduce((s, r) => s + r.sales, 0),
    paid = rows.reduce((s, r) => s + r.paid, 0),
    count = rows.reduce((s, r) => s + r.count, 0);
  const invoices = saleInvoices(data);
  const accounts = new Map<string, number>();
  for (const b of accountDocuments(data))
    if (b.customer)
      accounts.set(
        b.customer.id,
        (accounts.get(b.customer.id) ?? 0) + accountDelta(b),
      );
  const outstanding = [...accounts.values()].reduce(
      (s, n) => s + Math.max(n, 0),
      0,
    ),
    dueCount = [...accounts.values()].filter((n) => n > 0).length,
    stock = data.products.reduce((s, p) => s + p.stock, 0);
  const rates = currentRates(data.rates)
    .sort((a, b) => {
      const rank = (r: typeof a) =>
        r.metal === "Gold" && r.purity === "22K"
          ? 0
          : r.metal === "Gold" && r.purity === "24K"
            ? 1
            : r.metal === "Silver"
              ? 2
              : 3;
      return rank(a) - rank(b) || b.rate - a.rate;
    })
    .slice(0, 3);
  const prev = series(data, period, period).reduce((s, r) => s + r.sales, 0),
    change = delta(sales, prev);
  const metrics = [
    {
      label: period === 1 ? "Today's sales" : "Period sales",
      value: rupee(sales),
      icon: IndianRupee,
      color: "mint",
      note: `${count} invoices`,
      hint: "Sales",
      up: change,
    },
    {
      label: period === 1 ? "Today's collections" : "Collections",
      value: rupee(paid),
      icon: Wallet,
      color: "sand",
      note: "Payments received",
      hint: "Collections",
      up: null,
    },
    {
      label: "Customer dues",
      value: rupee(outstanding),
      icon: Hourglass,
      color: "peach",
      note: `${dueCount} accounts with dues`,
      hint: "Dues",
      up: null,
    },
    {
      label: "Stock on hand",
      value: stock.toLocaleString("en-IN"),
      unit: "pcs",
      icon: Boxes,
      color: "lavender",
      note: `Across ${data.products.length} products`,
      hint: "Stock",
      up: null,
    },
  ];
  return (
    <div className="dashboard">
      {backupDue && (
        <section className="panel">
          <div className="info-box">
            <Clock3 size={20} />
            <p>
              Today’s backup hasn’t been made yet.{" "}
              <Link to="/settings">Back up now in Settings</Link> — one tap
              saves it to the AurumBackup folder on this phone and to your
              connected Google Drive folder, so your data survives a lost
              phone. Connect a Drive folder once in Settings → Backup
              &amp; restore.
            </p>
          </div>
        </section>
      )}
      {due.length > 0 && (
        <section className="panel">
          <div className="info-box">
            <Hourglass size={20} />
            <p>
              {due.length} girvi / EMI record{due.length > 1 ? "s are" : " is"}{" "}
              due today or overdue
              {overdueCount > 0 ? ` (${overdueCount} overdue)` : ""} —{" "}
              {rupee(dueBalance, 2)} balance due.{" "}
              <Link to="/loans">Open Girvi &amp; EMI</Link> to send the
              WhatsApp reminder.
            </p>
          </div>
        </section>
      )}
      <section className="hero">
        <div className="hero-photo" />
        <div className="hero-weave" />
        <div className="hero-content">
          <div className="hero-kicker">
            <span />
            WORKSPACE OVERVIEW
          </div>
          <h1>
            {hi ? "स्वागत है," : "Welcome back,"}{" "}
            {data.profile.ownerName.split(" ")[0]}
            <em>.</em>
          </h1>
          <p>
            {hi
              ? "आपकी दुकान के कारोबार का आज का सारांश।"
              : `Here’s what’s happening at ${data.profile.shopName} today.`}
          </p>
          <div className="hero-actions">
            <Link to="/billing/new" className="btn gold">
              <Plus size={16} />
              {hi ? "नया इनवॉइस" : "New invoice"}
            </Link>
            <Link to="/reports" className="hero-link">
              {hi ? "रिपोर्ट देखें" : "View reports"}
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        <div className="hero-date">
          <CalendarDays size={12} />
          {day(Date.now(), { day: "2-digit", month: "short", year: "numeric" })}
        </div>
      </section>
      <section className="overview">
        <div className="overview-title">
          <h2>{hi ? "कारोबार का सारांश" : "Business overview"}</h2>
          <label className="range-select">
            <CalendarDays size={14} />
            <Select
              value={period}
              aria-label="Overview reporting period"
              onChange={(e) => P(+e.target.value)}
            >
              <option value={1}>Today</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
            </Select>
          </label>
        </div>
        <div className="metric-grid">
          {metrics.map((m, i) => (
            <Link
              to={["/billing", "/reports", "/customers", "/inventory"][i]}
              className={"metric metric-" + m.color}
              key={m.hint}
            >
              <div className="metric-label">
                <span className={"metric-icon " + m.color}>
                  <Icon as={m.icon} size={17} />
                </span>
                <span>{m.label}</span>
              </div>
              <div className="metric-value">
                {m.value}
                {m.unit && <small>{m.unit}</small>}
              </div>
              <div className="metric-bottom">
                {i === 0 && m.up !== null ? (
                  <span className={"trend " + (m.up >= 0 ? "up" : "down")}>
                    {m.up >= 0 ? (
                      <TrendingUp size={12} />
                    ) : (
                      <TrendingDown size={12} />
                    )}{" "}
                    {Math.abs(m.up).toFixed(1)}%
                  </span>
                ) : (
                  <i className={"tiny-dot " + m.color} />
                )}
                <span>
                  {i === 0 && m.up !== null
                    ? period === 1
                      ? "vs yesterday"
                      : "vs prior period"
                    : m.note}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="analytics-grid">
        <SalesChart data={data} />
        <section className="panel rate-card">
          <div className="panel-title">
            <div>
              <div className="section-kicker gold-text">
                <i />
                RATE DESK
              </div>
              <h2>Metal rates</h2>
            </div>
            <span className="current-badge">
              <i />
              Current
            </span>
          </div>
          <div className="rate-lines">
            {rates.map((r) => {
              const prior = priorRate(r, data.rates),
                diff = prior ? r.rate - prior.rate : 0;
              return (
                <div className="rate-line" key={r.id}>
                  <span
                    className={
                      "metal-tile " + (r.metal === "Silver" ? "silver" : "")
                    }
                  >
                    <Ingots silver={r.metal === "Silver"} />
                  </span>
                  <div className="rate-name">
                    <strong>
                      {r.metal} <span>· {r.purity}</span>
                    </strong>
                    <small>Per gram</small>
                  </div>
                  <div className="rate-value">
                    <strong>{cash(r.rate, r.rate % 1 ? 2 : 0)}</strong>
                    <small className={diff < 0 ? "down" : "up"}>
                      {diff < 0 ? (
                        <TrendingDown size={12} />
                      ) : (
                        <TrendingUp size={12} />
                      )}{" "}
                      {prior
                        ? `${diff >= 0 ? "+" : "−"}${cash(Math.abs(diff), diff % 1 ? 2 : 0)}`
                        : "First rate"}
                    </small>
                  </div>
                </div>
              );
            })}
            {!rates.length && (
              <Empty
                title="No metal rates"
                text="Add your shop’s first effective rate."
              />
            )}
          </div>
          <Link to="/rates" className="rate-footer">
            Manage metal rates
            <ArrowRight size={14} />
          </Link>
        </section>
      </div>
      <section className="panel recent">
        <div className="panel-title">
          <div>
            <div className="section-kicker">
              <i />
              BILLING ACTIVITY
            </div>
            <h2>Recent invoices</h2>
          </div>
          <Link className="text-link" to="/billing">
            View all invoices
            <ArrowRight size={14} />
          </Link>
        </div>
        <InvoiceTable
          rows={[...data.invoices]
            .filter((b) => b.type !== "Estimate")
            .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
            .slice(0, 5)}
        />
      </section>
    </div>
  );
}
