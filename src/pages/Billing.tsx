import { useState, useMemo } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Plus,
  ArrowLeft,
  ArrowRight,
  ReceiptText,
  FileText,
  Trash2,
  Search,
  Copy,
  Share2,
  Printer,
  Check,
  ShieldCheck,
  Save,
  ChevronRight,
  Package,
  RotateCcw,
  FilePenLine,
  IndianRupee,
} from "lucide-react";
import type {
  Invoice,
  InvoiceInput,
  LineInput,
  Product,
} from "../../functions/src/core/model";
import {
  calculateInvoice,
  paymentStatus,
  currentRates,
} from "../../functions/src/core/billing";
import { useShop, useToast } from "../lib/store";
import { rupee, day, key, err, cash } from "../lib/format";
import { printDocument } from "../lib/device";
import {
  PageHead,
  Records,
  Field,
  Select,
  Problem,
  Modal,
  Status,
  Empty,
  Avatar,
  GemMark,
} from "../components/ui";
export function Invoices() {
  const { data } = useShop();
  const nav = useNavigate(),
    [tab, T] = useState("Invoices");
  const invoices = [...data.invoices]
    .filter((i) => (i.type === "Estimate") === (tab === "Estimates"))
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return (
    <>
      <PageHead
        eyebrow="BILLING DESK"
        title="Billing & invoices"
        subtitle="Manage bills, estimates and payment records in one place."
      >
        <Link className="btn primary" to="/billing/new">
          <Plus size={16} />
          New invoice
        </Link>
      </PageHead>
      <div className="tabs">
        {["Invoices", "Estimates", "Drafts"].map((t) => (
          <button
            className={tab === t ? "on" : ""}
            key={t}
            onClick={() => T(t)}
          >
            {t}
            <span>
              {t === "Drafts"
                ? data.drafts.length
                : data.invoices.filter(
                    (i) => (i.type === "Estimate") === (t === "Estimates"),
                  ).length}
            </span>
          </button>
        ))}
      </div>
      {tab === "Drafts" ? (
        <Records
          items={data.drafts}
          search={(d) =>
            data.customers.find((c) => c.id === d.customerId)?.name ?? "Walk-in"
          }
          action={(d) => nav("/billing/new?draft=" + d.id)}
          columns={[
            { label: "Draft", value: (d) => d.type },
            {
              label: "Customer",
              value: (d) =>
                data.customers.find((c) => c.id === d.customerId)?.name ??
                "Walk-in",
            },
            {
              label: "Updated",
              value: (d) => day(d.updatedAt),
              sort: (d) => d.updatedAt,
            },
            { label: "Items", value: (d) => d.items.length },
          ]}
          empty="No draft bills"
        />
      ) : (
        <Records
          items={invoices}
          search={(i) =>
            `${i.number} ${i.customer?.name ?? "Walk-in"} ${paymentStatus(i)}`
          }
          placeholder="Search number, customer or status…"
          action={(i) => nav("/billing/" + i.id)}
          columns={[
            {
              label: "Invoice no.",
              value: (i) => <strong className="invoice-num">{i.number}</strong>,
              sort: (i) => i.number,
            },
            {
              label: "Customer",
              value: (i) => (
                <div className="person">
                  <Avatar name={i.customer?.name ?? "Walk-in"} />
                  {i.customer?.name ?? "Walk-in customer"}
                </div>
              ),
              sort: (i) => i.customer?.name ?? "",
            },
            {
              label: "Date",
              value: (i) => day(i.issuedAt),
              sort: (i) => i.issuedAt,
            },
            {
              label: "Amount",
              value: (i) => rupee(i.totalPaise, 2),
              sort: (i) => i.totalPaise,
              align: "right",
            },
            {
              label: "Status",
              value: (i) => <Status text={paymentStatus(i)} />,
            },
          ]}
        />
      )}
    </>
  );
}
export function InvoiceEditor() {
  const { data, perform, demo } = useShop();
  const nav = useNavigate(),
    notify = useToast(),
    [params] = useSearchParams();
  const [invoice, I] = useState<InvoiceInput>(() => {
    const d = data.drafts.find((d) => d.id === params.get("draft")),
      copy = data.invoices.find(
        (b) => b.id === (params.get("duplicate") || params.get("convert")),
      );
    if (d) return { ...d };
    if (copy)
      return {
        ...copy.input,
        id: key(),
        type: params.has("convert") ? "Non-GST bill" : copy.type,
        paid: 0,
        ...(params.has("convert")
          ? { sourceEstimate: copy.id }
          : { sourceEstimate: undefined }),
      };
    return {
      id: key(),
      customerId: "",
      type: params.has("estimate") ? "Estimate" : "Non-GST bill",
      items: [],
      paid: 0,
      mode: "Cash",
    };
  });
  const [settlement, S] = useState<"full" | "part">(
      invoice.paid ? "part" : "full",
    ),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [modal, M] = useState(""),
    [query, Q] = useState(""),
    [expand, X] = useState(-1);
  const change = <K extends keyof InvoiceInput>(k: K, v: InvoiceInput[K]) => {
    E("");
    I((s) => ({ ...s, [k]: v }));
  };
  const setLine = (n: number, v: Partial<LineInput>) =>
    change(
      "items",
      invoice.items.map((i, k) => (k === n ? { ...i, ...v } : i)),
    );
  const preview = useMemo(() => {
    if (!invoice.items.length) return { b: null, e: "" };
    try {
      return {
        b: calculateInvoice(
          data,
          { ...invoice, paid: 0 },
          new Date().toISOString(),
          "Preview",
          false,
          false,
        ),
        e: "",
      };
    } catch (e) {
      return { b: null, e: err(e) };
    }
  }, [data, invoice]);
  const total = preview.b?.totalPaise ?? 0,
    paid =
      invoice.type === "Estimate"
        ? 0
        : settlement === "full"
          ? total / 100
          : invoice.paid;
  const add = (p: Product) => {
    const i = invoice.items.findIndex((x) => x.productId === p.id);
    if (i >= 0) setLine(i, { quantity: invoice.items[i].quantity + 1 });
    else
      change("items", [
        ...invoice.items,
        {
          productId: p.id,
          quantity: 1,
          makingMode: p.makingMode,
          making: p.making,
          discount: 0,
          wastagePct: 0,
          stoneValue: 0,
          otherCharges: 0,
        },
      ]);
    M("");
    Q("");
  };
  const save = async (draft: boolean) => {
    if (busy) return;
    B(true);
    E("");
    try {
      const payload = JSON.parse(JSON.stringify({ ...invoice, paid }));
      if (!draft)
        calculateInvoice(data, payload, new Date().toISOString(), "Preview");
      await perform(draft ? "draft" : "invoice", payload);
      notify(
        draft
          ? "Draft saved."
          : invoice.type === "Estimate"
            ? "Estimate saved."
            : "Invoice finalized and stock posted.",
      );
      nav(draft ? "/billing" : "/billing/" + invoice.id);
    } catch (e) {
      E(err(e));
      M("");
    } finally {
      B(false);
    }
  };
  return (
    <>
      <Link className="back-link" to="/billing">
        <ArrowLeft size={14} />
        Billing & invoices
      </Link>
      <PageHead
        eyebrow="BILLING STUDIO"
        title={
          params.has("draft")
            ? "Edit draft"
            : invoice.type === "Estimate"
              ? "New estimate"
              : "New invoice"
        }
        subtitle="Build an itemised bill with your shop’s current metal rates."
      />
      <div className="editor-grid">
        <div className="stack">
          <section className="panel form-panel">
            <h2>
              <span className="step-index">01</span>Bill details
            </h2>
            <div className="form-grid">
              <Field label="Document type">
                <Select
                  value={invoice.type}
                  onChange={(e) =>
                    change("type", e.target.value as InvoiceInput["type"])
                  }
                >
                  <option>Non-GST bill</option>
                  <option disabled={!data.profile.gstRegistered}>
                    GST invoice
                  </option>
                  <option>Estimate</option>
                </Select>
              </Field>
              <Field label="Customer">
                <Select
                  value={invoice.customerId}
                  onChange={(e) => change("customerId", e.target.value)}
                >
                  <option value="">Walk-in customer</option>
                  {data.customers.map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </section>
          <section className="panel form-panel">
            <div className="row-between">
              <h2>
                <span className="step-index">02</span>Jewellery items
              </h2>
              <span className="count-pill">{invoice.items.length} items</span>
            </div>
            {!invoice.items.length ? (
              <div className="item-placeholder">
                <ReceiptText size={25} />
                <strong>Add your first item</strong>
                <p>Choose a product from your inventory.</p>
              </div>
            ) : (
              invoice.items.map((l, n) => {
                const p = data.products.find((p) => p.id === l.productId);
                return (
                  <div className="bill-line" key={l.productId}>
                    <div className="row-between">
                      <div>
                        <strong>{p?.name ?? "Missing product"}</strong>
                        <small>
                          {p?.metal} · {p?.purity} · {p?.gross} g gross
                        </small>
                      </div>
                      <button
                        className="icon-btn"
                        title="Remove item"
                        aria-label={"Remove " + p?.name}
                        onClick={() =>
                          change(
                            "items",
                            invoice.items.filter((_, k) => k !== n),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="line-nums">
                      <Field label="Qty">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={l.quantity}
                          onChange={(e) =>
                            setLine(n, { quantity: +e.target.value })
                          }
                        />
                      </Field>
                      <div>
                        <small>Applied rate / g</small>
                        <strong>
                          {cash(
                            currentRates(data.rates).find(
                              (r) =>
                                r.metal === p?.metal && r.purity === p?.purity,
                            )?.rate ?? 0,
                          )}
                        </strong>
                      </div>
                      <div>
                        <small>Line total</small>
                        <strong>
                          {rupee(preview.b?.lines[n]?.totalPaise ?? 0, 2)}
                        </strong>
                      </div>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => X(expand === n ? -1 : n)}
                    >
                      {expand === n ? "Hide" : "Adjust"} making & charges
                    </button>
                    {expand === n && (
                      <div className="form-grid charges">
                        <Field label="Making calculation">
                          <Select
                            value={l.makingMode}
                            onChange={(e) =>
                              setLine(n, {
                                makingMode: e.target
                                  .value as LineInput["makingMode"],
                              })
                            }
                          >
                            <option>Fixed</option>
                            <option>Per gram</option>
                            <option>Percentage</option>
                          </Select>
                        </Field>
                        {(
                          [
                            ["making", "Making amount / rate"],
                            ["wastagePct", "Wastage %"],
                            ["stoneValue", "Stone value / piece (₹)"],
                            ["otherCharges", "Other charges / piece (₹)"],
                            ["discount", "Line discount (₹)"],
                          ] as const
                        ).map(([k, t]) => (
                          <Field key={k} label={t}>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={l[k]}
                              onChange={(e) =>
                                setLine(n, { [k]: +e.target.value })
                              }
                            />
                          </Field>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <button className="btn outline full-btn" onClick={() => M("items")}>
              <Plus size={16} />
              Add product to bill
            </button>
          </section>
        </div>
        <aside className="panel summary-card">
          <div className="section-kicker">
            <i />
            CHECKOUT
          </div>
          <h2>Invoice summary</h2>
          <dl className="summary-lines">
            <dt>Metal value</dt>
            <dd>
              {rupee(
                preview.b?.lines.reduce((s, l) => s + l.metalPaise, 0) ?? 0,
                2,
              )}
            </dd>
            <dt>Making & other charges</dt>
            <dd>
              {rupee(
                preview.b?.lines.reduce(
                  (s, l) =>
                    s +
                    l.makingPaise +
                    l.otherPaise +
                    l.stonePaise +
                    l.wastagePaise,
                  0,
                ) ?? 0,
                2,
              )}
            </dd>
            <dt>Discount</dt>
            <dd>
              {rupee(
                preview.b?.lines.reduce((s, l) => s + l.discountPaise, 0) ?? 0,
                2,
              )}
            </dd>
            <dt>GST</dt>
            <dd>{rupee(preview.b?.taxPaise ?? 0, 2)}</dd>
            <dt>Round off</dt>
            <dd>{rupee(preview.b?.roundOffPaise ?? 0, 2)}</dd>
          </dl>
          <div className="grand-total">
            <small>Grand total</small>
            <strong>{rupee(total, 2)}</strong>
          </div>
          {invoice.type !== "Estimate" && (
            <div className="stack compact-stack">
              <Field label="Payment">
                <Select
                  value={settlement}
                  onChange={(e) => S(e.target.value as "full" | "part")}
                >
                  <option value="full">Paid in full</option>
                  <option value="part">Partial payment / credit</option>
                </Select>
              </Field>
              {settlement === "part" && (
                <Field label="Amount received (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={invoice.paid}
                    onChange={(e) => change("paid", +e.target.value)}
                  />
                </Field>
              )}
              <Field label="Payment mode">
                <Select
                  value={invoice.mode}
                  onChange={(e) =>
                    change("mode", e.target.value as InvoiceInput["mode"])
                  }
                >
                  {["Cash", "UPI", "Card", "Bank", "Other"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              <div className="row-between">
                <small>Balance due</small>
                <strong>{rupee(total - Math.round(paid * 100), 2)}</strong>
              </div>
            </div>
          )}
          <Problem message={error || preview.e} />
          <button
            disabled={busy || !preview.b}
            className="btn primary full-btn"
            onClick={() => M("confirm")}
          >
            <Check size={16} />
            {invoice.type === "Estimate" ? "Save estimate" : "Finalize invoice"}
          </button>
          <button
            className="btn outline full-btn"
            disabled={busy || !invoice.items.length}
            onClick={() => save(true)}
          >
            <Save size={15} />
            Save draft
          </button>
          <p className="footnote">
            {demo
              ? "Demo changes last for this session only."
              : "Finalized bills retain their original rates and tax details."}
          </p>
        </aside>
      </div>
      <Modal
        open={modal === "items"}
        title="Choose a product"
        description="Search your shop’s inventory."
        onClose={() => M("")}
      >
        <label className="search-input full-search">
          <Search size={16} />
          <input
            autoFocus
            placeholder="Search product or SKU…"
            value={query}
            onChange={(e) => Q(e.target.value)}
          />
        </label>
        <div className="pick-list">
          {data.products
            .filter((p) =>
              (p.name + p.sku).toLowerCase().includes(query.toLowerCase()),
            )
            .map((p) => (
              <button
                key={p.id}
                disabled={!p.stock && invoice.type !== "Estimate"}
                onClick={() => add(p)}
              >
                <span className="item-icon">
                  <Package size={18} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.sku} · {p.metal} {p.purity} · {p.stock} pcs
                  </small>
                </span>
                <Plus size={15} />
              </button>
            ))}
          {!data.products.length && (
            <Link to="/inventory?new=1" className="btn primary">
              Add inventory
            </Link>
          )}
        </div>
      </Modal>
      <Modal
        open={modal === "confirm"}
        onClose={() => M("")}
        title={
          invoice.type === "Estimate"
            ? "Save this estimate?"
            : "Finalize this invoice?"
        }
      >
        <div className="confirm-total">{rupee(total, 2)}</div>
        <p className="muted">
          {invoice.type === "Estimate"
            ? "Estimates do not move stock or record payments."
            : `This posts ${invoice.items.length} line item(s), records ${cash(paid, 2)} received and preserves the applied rates. Changes require a reversal.`}
        </p>
        <div className="modal-actions">
          <button className="btn outline" disabled={busy} onClick={() => M("")}>
            Review bill
          </button>
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => save(false)}
          >
            {busy ? "Saving…" : "Confirm & save"}
          </button>
        </div>
      </Modal>
    </>
  );
}
export function InvoiceDetail() {
  const { id } = useParams(),
    { data, demo, perform } = useShop(),
    b = data.invoices.find((x) => x.id === id),
    notify = useToast();
  const [voiding, V] = useState(false),
    [reason, R] = useState(""),
    [error, E] = useState(""),
    [busy, B] = useState(false);
  if (!b)
    return (
      <Empty
        title="Document not found"
        text="This record is not in your workspace."
      >
        <Link to="/billing">Back to invoices</Link>
      </Empty>
    );
  const share = async () => {
    const text = `${demo ? "SAMPLE · " : ""}${b.shop.shopName} · ${b.number}\n${day(b.issuedAt)}\nTotal ${rupee(b.totalPaise, 2)} · Balance ${rupee(b.balancePaise, 2)}`;
    try {
      if (navigator.share) await navigator.share({ title: b.number, text });
      else {
        await navigator.clipboard.writeText(text);
        notify("Invoice summary copied for sharing.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") E(err(e));
    }
  };
  return (
    <>
      <Link className="back-link" to="/billing">
        <ArrowLeft size={14} />
        Billing & invoices
      </Link>
      <PageHead
        eyebrow="DOCUMENT DETAILS"
        title={b.number}
        subtitle="A snapshot of the rates, charges and branding at the time of issue."
      >
        <button className="btn outline" onClick={share}>
          <Share2 size={15} />
          Share
        </button>
        <button
          className="btn primary"
          onClick={() => printDocument().catch((e) => E(err(e)))}
        >
          <Printer size={16} />
          Print / PDF
        </button>
      </PageHead>
      <Problem message={error} />
      <style>{`@media print {@page { size: ${["A4", "A5"].includes(b.shop.format) ? b.shop.format : "auto"}; margin: ${b.shop.format.includes("mm") ? "2mm" : "10mm"}; }}`}</style>
      <article
        className={"receipt " + (b.shop.format.includes("mm") ? "thermal" : "")}
        style={
          {
            "--paper-width": b.shop.format.includes("mm")
              ? b.shop.format
              : "100%",
          } as React.CSSProperties
        }
      >
        <div className="receipt-brand">
          <span className="receipt-logo">
            {b.shop.logo ? (
              <img src={b.shop.logo} alt="Shop logo" />
            ) : (
              <GemMark size={34} />
            )}
          </span>
          <div>
            <h2>{b.shop.shopName}</h2>
            <p>{b.shop.address}</p>
            <small>
              {[
                b.shop.mobile,
                b.shop.email,
                b.shop.gstin && "GSTIN " + b.shop.gstin,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </div>
        </div>
        <div className="receipt-info">
          <div>
            <small>BILLED TO</small>
            <h3>{b.customer?.name ?? "Walk-in customer"}</h3>
            <p>
              {[b.customer?.phone, b.customer?.address, b.customer?.gstin]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div>
            <small>{b.type.toUpperCase()}</small>
            <strong>{b.number}</strong>
            <p>{day(b.issuedAt)}</p>
            <Status text={paymentStatus(b)} />
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Item / purity</th>
                <th>Qty</th>
                <th>Net wt.</th>
                <th>Rate/g</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.productId}>
                  <td>
                    <strong>{l.name}</strong>
                    <small>
                      {l.metal} · {l.purity}
                      {l.hsn && ` · HSN ${l.hsn}`} · GST {l.taxPercent}%
                    </small>
                  </td>
                  <td>{l.quantity}</td>
                  <td>{l.net} g</td>
                  <td>{cash(l.rate, 2)}</td>
                  <td className="right">{rupee(l.totalPaise, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="receipt-totals">
          {[
            ["Taxable / subtotal", b.subtotalPaise],
            ["GST", b.taxPaise],
            ["Round off", b.roundOffPaise],
            ["Grand total", b.totalPaise],
            ["Received · " + b.mode, b.paidPaise],
            ["Balance", b.balancePaise],
          ].map(([t, v]) => (
            <div key={t} className={t === "Grand total" ? "total" : ""}>
              <dt>{t}</dt>
              <dd>{rupee(Number(v), 2)}</dd>
            </div>
          ))}
        </dl>
        <div className="receipt-foot">
          <span>
            {demo
              ? "SAMPLE · NOT A TAX DOCUMENT"
              : "Thank you for your business."}
          </span>
          <span>Authorised signature</span>
        </div>
        {b.voidedAt && <p className="problem">VOIDED · {day(b.voidedAt)}</p>}
      </article>
      <div className="document-actions">
        <Link className="btn outline" to={"/billing/new?duplicate=" + b.id}>
          <Copy size={15} />
          Duplicate
        </Link>
        {b.type === "Estimate" && !b.voidedAt && !b.convertedTo && (
          <Link className="btn primary" to={"/billing/new?convert=" + b.id}>
            Convert to invoice
            <ArrowRight size={14} />
          </Link>
        )}
        {!b.voidedAt && !b.convertedTo && (
          <button className="btn danger-outline" onClick={() => V(true)}>
            <RotateCcw size={14} />
            Void document
          </button>
        )}
      </div>
      <Modal
        open={voiding}
        onClose={() => V(false)}
        title="Reverse this document?"
      >
        <p className="muted">
          The original document is retained. Stock, payments and receivables are
          reversed together.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            B(true);
            try {
              await perform("void", { id: b.id, reason });
              V(false);
              notify("Document reversed.");
            } catch (e) {
              E(err(e));
              V(false);
            } finally {
              B(false);
            }
          }}
        >
          <Field label="Reason for reversal">
            <input
              minLength={3}
              required
              maxLength={200}
              value={reason}
              onChange={(e) => R(e.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <button className="btn danger" disabled={busy}>
              {busy ? "Reversing…" : "Confirm reversal"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
