import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Save,
  Plus,
  Trash2,
  Store,
  Upload,
  ReceiptText,
  ShieldCheck,
  Download,
  BarChart3,
  ArrowUpRight,
  Check,
  CreditCard,
  SlidersHorizontal,
  Image as ImageIcon,
  ArrowRight,
} from "lucide-react";
import { useShop, useToast } from "../lib/store";
import { rupee, cash, err, day } from "../lib/format";
import { profileSchema, type Profile } from "../../functions/src/core/model";
import { indiaDay, saleInvoices } from "../../functions/src/core/billing";
import {
  PageHead,
  Field,
  Problem,
  Select,
  Records,
  Empty,
  GemMark,
} from "../components/ui";
import { markSaved } from "../lib/navigation";
import {
  accountDocuments,
  allocations,
} from "../../functions/src/core/documents";
import { InvoiceTable } from "./Dashboard";
function downloadCsv(rows: (string | number)[][]) {
  const cell = (v: string | number) =>
    '"' +
    String(
      typeof v === "string" && /^[=+@\-\t\r]/.test(v) ? "'" + v : v,
    ).replaceAll('"', '""') +
    '"';
  const blob = new Blob(
    ["\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8;" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sales-${indiaDay(Date.now())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export function Reports() {
  const { data, demo } = useShop(),
    [days, D] = useState(30),
    [tab, T] = useState("Metal-wise sales");
  const bills = saleInvoices(data).filter(
    (b) => indiaDay(b.issuedAt) >= indiaDay(Date.now() - (days - 1) * 86400000),
  );
  const receipts = accountDocuments(data).filter(
    (b) => indiaDay(b.issuedAt) >= indiaDay(Date.now() - (days - 1) * 86400000),
  );
  const total = bills.reduce((s, b) => s + b.totalPaise, 0),
    net = bills.reduce((s, b) => s + b.subtotalPaise, 0),
    cost = bills.reduce(
      (s, b) => s + b.lines.reduce((a, l) => a + l.costPaise, 0),
      0,
    ),
    paid = receipts.reduce((s, b) => s + b.paidPaise, 0);
  const metals = new Map<
    string,
    { id: string; pieces: number; net: number; sales: number }
  >();
  bills.forEach((b) =>
    b.lines.forEach((l) => {
      const row = metals.get(l.metal) ?? {
        id: l.metal,
        pieces: 0,
        net: 0,
        sales: 0,
      };
      row.pieces += l.quantity;
      row.net += l.net;
      row.sales += l.taxablePaise;
      metals.set(l.metal, row);
    }),
  );
  const modes = ["Cash", "UPI", "Bank", "Card", "Other"].map((m) => ({
    id: m,
    amount: receipts
      .flatMap((b) => allocations(b.input))
      .filter((t) => t.mode === m)
      .reduce((s, t) => s + t.amountPaise, 0),
  }));
  return (
    <>
      <PageHead
        eyebrow="BUSINESS INTELLIGENCE"
        title="Reports"
        subtitle="Sales and collections from posted, non-void invoices."
      >
        <Select
          aria-label="Report period"
          value={days}
          onChange={(e) => D(+e.target.value)}
        >
          <option value="1">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="365">Last 365 days</option>
        </Select>
        <button
          className="btn primary"
          onClick={() =>
            downloadCsv([
              [
                demo ? "SAMPLE WORKSPACE" : "Sales report",
                data.profile.shopName,
              ],
              [
                "Invoice",
                "Date",
                "Customer",
                "Net sales INR",
                "GST INR",
                "Total INR",
                "Paid INR",
                "Balance INR",
                "Payment mode",
              ],
              ...bills.map((b) => [
                b.number,
                b.issuedAt,
                b.customer?.name ?? "Walk-in",
                b.subtotalPaise / 100,
                b.taxPaise / 100,
                b.totalPaise / 100,
                b.paidPaise / 100,
                b.balancePaise / 100,
                allocations(b.input)
                  .map((t) => `${t.mode}: ${t.amountPaise / 100}`)
                  .join("; "),
              ]),
            ])
          }
        >
          <Download size={16} />
          Export CSV
        </button>
      </PageHead>
      <div className="stat-strip">
        <div>
          <small>Gross bill value</small>
          <strong>{rupee(total)}</strong>
        </div>
        <div>
          <small>Collections</small>
          <strong>{rupee(paid)}</strong>
        </div>
        <div>
          <small>Cost of goods sold</small>
          <strong>{rupee(cost)}</strong>
        </div>
        <div>
          <small>Gross profit</small>
          <strong>{rupee(net - cost)}</strong>
        </div>
      </div>
      <div className="info-box subtle">
        <BarChart3 size={20} />
        <p>
          Gross profit is net sales before tax minus recorded item costs.
          Operating expenses are not included.
        </p>
      </div>
      <div className="tabs">
        {["Metal-wise sales", "Payment distribution"].map((t) => (
          <button
            key={t}
            onClick={() => T(t)}
            className={t === tab ? "on" : ""}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Metal-wise sales" ? (
        <Records
          items={[...metals.values()]}
          search={(r) => r.id}
          placeholder="Search metal…"
          columns={[
            {
              label: "Metal",
              value: (r) => <strong>{r.id}</strong>,
              sort: (r) => r.id,
            },
            {
              label: "Pieces sold",
              value: (r) => r.pieces,
              sort: (r) => r.pieces,
            },
            {
              label: "Net weight",
              value: (r) => r.net.toFixed(3) + " g",
              sort: (r) => r.net,
            },
            {
              label: "Net sales",
              value: (r) => rupee(r.sales, 2),
              sort: (r) => r.sales,
              align: "right",
            },
          ]}
        />
      ) : (
        <section className="panel payment-chart">
          <h2>Collections by payment mode</h2>
          {modes.map((m, i) => (
            <div className="pay-bar" key={m.id}>
              <span>{m.id}</span>
              <div>
                <i
                  style={{
                    width: `${paid ? (100 * m.amount) / paid : 0}%`,
                    background: [
                      "#396151",
                      "#bb9c58",
                      "#889b88",
                      "#98a7b4",
                      "#ccc6ba",
                    ][i],
                  }}
                />
              </div>
              <strong>{rupee(m.amount)}</strong>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
async function readLogo(file: File): Promise<string> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 4 * 1024 * 1024
  )
    throw Error("Choose a PNG, JPEG or WebP smaller than 4 MB.");
  const image = await createImageBitmap(file);
  const c = document.createElement("canvas"),
    scale = Math.min(1, 220 / Math.max(image.width, image.height));
  c.width = Math.max(1, Math.round(image.width * scale));
  c.height = Math.max(1, Math.round(image.height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw Error("Image processing unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(image, 0, 0, c.width, c.height);
  image.close();
  return c.toDataURL("image/jpeg", 0.86);
}
export function Settings() {
  const { data, perform, demo, license } = useShop(),
    notify = useToast(),
    [params, P] = useSearchParams();
  const setup = params.has("setup") && !data.profile.setupComplete;
  const [p, F] = useState<Profile>(() => structuredClone(data.profile)),
    [tab, T] = useState("Shop profile"),
    [busy, B] = useState(false),
    [error, E] = useState("");
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => {
    E("");
    F((p) => ({ ...p, [k]: v }));
  };
  const tabs = ["Shop profile", "Billing & print", "Tax settings"];
  const save = async () => {
    B(true);
    E("");
    try {
      const parsed = profileSchema.parse({ ...p, setupComplete: true });
      if (
        new Set(parsed.taxes.map((t) => t.hsn + "-" + t.effective)).size !==
        parsed.taxes.length
      )
        throw Error("Each HSN can have only one rule per effective date.");
      await perform("profile", parsed);
      markSaved(document.querySelector(".settings-panel"));
      F(parsed);
      notify("Shop settings saved.");
      if (setup) P({}, { replace: true });
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow={setup ? "WELCOME TO YOUR WORKSPACE" : "CONFIGURATION"}
        title={setup ? "Set up your shop" : "Shop settings"}
        subtitle="Your identity, invoice preferences and effective tax configuration."
      />
      <div className="tabs">
        {tabs.map((t, i) => (
          <button
            key={t}
            className={t === tab ? "on" : ""}
            onClick={() => T(t)}
          >
            {setup ? `${i + 1}. ` : ""}
            {t}
          </button>
        ))}
      </div>
      <form
        className="panel settings-panel"
        data-unsaved={JSON.stringify(p) !== JSON.stringify(data.profile)}
        data-saving={busy}
        onSubmit={async (e) => {
          e.preventDefault();
          if (setup && tab !== "Tax settings") {
            T(tabs[tabs.indexOf(tab) + 1]);
            return;
          }
          await save();
        }}
      >
        <div className="section-kicker">
          <i />
          SHOP CONFIGURATION
        </div>
        <h2>{tab}</h2>
        {tab === "Shop profile" ? (
          <>
            <div className="logo-field">
              <span className="logo-preview">
                {p.logo ? (
                  <img src={p.logo} alt="Shop logo" />
                ) : (
                  <Store size={25} />
                )}
              </span>
              <div>
                <strong>Shop logo</strong>
                <p>Used on your workspace and new invoices.</p>
                <label className="text-link upload-label">
                  <Upload size={13} />
                  Upload logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      if (e.target.files?.[0])
                        try {
                          set("logo", await readLogo(e.target.files[0]));
                        } catch (e) {
                          E(err(e));
                        }
                    }}
                  />
                </label>
                {p.logo && (
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => set("logo", "")}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div className="form-grid">
              {(
                [
                  ["shopName", "Shop name"],
                  ["ownerName", "Owner name"],
                  ["mobile", "Contact number"],
                  ["email", "Business email"],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l}>
                  <input
                    required={["shopName", "ownerName"].includes(k)}
                    value={p[k]}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </Field>
              ))}
              <Field label="Address (include state & PIN code)" full>
                <textarea
                  rows={2}
                  value={p.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </Field>
              <Field
                label="Navigation language"
                hint="Form and invoice labels currently use English."
              >
                <Select
                  value={p.language}
                  onChange={(e) =>
                    set("language", e.target.value as "en" | "hi")
                  }
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                </Select>
              </Field>
              <Field label="Accounting currency">
                <input value="Indian Rupee (INR)" readOnly />
              </Field>
            </div>
          </>
        ) : tab === "Billing & print" ? (
          <div className="form-grid">
            <Field
              label="Invoice prefix"
              hint="Numbering is assigned at finalization."
            >
              <input
                value={p.prefix}
                pattern="[A-Z0-9\-]{1,12}"
                required
                onChange={(e) => set("prefix", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Paper format">
              <Select
                value={p.format}
                onChange={(e) =>
                  set("format", e.target.value as Profile["format"])
                }
              >
                {["A4", "A5", "80mm", "58mm"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            </Field>
            <label className="check-line full">
              <input
                type="checkbox"
                checked={!!p.showOwner}
                onChange={(e) => set("showOwner", e.target.checked)}
              />
              Print owner name
            </label>
            {(
              [
                ["invoiceFooter", "Thank-you message", 240],
                ["exchangePolicy", "Return / exchange policy", 600],
                ["invoiceTerms", "Invoice terms", 1000],
              ] as const
            ).map(([key, label, max]) => (
              <Field key={key} label={label} full>
                <textarea
                  rows={2}
                  maxLength={max}
                  value={
                    p[key] ??
                    (key === "invoiceFooter"
                      ? "Thank you for your business."
                      : "")
                  }
                  onChange={(e) => set(key, e.target.value)}
                />
              </Field>
            ))}
            <label className="check-line full">
              <input
                type="checkbox"
                checked={p.roundOff}
                onChange={(e) => set("roundOff", e.target.checked)}
              />
              Round grand total to nearest rupee
            </label>
            <div className="info-box full">
              <ReceiptText />
              <p>
                New invoices use these preferences. Already-issued bills retain
                their original branding, tax and rate snapshots.
              </p>
            </div>
          </div>
        ) : (
          <>
            <label className="check-line">
              <input
                type="checkbox"
                checked={p.gstRegistered}
                onChange={(e) => set("gstRegistered", e.target.checked)}
              />
              GST-registered business
            </label>
            {p.gstRegistered && (
              <Field label="GSTIN">
                <input
                  value={p.gstin}
                  required
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                />
              </Field>
            )}
            <h3 className="spaced">Effective tax rules</h3>
            <p className="muted">
              Configure rates for your product HSN codes with your tax adviser.
              No statutory rate is assumed.
            </p>
            {p.taxes.map((r, i) => (
              <div className="tax-rule" key={i}>
                {(["hsn", "effective", "percent"] as const).map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "hsn"
                        ? "HSN"
                        : k === "effective"
                          ? "Effective date"
                          : "GST %"
                    }
                  >
                    <input
                      required
                      type={
                        k === "effective"
                          ? "date"
                          : k === "percent"
                            ? "number"
                            : "text"
                      }
                      step={k === "percent" ? 0.01 : undefined}
                      value={r[k]}
                      onChange={(e) =>
                        set(
                          "taxes",
                          p.taxes.map((v, j) =>
                            j === i
                              ? {
                                  ...v,
                                  [k]:
                                    k === "percent"
                                      ? +e.target.value
                                      : e.target.value,
                                }
                              : v,
                          ),
                        )
                      }
                    />
                  </Field>
                ))}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove tax rule"
                  onClick={() =>
                    set(
                      "taxes",
                      p.taxes.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn outline"
              onClick={() =>
                set("taxes", [
                  ...p.taxes,
                  { hsn: "", effective: indiaDay(Date.now()), percent: 0 },
                ])
              }
            >
              <Plus size={14} />
              Add tax rule
            </button>
          </>
        )}
        <Problem message={error} />
        <div className="settings-actions">
          <span>
            {demo
              ? "Sample profile · Changes reset on reload."
              : "Changes apply only to your shop."}
          </span>
          <button className="btn primary" disabled={busy}>
            {setup && tab !== "Tax settings" ? (
              <ArrowRight size={15} />
            ) : (
              <Save size={15} />
            )}{" "}
            {busy
              ? "Saving…"
              : setup && tab !== "Tax settings"
                ? "Continue"
                : setup
                  ? "Finish setup"
                  : "Save settings"}
          </button>
        </div>
      </form>
    </>
  );
}
