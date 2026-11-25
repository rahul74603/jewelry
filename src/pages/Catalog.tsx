import {
  accountDocuments,
  isSale,
  accountDelta,
} from "../../functions/src/core/documents";
import { useClosePanel, markSaved } from "../lib/navigation";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Plus,
  Package,
  Boxes,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Layers3,
  Scale,
  IndianRupee,
  UserPlus,
  ArrowRight,
  Coins,
  FileText,
} from "lucide-react";
import {
  productSchema,
  customerSchema,
  rateSchema,
  type Product,
  type Customer,
} from "../../functions/src/core/model";
import {
  currentRates,
  saleInvoices,
  paymentStatus,
} from "../../functions/src/core/billing";
import {
  METALS,
  OTHER_OPTION,
  PRODUCT_CATEGORIES,
  puritiesFor,
} from "../lib/catalog";
import { useShop, useToast } from "../lib/store";
import {
  cash,
  rupee,
  err,
  key,
  day,
  priorRate,
  utcLocalInput,
} from "../lib/format";
import {
  Avatar,
  Empty,
  Field,
  Ingots,
  Modal,
  PageHead,
  Problem,
  Records,
  Select,
  Status,
} from "../components/ui";
function validation(errors: Record<string, any>) {
  return Object.entries(errors)
    .map(([k, v]) => `${k}: ${v.message ?? "Invalid value"}`)
    .join("; ");
}
function ProductForm({ close }: { close: () => void }) {
  const { data, perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    // Text typed when "Other" is picked in a dropdown.
    [catOther, setCatOther] = useState(""),
    [metalOther, setMetalOther] = useState(""),
    [purityOther, setPurityOther] = useState("");
  const sample =
    currentRates(data.rates).find((r) => r.metal === "Gold") ??
    currentRates(data.rates)[0];
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Product>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      id: key(),
      name: "",
      sku: "",
      category: "Rings",
      metal: sample?.metal ?? "Gold",
      purity: sample?.purity ?? "22K",
      gross: 1,
      stone: 0,
      deduction: 0,
      stock: 1,
      cost: 0,
      makingMode: "Fixed",
      making: 0,
      hsn: "",
      huid: "",
    },
  });
  const metalVal = watch("metal"),
    categoryVal = watch("category"),
    purityVal = watch("purity");
  // Purity options follow the chosen metal; a custom metal has no list,
  // so purity becomes a free text field in that case.
  const purityOptions =
    metalVal === OTHER_OPTION ? [] : puritiesFor(metalVal);
  return (
    <form
      data-unsaved={isDirty}
      data-saving={isSubmitting}
      onSubmit={handleSubmit(async (v) => {
        try {
          if (v.category === OTHER_OPTION) {
            if (!catOther.trim()) {
              E("Type the custom category.");
              return;
            }
            v.category = catOther.trim();
          }
          if (v.metal === OTHER_OPTION) {
            if (!metalOther.trim()) {
              E("Type the custom metal.");
              return;
            }
            v.metal = metalOther.trim();
          }
          if (v.purity === OTHER_OPTION) {
            if (!purityOther.trim()) {
              E("Type the custom purity.");
              return;
            }
            v.purity = purityOther.trim();
          }
          await perform("product", v);
          notify("Product added to inventory.");
          markSaved(document.querySelector("[role=dialog]"));
          close();
        } catch (e) {
          E(err(e));
        }
      })}
    >
      <div className="form-grid">
        {(
          [
            ["name", "Product name"],
            ["sku", "SKU / barcode"],
          ] as const
        ).map(([k, t]) => (
          <Field key={k} label={t}>
            <input {...register(k)} />
          </Field>
        ))}
        <Field label="Category">
          <Select {...register("category")}>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
            <option>{OTHER_OPTION}</option>
          </Select>
        </Field>
        {categoryVal === OTHER_OPTION && (
          <Field label="Custom category">
            <input
              value={catOther}
              onChange={(e) => setCatOther(e.target.value)}
              placeholder="e.g. Kamarbandh"
            />
          </Field>
        )}
        <Field label="Metal">
          <Select
            {...register("metal", {
              onChange: (e) => {
                const m = e.target.value;
                if (m !== OTHER_OPTION)
                  setValue("purity", puritiesFor(m)[0] ?? OTHER_OPTION);
              },
            })}
          >
            {METALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
            <option>{OTHER_OPTION}</option>
          </Select>
        </Field>
        {metalVal === OTHER_OPTION && (
          <Field label="Custom metal">
            <input
              value={metalOther}
              onChange={(e) => setMetalOther(e.target.value)}
              placeholder="e.g. Copper"
            />
          </Field>
        )}
        {purityOptions.length ? (
          <Field label="Purity">
            <Select {...register("purity")}>
              {purityOptions.map((p) => (
                <option key={p}>{p}</option>
              ))}
              <option>{OTHER_OPTION}</option>
            </Select>
          </Field>
        ) : (
          <Field label="Purity">
            <input {...register("purity")} placeholder="e.g. 22K" />
          </Field>
        )}
        {purityVal === OTHER_OPTION && purityOptions.length > 0 && (
          <Field label="Custom purity">
            <input
              value={purityOther}
              onChange={(e) => setPurityOther(e.target.value)}
              placeholder="e.g. 21K"
            />
          </Field>
        )}
        <Field label="HUID (if applicable)">
          <input {...register("huid")} />
        </Field>
        {(
          [
            ["gross", "Gross weight / piece (g)", 0.001],
            ["stone", "Stone weight (g)", 0.001],
            ["deduction", "Other deduction (g)", 0.001],
            ["stock", "Opening pieces", 1],
            ["cost", "Unit purchase cost (₹)", 0.01],
            ["making", "Default making amount / rate", 0.01],
          ] as const
        ).map(([k, t, step]) => (
          <Field key={k} label={t}>
            <input
              type="number"
              min="0"
              step={step}
              {...register(k, { valueAsNumber: true })}
            />
          </Field>
        ))}
        <Field label="Making calculation">
          <select {...register("makingMode")}>
            <option>Fixed</option>
            <option>Per gram</option>
            <option>Percentage</option>
          </select>
        </Field>
        <Field label="HSN code">
          <input {...register("hsn")} />
        </Field>
      </div>
      <Problem message={error || validation(errors)} />
      <div className="modal-actions">
        <button type="button" className="btn outline" onClick={close}>
          Cancel
        </button>
        <button className="btn primary" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Add product"}
        </button>
      </div>
    </form>
  );
}
function ProductDetail({ product: p }: { product: Product }) {
  const { perform } = useShop(),
    notify = useToast(),
    [adj, A] = useState(false),
    [qty, Q] = useState(1),
    [reason, R] = useState(""),
    [e, E] = useState(""),
    [busy, B] = useState(false);
  return (
    <>
      <div className="identity-row">
        <span className="record-symbol">
          <Package />
        </span>
        <div>
          <h3>{p.name}</h3>
          <p>
            {p.sku} · {p.category}
          </p>
        </div>
      </div>
      <dl className="details">
        {[
          ["Metal & purity", `${p.metal} · ${p.purity}`],
          [
            "Gross / net weight",
            `${p.gross} g / ${(p.gross - p.stone - p.deduction).toFixed(3)} g`,
          ],
          ["Stock available", `${p.stock} pieces`],
          ["Unit purchase cost", cash(p.cost, 2)],
          ["Default making", `${p.makingMode} · ${p.making}`],
          ["HSN / recorded HUID", `${p.hsn || "—"} / ${p.huid || "—"}`],
        ].map(([t, v]) => (
          <div key={t}>
            <dt>{t}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {p.huid && (
        <p className="footnote">
          Shop-entered HUID; not an official hallmark verification.
        </p>
      )}
      {!adj ? (
        <button className="btn outline" onClick={() => A(true)}>
          <Boxes size={15} />
          Adjust stock
        </button>
      ) : (
        <form
          data-saving={busy}
          onSubmit={async (ev) => {
            ev.preventDefault();
            B(true);
            try {
              await perform("adjust", {
                id: key(),
                productId: p.id,
                delta: qty,
                reason,
              });
              notify("Stock adjustment recorded.");
              A(false);
            } catch (e) {
              E(err(e));
            } finally {
              B(false);
            }
          }}
        >
          <div className="form-grid">
            <Field
              label="Quantity change"
              hint="Use a negative number to remove pieces."
            >
              <input
                type="number"
                step="1"
                required
                value={qty}
                onChange={(e) => Q(+e.target.value)}
              />
            </Field>
            <Field label="Reason">
              <input
                required
                maxLength={200}
                value={reason}
                onChange={(e) => R(e.target.value)}
              />
            </Field>
          </div>
          <Problem message={e} />
          <div className="modal-actions">
            <button className="btn primary" disabled={busy}>
              Record adjustment
            </button>
          </div>
        </form>
      )}
    </>
  );
}
export function Inventory() {
  const closePanel = useClosePanel();
  const { data } = useShop(),
    [params, P] = useSearchParams(),
    [metal, M] = useState("All metals");
  const chosen = data.products.find((p) => p.id === params.get("item")),
    weight = data.products.reduce(
      (s, p) => s + (p.gross - p.stone - p.deduction) * p.stock,
      0,
    );
  return (
    <>
      <PageHead
        eyebrow="STOCK ROOM"
        title="Inventory"
        subtitle="Your jewellery catalogue, piece counts and stock valuation."
      >
        <button className="btn primary" onClick={() => P({ new: "1" })}>
          <Plus size={16} />
          Add product
        </button>
      </PageHead>
      <div className="stat-strip">
        <div>
          <small>Product lines</small>
          <strong>{data.products.length}</strong>
        </div>
        <div>
          <small>Total pieces</small>
          <strong>{data.products.reduce((s, p) => s + p.stock, 0)}</strong>
        </div>
        <div>
          <small>Net stock weight</small>
          <strong>
            {weight.toLocaleString("en-IN", { maximumFractionDigits: 3 })}{" "}
            <em>g</em>
          </strong>
        </div>
        <div>
          <small>Stock at cost</small>
          <strong>
            {cash(data.products.reduce((s, p) => s + p.stock * p.cost, 0))}
          </strong>
        </div>
      </div>
      <Records
        items={data.products.filter(
          (p) => metal === "All metals" || p.metal === metal,
        )}
        search={(p) => p.name + p.sku + p.category + p.purity}
        placeholder="Search products, SKU or purity…"
        filters={
          <Select
            aria-label="Filter by metal"
            value={metal}
            onChange={(e) => M(e.target.value)}
          >
            {["All metals", ...new Set(data.products.map((p) => p.metal))].map(
              (m) => (
                <option key={m}>{m}</option>
              ),
            )}
          </Select>
        }
        columns={[
          {
            label: "Product",
            value: (p) => (
              <div className="person">
                <span
                  className={
                    "product-glyph " + (p.metal === "Silver" ? "silver" : "")
                  }
                >
                  <Package size={17} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.sku}</small>
                </span>
              </div>
            ),
            sort: (p) => p.name,
          },
          {
            label: "Category",
            value: (p) => p.category,
            sort: (p) => p.category,
          },
          { label: "Metal / purity", value: (p) => p.metal + " · " + p.purity },
          {
            label: "Net wt.",
            value: (p) => (p.gross - p.stone - p.deduction).toFixed(3) + " g",
            sort: (p) => p.gross - p.stone - p.deduction,
          },
          {
            label: "Pieces",
            value: (p) => (
              <span className={"stock-tag " + (p.stock < 5 ? "low" : "")}>
                {p.stock} pcs
              </span>
            ),
            sort: (p) => p.stock,
          },
          {
            label: "Unit cost",
            value: (p) => cash(p.cost),
            sort: (p) => p.cost,
            align: "right",
          },
        ]}
        action={(p) => P({ item: p.id })}
      />
      <Modal
        open={params.has("new")}
        title="Add a product"
        description="Weights and costs are per piece. Opening stock is recorded separately."
        routePanel
        onClose={closePanel}
        wide
      >
        <ProductForm close={closePanel} />
      </Modal>
      <Modal
        open={!!chosen}
        title="Product details"
        routePanel
        onClose={closePanel}
      >
        {chosen && <ProductDetail product={chosen} />}
      </Modal>
    </>
  );
}
function CustomerForm({ close }: { close: () => void }) {
  const { perform } = useShop(),
    notify = useToast(),
    [error, E] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Customer>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      id: key(),
      name: "",
      phone: "",
      email: "",
      address: "",
      gstin: "",
    },
  });
  return (
    <form
      data-unsaved={isDirty}
      data-saving={isSubmitting}
      onSubmit={handleSubmit(async (v) => {
        try {
          await perform("customer", v);
          notify("Customer added.");
          markSaved(document.querySelector("[role=dialog]"));
          close();
        } catch (e) {
          E(err(e));
        }
      })}
    >
      <div className="form-grid">
        {(
          [
            ["name", "Customer name"],
            ["phone", "Mobile number"],
            ["email", "Email (optional)"],
            ["gstin", "GSTIN (optional)"],
          ] as const
        ).map(([k, t]) => (
          <Field key={k} label={t}>
            <input {...register(k)} />
          </Field>
        ))}
        <Field label="Address" full>
          <textarea {...register("address")} rows={2} />
        </Field>
      </div>
      <Problem message={error || validation(errors)} />
      <div className="modal-actions">
        <button disabled={isSubmitting} className="btn primary">
          {isSubmitting ? "Saving…" : "Add customer"}
        </button>
      </div>
    </form>
  );
}
export function Customers() {
  const closePanel = useClosePanel();
  const { data } = useShop(),
    [params, P] = useSearchParams();
  const selected = data.customers.find((c) => c.id === params.get("item")),
    bills = accountDocuments(data);
  const totals = (id: string) =>
    bills
      .filter((b) => b.customer?.id === id)
      .reduce(
        (s, b) => ({
          sales: s.sales + (isSale(b) ? b.totalPaise : 0),
          paid: s.paid + b.paidPaise,
          due: s.due + accountDelta(b),
        }),
        { sales: 0, paid: 0, due: 0 },
      );
  return (
    <>
      <PageHead
        eyebrow="RELATIONSHIPS"
        title="Customers"
        subtitle="Customer profiles, purchase history and outstanding balances."
      >
        <button className="btn primary" onClick={() => P({ new: "1" })}>
          <UserPlus size={16} />
          Add customer
        </button>
      </PageHead>
      <Records
        items={data.customers}
        search={(c) => c.name + c.email + c.phone}
        placeholder="Find a customer by name or phone…"
        action={(c) => P({ item: c.id })}
        columns={[
          {
            label: "Customer",
            value: (c) => (
              <div className="person">
                <Avatar name={c.name} index={data.customers.indexOf(c)} />
                <strong>{c.name}</strong>
              </div>
            ),
            sort: (c) => c.name,
          },
          { label: "Mobile", value: (c) => c.phone || "—" },
          {
            label: "Purchases",
            value: (c) => rupee(totals(c.id).sales),
            sort: (c) => totals(c.id).sales,
          },
          {
            label: "Collected",
            value: (c) => rupee(totals(c.id).paid),
            sort: (c) => totals(c.id).paid,
          },
          {
            label: "Outstanding",
            value: (c) => <strong>{rupee(totals(c.id).due, 2)}</strong>,
            sort: (c) => totals(c.id).due,
            align: "right",
          },
        ]}
      />
      <Modal
        open={params.has("new")}
        title="Add customer"
        description="Only the name is required. Contact and tax details are optional."
        routePanel
        onClose={closePanel}
      >
        <CustomerForm close={closePanel} />
      </Modal>
      <Modal
        open={!!selected}
        title="Customer profile"
        routePanel
        onClose={closePanel}
      >
        {selected && (
          <>
            <div className="identity-row">
              <Avatar name={selected.name} />
              <div>
                <h3>{selected.name}</h3>
                <p>
                  {[selected.phone, selected.email]
                    .filter(Boolean)
                    .join(" · ") || "No contact details added"}
                </p>
              </div>
            </div>
            <p className="muted">
              {selected.address}
              {selected.gstin && ` · GSTIN ${selected.gstin}`}
            </p>
            <div className="balance-banner">
              <span>Outstanding balance</span>
              <strong>{rupee(totals(selected.id).due, 2)}</strong>
            </div>
            <h3 className="spaced">Invoice history</h3>
            <div className="pick-list">
              {[...data.invoices]
                .reverse()
                .filter((b) => b.customer?.id === selected.id)
                .map((b) => (
                  <Link to={"/billing/" + b.id} key={b.id}>
                    <FileText size={17} />
                    <span>
                      <strong>{b.number}</strong>
                      <small>
                        {day(b.issuedAt)} · {paymentStatus(b)}
                      </small>
                    </span>
                    <b>{rupee(b.totalPaise)}</b>
                  </Link>
                ))}
              {!data.invoices.some((b) => b.customer?.id === selected.id) && (
                <Empty
                  title="No purchases yet"
                  text="New invoices will appear here."
                />
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
export function MetalRates() {
  const closePanel = useClosePanel();
  const { data, perform } = useShop(),
    notify = useToast(),
    [params, P] = useSearchParams(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    // Dropdown state; "Other" reveals a free-text field.
    [metalSel, setMetalSel] = useState("Gold"),
    [puritySel, setPuritySel] = useState("22K"),
    [metalCustom, setMetalCustom] = useState(""),
    [purityCustom, setPurityCustom] = useState("");
  const rates = currentRates(data.rates);
  const purityOpts = metalSel === OTHER_OPTION ? [] : puritiesFor(metalSel);
  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    B(true);
    try {
      const metalRaw = String(f.get("metal"));
      const metal =
        metalRaw === OTHER_OPTION
          ? String(f.get("metalCustom") ?? "").trim()
          : metalRaw;
      const purityRaw = String(f.get("purity"));
      const purity =
        purityRaw === OTHER_OPTION
          ? String(f.get("purityCustom") ?? "").trim()
          : purityRaw;
      if (!metal) throw Error("Type the custom metal.");
      if (!purity) throw Error("Type the custom purity.");
      const v = rateSchema.parse({
        id: key(),
        metal,
        purity,
        rate: Number(f.get("rate")),
        effectiveAt: new Date(String(f.get("date"))).toISOString(),
      });
      await perform("rate", v);
      notify("Effective metal rate recorded.");
      markSaved(document.querySelector("[role=dialog]"));
      closePanel();
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
    }
  };
  return (
    <>
      <PageHead
        eyebrow="RATE DESK"
        title="Metal rates"
        subtitle="Shop-managed prices per gram. Past invoices keep their original rates."
      >
        <button
          className="btn primary"
          onClick={() => {
            E("");
            P({ new: "1" });
          }}
        >
          <Plus size={16} />
          Update rate
        </button>
      </PageHead>
      <div className="rate-tiles">
        {rates.map((r) => {
          const prior = priorRate(r, data.rates);
          return (
            <div className="panel rate-tile" key={r.id}>
              <span
                className={
                  "metal-tile " + (r.metal === "Silver" ? "silver" : "")
                }
              >
                <Ingots silver={r.metal === "Silver"} />
              </span>
              <small>
                {r.metal} · {r.purity}
              </small>
              <strong>
                {cash(r.rate, 2)}
                <em> / g</em>
              </strong>
              <p>
                {prior
                  ? `${r.rate >= prior.rate ? "+" : "−"}${cash(Math.abs(r.rate - prior.rate), 2)} vs prior rate`
                  : "First recorded rate"}
              </p>
            </div>
          );
        })}
      </div>
      <Records
        title="Rate history"
        items={[...data.rates].sort((a, b) =>
          b.effectiveAt.localeCompare(a.effectiveAt),
        )}
        search={(r) => r.metal + r.purity}
        placeholder="Filter metal or purity…"
        columns={[
          {
            label: "Metal",
            value: (r) => <strong>{r.metal}</strong>,
            sort: (r) => r.metal,
          },
          { label: "Purity", value: (r) => r.purity },
          {
            label: "Effective from",
            value: (r) =>
              day(r.effectiveAt, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }) + " IST",
            sort: (r) => r.effectiveAt,
          },
          {
            label: "Rate / gram",
            value: (r) => cash(r.rate, 2),
            sort: (r) => r.rate,
            align: "right",
          },
        ]}
      />
      <Modal
        open={params.has("new")}
        title="Record metal rate"
        description="Enter your own shop rate. This is not an exchange price feed."
        routePanel
        onClose={closePanel}
      >
        <form onSubmit={add} data-saving={busy}>
          <div className="form-grid">
            <Field label="Metal">
              <Select
                name="metal"
                value={metalSel}
                onChange={(e) => {
                  const m = e.target.value;
                  setMetalSel(m);
                  setPuritySel(
                    m === OTHER_OPTION
                      ? OTHER_OPTION
                      : (puritiesFor(m)[0] ?? OTHER_OPTION),
                  );
                }}
              >
                {METALS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
                <option>{OTHER_OPTION}</option>
              </Select>
            </Field>
            {metalSel === OTHER_OPTION && (
              <Field label="Custom metal">
                <input
                  name="metalCustom"
                  value={metalCustom}
                  onChange={(e) => setMetalCustom(e.target.value)}
                  placeholder="e.g. Copper"
                />
              </Field>
            )}
            {purityOpts.length ? (
              <Field label="Purity">
                <Select
                  name="purity"
                  value={puritySel}
                  onChange={(e) => setPuritySel(e.target.value)}
                >
                  {purityOpts.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                  <option>{OTHER_OPTION}</option>
                </Select>
              </Field>
            ) : (
              <Field label="Purity">
                <input
                  name="purity"
                  value={purityCustom}
                  onChange={(e) => setPurityCustom(e.target.value)}
                  placeholder="e.g. 22K"
                />
              </Field>
            )}
            {puritySel === OTHER_OPTION && purityOpts.length > 0 && (
              <Field label="Custom purity">
                <input
                  name="purityCustom"
                  value={purityCustom}
                  onChange={(e) => setPurityCustom(e.target.value)}
                  placeholder="e.g. 21K"
                />
              </Field>
            )}
            <Field label="Rate per gram (₹)">
              <input
                type="number"
                required
                name="rate"
                min="0.01"
                step="0.01"
              />
            </Field>
            <Field label="Effective from (local time)">
              <input
                name="date"
                type="datetime-local"
                defaultValue={utcLocalInput(new Date())}
                required
              />
            </Field>
          </div>
          <Problem message={error} />
          <div className="modal-actions">
            <button className="btn primary" disabled={busy}>
              {busy ? "Saving…" : "Record rate"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
