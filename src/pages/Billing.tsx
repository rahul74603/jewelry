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
import {
  draftSchema,
  finalizeSchema,
  tenderModes,
  type TenderMode,
  type FinalizeInput,
  type Invoice,
  type InvoiceInput,
  type LineInput,
  type Product,
} from "../../functions/src/core/model";
import {
  calculateInvoice,
  assertDraftPayment,
  paise,
  paymentSelection,
  paymentStatus,
  currentRates,
} from "../../functions/src/core/billing";
import { InvoiceReceipt } from "../components/InvoiceReceipt";
import {
  allocations,
  supplyStates,
  isSale,
} from "../../functions/src/core/documents";
import { markSaved } from "../lib/navigation";
import { useShop, useToast } from "../lib/store";
import { rupee, day, key, err, cash } from "../lib/format";
import {
  printDocument,
  shareSummary,
  nativeRollExport,
  saveRollPdf,
} from "../lib/device";
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
    if (copy) {
      const { sourceEstimate: _, tenders: __, ...original } = copy.input;
      return {
        ...original,
        id: key(),
        type: params.has("convert") ? "Non-GST bill" : copy.type,
        paid: 0,
        mode: copy.mode === "Split" ? "Cash" : copy.mode,
        settlement: "part",
        ...(params.has("convert") ? { sourceEstimate: copy.id } : {}),
      };
    }
    return {
      id: key(),
      customerId: "",
      type: params.has("estimate") ? "Estimate" : "Non-GST bill",
      items: [],
      paid: 0,
      settlement: "part",
      mode: "Cash",
    };
  });
  const [initial] = useState(invoice);
  const advance = invoice.type === "Advance receipt";
  const [review, setReview] = useState<FinalizeInput | null>(null),
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
    if (
      advance
        ? !invoice.paid || !invoice.advanceFor || !invoice.customerId
        : !invoice.items.length
    )
      return { b: null, e: "" };
    try {
      return {
        b: calculateInvoice(
          data,
          {
            ...invoice,
            paid: advance ? invoice.paid : 0,
            mode: "Cash",
            tenders: undefined,
            settlement: "part",
          },
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
  }, [data, invoice, advance]);
  const total = preview.b?.totalPaise ?? 0,
    settlement = paymentSelection(invoice, total);
  const setPayment = (
    paid: number,
    settlement: FinalizeInput["settlement"],
  ) => {
    E("");
    I((s) => ({ ...s, paid, settlement }));
  };
  const switchMode = (mode: InvoiceInput["mode"]) =>
    I(({ tenders, ...s }) => ({
      ...s,
      mode,
      ...(mode === "Split"
        ? {
            tenders:
              s.paid > 0 && s.mode !== "Split"
                ? [{ mode: s.mode, amount: s.paid }]
                : [],
          }
        : {}),
    }));
  const split = (mode: TenderMode, amount: number) =>
    I((s) => {
      const tenders = [
        ...(s.tenders ?? []).filter((x) => x.mode !== mode),
        ...(amount > 0 ? [{ mode, amount }] : []),
      ];
      const paid = tenders.reduce((n, t) => n + paise(t.amount), 0) / 100;
      return {
        ...s,
        tenders,
        paid,
        settlement: paymentSelection({ paid }, total),
      };
    });
  const paymentInput = () => {
    const input = draftSchema.parse({
      ...invoice,
      settlement,
      ...(advance ? { settlement: "full" } : {}),
    });
    allocations(input);
    return input;
  };
  const reviewPayment = () => {
    E("");
    try {
      const input = paymentInput();
      const b = calculateInvoice(
        data,
        input,
        new Date().toISOString(),
        "Preview",
      );
      const confirmation = {
        totalPaise: b.totalPaise,
        balancePaise: b.balancePaise,
      };
      assertDraftPayment(
        input,
        data.drafts.find((d) => d.id === input.id),
      );
      // Submit exactly what the owner sees here, even if a background refresh occurs.
      setReview(finalizeSchema.parse({ ...input, confirmation }));
    } catch (e) {
      E(err(e));
    }
  };
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
      const payload = draft ? paymentInput() : review;
      if (!payload) throw Error("Review the payment before finalizing.");
      await perform(draft ? "draft" : "invoice", payload);
      notify(
        draft
          ? "Draft saved."
          : invoice.type === "Estimate"
            ? "Estimate saved."
            : advance
              ? "Advance recorded on customer account."
              : "Invoice finalized and stock posted.",
      );
      markSaved(document);
      nav(draft ? "/billing" : "/billing/" + invoice.id, { replace: true });
    } catch (e) {
      E(err(e));
      setReview(null);
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
      <div
        className="editor-grid"
        data-unsaved={JSON.stringify(initial) !== JSON.stringify(invoice)}
        data-saving={busy}
      >
        <div className="stack">
          <section className="panel form-panel">
            <h2>
              <span className="step-index">01</span>Bill details
            </h2>
            <div className="form-grid">
              <Field label="Document type">
                <Select
                  value={invoice.type}
                  onChange={(e) => {
                    const type = e.target.value as InvoiceInput["type"];
                    I(({ advanceFor, placeOfSupply, ...s }) => {
                      if (type === "Estimate" || advance) {
                        const { tenders, ...rest } = s;
                        return {
                          ...rest,
                          type,
                          paid: 0,
                          settlement: "part",
                          mode: s.mode === "Split" ? "Cash" : s.mode,
                        };
                      }
                      return { ...s, type };
                    });
                    E("");
                  }}
                >
                  <option>Non-GST bill</option>
                  <option disabled={!data.profile.gstRegistered}>
                    GST invoice
                  </option>
                  <option disabled={!!invoice.sourceEstimate}>Estimate</option>
                  <option
                    disabled={
                      !!invoice.items.length || !!invoice.sourceEstimate
                    }
                  >
                    Advance receipt
                  </option>
                </Select>
              </Field>
              {invoice.type === "GST invoice" && (
                <Field label="Place of supply (goods)">
                  <Select
                    value={invoice.placeOfSupply ?? ""}
                    onChange={(e) => change("placeOfSupply", e.target.value)}
                  >
                    <option value="">Select actual state / UT</option>
                    {Object.entries(supplyStates)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([code, name]) => (
                        <option key={code} value={code}>
                          {name} ({code})
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
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
          {advance ? (
            <section className="panel form-panel">
              <h2>Customer deposit</h2>
              <Field
                label="Advance for"
                hint="This credits the customer account. No sale, tax or stock movement is posted."
              >
                <input
                  maxLength={240}
                  value={invoice.advanceFor ?? ""}
                  onChange={(e) => change("advanceFor", e.target.value)}
                />
              </Field>
            </section>
          ) : (
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
                                  r.metal === p?.metal &&
                                  r.purity === p?.purity,
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
              <button
                className="btn outline full-btn"
                onClick={() => M("items")}
              >
                <Plus size={16} />
                Add product to bill
              </button>
            </section>
          )}
        </div>
        <aside className="panel summary-card">
          <div className="section-kicker">
            <i />
            CHECKOUT
          </div>
          <h2>Invoice summary</h2>
          {!advance && (
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
                  preview.b?.lines.reduce((s, l) => s + l.discountPaise, 0) ??
                    0,
                  2,
                )}
              </dd>
              {invoice.type === "GST invoice" && (
                <>
                  <dt>GST</dt>
                  <dd>{rupee(preview.b?.taxPaise ?? 0, 2)}</dd>
                </>
              )}
              <dt>Round off</dt>
              <dd>{rupee(preview.b?.roundOffPaise ?? 0, 2)}</dd>
            </dl>
          )}
          <div className="grand-total">
            <small>Grand total</small>
            <strong>{rupee(total, 2)}</strong>
          </div>
          {invoice.type !== "Estimate" && (
            <div className="stack compact-stack">
              {!advance && invoice.mode !== "Split" && (
                <Field label="Payment">
                  <Select
                    value={settlement}
                    onChange={(e) =>
                      e.target.value === "full"
                        ? setPayment(total / 100, "full")
                        : setPayment(invoice.paid, "part")
                    }
                  >
                    <option value="full" disabled={!preview.b || total === 0}>
                      Paid in full
                    </option>
                    <option value="part">Partial payment / credit</option>
                  </Select>
                </Field>
              )}
              <Field label="Amount received (₹)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  readOnly={invoice.mode === "Split"}
                  value={invoice.paid}
                  onChange={(e) => {
                    const paid = Number(e.target.value);
                    setPayment(paid, paymentSelection({ paid }, total));
                  }}
                />
              </Field>
              <Field label="Payment mode">
                <Select
                  value={invoice.mode}
                  onChange={(e) =>
                    switchMode(e.target.value as InvoiceInput["mode"])
                  }
                >
                  {[...tenderModes, "Split"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              </Field>
              {invoice.mode === "Split" && (
                <div className="form-grid">
                  {tenderModes.map((mode) => (
                    <Field key={mode} label={`${mode} received (₹)`}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          invoice.tenders?.find((t) => t.mode === mode)
                            ?.amount ?? ""
                        }
                        onChange={(e) => split(mode, +e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              )}
              <div className="row-between">
                <small>Balance due</small>
                <strong>{rupee(total - paise(invoice.paid), 2)}</strong>
              </div>
            </div>
          )}
          <Problem message={error || preview.e} />
          <button
            disabled={busy || !preview.b}
            className="btn primary full-btn"
            onClick={reviewPayment}
          >
            <Check size={16} />
            {invoice.type === "Estimate"
              ? "Save estimate"
              : advance
                ? "Record advance"
                : "Finalize invoice"}
          </button>
          <button
            className="btn outline full-btn"
            disabled={busy || (advance ? !invoice.paid : !invoice.items.length)}
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
            autoFocus={!window.matchMedia("(pointer: coarse)").matches}
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
        open={review !== null}
        onClose={() => setReview(null)}
        title={
          invoice.type === "Estimate"
            ? "Save this estimate?"
            : advance
              ? "Record this advance?"
              : "Finalize this invoice?"
        }
      >
        {review && (
          <>
            <div className="confirm-total">
              {rupee(review.confirmation.totalPaise, 2)}
            </div>
            <p className="muted">
              {review.type === "Estimate"
                ? "Estimates do not move stock or record payments."
                : review.mode === "Split"
                  ? `${allocations(review)
                      .map((t) => `${t.mode}: ${rupee(t.amountPaise, 2)}`)
                      .join(
                        " + ",
                      )}. Total received: ${cash(review.paid, 2)}. Outstanding: ${rupee(review.confirmation.balancePaise, 2)}.`
                  : `Received · ${review.mode}: ${cash(review.paid, 2)}. Outstanding: ${rupee(review.confirmation.balancePaise, 2)}. Changes require a reversal.`}
            </p>
          </>
        )}
        <div className="modal-actions">
          <button
            className="btn outline"
            disabled={busy}
            onClick={() => setReview(null)}
          >
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
    [params] = useSearchParams(),
    note = params.has("credit") ? b?.creditNote : undefined,
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
    const text = note
      ? `${note.shop.shopName} · Credit note ${note.number} against ${b.number} · ${rupee(b.totalPaise, 2)}`
      : `${demo ? "SAMPLE · " : ""}${b.shop.shopName} · ${b.number}\n${day(b.issuedAt)}\nTotal ${rupee(b.totalPaise, 2)} · Balance ${rupee(b.balancePaise, 2)}`;
    try {
      if ((await shareSummary(note?.number ?? b.number, text)) === "copied")
        notify("Invoice summary copied for sharing.");
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
        title={note?.number ?? b.number}
        subtitle="A snapshot of the rates, charges and branding at the time of issue."
      >
        <button className="btn outline" onClick={share}>
          <Share2 size={15} />
          Share summary
        </button>
        <button
          className="btn primary"
          onClick={() =>
            printDocument(
              (note?.shop ?? b.shop).format,
              note?.number ?? b.number,
            ).catch((e) => E(err(e)))
          }
        >
          <Printer size={16} />
          Print / PDF
        </button>
      </PageHead>
      {nativeRollExport && (note?.shop ?? b.shop).format.endsWith("mm") && (
        <div className="info-box roll-export">
          <div>
            <strong>Exact-size roll PDF</strong>
            <p>
              Android’s print service may substitute Letter. Save a true{" "}
              {(note?.shop ?? b.shop).format} PDF without changing the bill.
            </p>
          </div>
          <button
            className="btn outline"
            disabled={busy}
            onClick={async () => {
              B(true);
              try {
                if (
                  (
                    await saveRollPdf(
                      (note?.shop ?? b.shop).format,
                      note?.number ?? b.number,
                    )
                  ).saved
                )
                  notify("Roll PDF saved.");
              } catch (e) {
                E(err(e));
              } finally {
                B(false);
              }
            }}
          >
            Save exact-size PDF
          </button>
        </div>
      )}
      <Problem message={error} />
      <InvoiceReceipt bill={b} sample={demo} credit={!!note} />
      <div className="document-actions">
        {b.creditNote && (
          <Link
            className="btn primary"
            to={"/billing/" + b.id + (note ? "" : "?credit=1")}
          >
            {note ? "View original bill" : "View credit note"}
          </Link>
        )}
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
          {isSale(b) &&
            " A full credit note will reference this bill. Confirm only after arranging any repayment using the original tender(s)."}
        </p>
        <form
          data-saving={busy}
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
