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
  type Draft,
  type InvoiceInput,
  type LineInput,
  type Product,
  type Customer,
} from "../../functions/src/core/model";
import {
  calculateInvoice,
  assertDraftPayment,
  paise,
  paymentSelection,
  paymentStatus,
  currentRates,
  defaultGstPercent,
  GST_PERCENT_OPTIONS,
} from "../../functions/src/core/billing";
import { InvoiceReceipt } from "../components/InvoiceReceipt";
import {
  allocations,
  supplyStates,
  isSale,
} from "../../functions/src/core/documents";
import { markSaved } from "../lib/navigation";
import { useShop, useToast } from "../lib/store";
import { newLine } from "../lib/demo";
import {
  METALS,
  OTHER_OPTION,
  PRODUCT_CATEGORIES,
  puritiesFor,
  typesFor,
} from "../lib/catalog";
import {
  buildQuickProduct,
  findCustomerByPhone,
  prefillRate,
  rateUpsertFor,
  resolveBillCustomer,
} from "../lib/billFlow";
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
  const { data, perform } = useShop(),
    notify = useToast();
  const nav = useNavigate(),
    [tab, T] = useState("Invoices"),
    [deleting, setDeleting] = useState<Draft | null>(null),
    [busy, B] = useState(false),
    [error, E] = useState("");
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
      <Problem message={error} />
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
            {
              label: "",
              value: (d) => (
                <button
                  className="icon-btn"
                  aria-label="Delete draft"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleting(d);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <Trash2 size={16} />
                </button>
              ),
            },
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
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this draft?"
      >
        <p className="muted">
          This unsaved draft will be permanently deleted. Finalized
          bills are not affected.
        </p>
        <div className="modal-actions">
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              if (!deleting) return;
              B(true);
              try {
                await perform("deleteDraft", { id: deleting.id });
                setDeleting(null);
                notify("Draft deleted.");
              } catch (e) {
                E(err(e));
                setDeleting(null);
              } finally {
                B(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Yes, delete draft"}
          </button>
        </div>
      </Modal>
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
    [query, Q] = useState(""),
    [expand, X] = useState(-1);
  // 01 Customer — typed right on the bill. Drafts / duplicates /
  // converted estimates reopen with their customer already filled in.
  const [custName, setCustName] = useState(
    () =>
      data.customers.find((c) => c.id === invoice.customerId)?.name ?? "",
  );
  const [custPhone, setCustPhone] = useState(
    () =>
      data.customers.find((c) => c.id === invoice.customerId)?.phone ?? "",
  );
  const [custAddress, setCustAddress] = useState(
    () =>
      data.customers.find((c) => c.id === invoice.customerId)?.address ?? "",
  );
  // The customer the typed mobile matched (if any) — their name and
  // address fill in by themselves, and the bill links to them.
  const matchedCustomer = invoice.customerId
    ? data.customers.find((c) => c.id === invoice.customerId)
    : undefined;
  // 02 Quick-add — a new piece typed straight on the bill: category,
  // sub-type, metal, purity, rate and lagat, all in one compact form.
  // "Other" in a dropdown reveals a free-text field for that value.
  const [qaCategory, setQaCategory] = useState("Rings");
  const [qaType, setQaType] = useState("Band");
  const [qaTypeOther, setQaTypeOther] = useState("");
  const [qaCatOther, setQaCatOther] = useState("");
  const [qaMetal, setQaMetal] = useState("Gold");
  const [qaMetalOther, setQaMetalOther] = useState("");
  const [qaPurity, setQaPurity] = useState("22K");
  const [qaPurityOther, setQaPurityOther] = useState("");
  const [qaRate, setQaRate] = useState(
    () => String(prefillRate(data.rates, "Gold", "22K") ?? ""),
  );
  const [qaWeight, setQaWeight] = useState("");
  const [qaLagat, setQaLagat] = useState("");
  const [qaMaking, setQaMaking] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  // Rate typed in place to fix a missing-rate warning, keyed by
  // "Metal Purity" (e.g. "Gold 22K").
  const [fixRates, setFixRates] = useState<Record<string, string>>({});
  const [fixBusy, setFixBusy] = useState("");
  const qaTypeOptions =
    qaCategory === OTHER_OPTION ? [] : typesFor(qaCategory);
  const qaPurityOptions =
    qaMetal === OTHER_OPTION ? [] : puritiesFor(qaMetal);
  // A mobile that matches a customer fills their name and address and
  // links the bill to them; a mobile that matches nobody unlinks the
  // bill, so saving creates a fresh customer from the typed fields.
  const onCustPhone = (v: string) => {
    setCustPhone(v);
    const match = findCustomerByPhone(data.customers, v);
    if (match) {
      setCustName(match.name);
      setCustAddress(match.address);
      if (invoice.customerId !== match.id) change("customerId", match.id);
    } else if (invoice.customerId) {
      change("customerId", "");
    }
  };
  // Metal / purity change: purity follows the metal, and the rate
  // field pre-fills with the current rate for that metal + purity.
  const onQaMetal = (m: string) => {
    setQaMetal(m);
    const p = m === OTHER_OPTION ? "" : (puritiesFor(m)[0] ?? "");
    setQaPurity(p);
    setQaRate(p ? String(prefillRate(data.rates, m, p) ?? "") : "");
  };
  const onQaPurity = (p: string) => {
    setQaPurity(p);
    setQaRate(String(prefillRate(data.rates, qaMetal, p) ?? ""));
  };
  const change = <K extends keyof InvoiceInput>(k: K, v: InvoiceInput[K]) => {
    E("");
    I((s) => ({ ...s, [k]: v }));
  };
  const setLine = (n: number, v: Partial<LineInput>) =>
    change(
      "items",
      invoice.items.map((i, k) => (k === n ? { ...i, ...v } : i)),
    );
  // Drafts saved before the manual GST % existed have no gstPercent; treat
  // them with the same default the selector displays, so preview and the
  // saved bill always agree on the rate.
  const effectiveInvoice =
    invoice.type === "GST invoice" && invoice.gstPercent === undefined
      ? { ...invoice, gstPercent: defaultGstPercent(data.profile) }
      : invoice;
  // Preview for an advance whose customer is typed above but not yet
  // saved: the calc needs a customer record to exist, so preview
  // against a stand-in with the typed details. Finalize and drafts
  // always use the real resolved customer (see resolveCustomer), so
  // this stand-in never reaches a saved bill.
  const previewCustomerId =
    invoice.customerId || (custName.trim() ? "preview-customer" : "");
  const previewData = useMemo(
    () =>
      invoice.customerId || !custName.trim()
        ? data
        : {
            ...data,
            customers: [
              ...data.customers,
              {
                id: "preview-customer",
                name: custName.trim(),
                phone: custPhone.trim(),
                email: "",
                address: custAddress.trim(),
                gstin: "",
              },
            ],
          },
    [data, invoice.customerId, custName, custPhone, custAddress],
  );
  const preview = useMemo(() => {
    if (
      advance
        ? !invoice.paid || !invoice.advanceFor || !previewCustomerId
        : !invoice.items.length
    )
      return { b: null, e: "" };
    try {
      return {
        b: calculateInvoice(
          previewData,
          {
            ...effectiveInvoice,
            customerId: previewCustomerId,
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
  }, [previewData, invoice, advance, previewCustomerId]);
  const total = preview.b?.totalPaise ?? 0,
    settlement = paymentSelection(invoice, total);
  // Rates missing for a product on this bill — the calc throws and the
  // bill cannot be made, so say so plainly (in Hindi) as soon as the
  // product is added, with a one-tap way to enter the rate.
  const missingRates = useMemo(() => {
    const rates = currentRates(data.rates);
    const seen = new Set<string>();
    const missing: { metal: string; purity: string }[] = [];
    for (const l of invoice.items) {
      const p = data.products.find((p) => p.id === l.productId);
      if (!p) continue;
      const k = p.metal + " " + p.purity;
      if (seen.has(k)) continue;
      seen.add(k);
      if (
        !rates.some((r) => r.metal === p.metal && r.purity === p.purity)
      )
        missing.push({ metal: p.metal, purity: p.purity });
    }
    return missing;
  }, [data.rates, data.products, invoice.items]);
  // Udhar (partial payment) without a customer cannot finalize — the
  // balance has to go to somebody's khata. A name typed in section 01
  // counts: saving creates that customer, so the warning only shows
  // when no customer info is there at all.
  const balancePaise = total - paise(invoice.paid);
  const customerReady = !!invoice.customerId || custName.trim() !== "";
  const needsCustomer =
    invoice.type !== "Estimate" &&
    !advance &&
    !customerReady &&
    total > 0 &&
    paise(invoice.paid) < total;
  // The calc's two confusing English prompts, in plain Hindi.
  const friendlyError = (msg: string) => {
    if (!msg) return msg;
    if (msg === "Select a customer for a credit or partial payment.")
      return "Udhar baki hai — upar 01 Customer me naam likho.";
    const rate = msg.match(/^Add an effective rate for (.+)\.$/);
    if (rate)
      return `${rate[1]} ka rate dala nahi hai — bina rate ke bill nahi banega.`;
    return msg;
  };
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
  // Turn the customer fields typed in section 01 into a linked
  // customer before anything is saved: a matching mobile reuses the
  // old record, a typed name creates a new one, blank stays walk-in.
  // Returns the id to save with, plus the new record (if any) so the
  // bill can be calculated against data that already has it — the
  // screen's `data` only refreshes after the next render.
  const resolveCustomer = async (): Promise<{
    customerId: string;
    extra?: Customer;
  }> => {
    if (invoice.customerId) return { customerId: invoice.customerId };
    const res = resolveBillCustomer(
      data.customers,
      { name: custName, phone: custPhone, address: custAddress },
      { required: needsCustomer || advance },
    );
    if ("error" in res) throw Error(res.error);
    if (res.create) {
      await perform("customer", res.create);
      I((s) => ({ ...s, customerId: res.customerId }));
      notify("Customer save ho gaya.");
      return { customerId: res.customerId, extra: res.create };
    }
    return { customerId: res.customerId };
  };
  const paymentInput = (customerId?: string) => {
    const input = draftSchema.parse({
      ...effectiveInvoice,
      ...(customerId !== undefined ? { customerId } : {}),
      settlement,
      ...(advance ? { settlement: "full" } : {}),
    });
    allocations(input);
    return input;
  };
  const reviewPayment = (customerId?: string, extraCustomer?: Customer) => {
    E("");
    try {
      const input = paymentInput(customerId);
      const d = extraCustomer
        ? { ...data, customers: [...data.customers, extraCustomer] }
        : data;
      const b = calculateInvoice(
        d,
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
  // Finalize: resolve the customer first, then review the payment.
  const finalizeFlow = async () => {
    if (busy) return;
    B(true);
    E("");
    try {
      const { customerId, extra } = await resolveCustomer();
      if (advance && !customerId)
        throw Error("Advance ke liye upar 01 Customer me naam likho.");
      reviewPayment(customerId, extra);
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
    }
  };
  // Save draft: same customer resolution, then the draft as usual.
  const draftFlow = async () => {
    if (busy) return;
    B(true);
    E("");
    try {
      const { customerId } = await resolveCustomer();
      if (advance && !customerId)
        throw Error("Advance ke liye upar 01 Customer me naam likho.");
      await perform("draft", paymentInput(customerId));
      notify("Draft saved.");
      markSaved(document);
      nav("/billing", { replace: true });
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
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
    Q("");
  };
  // Add a brand-new piece straight from the bill: the form's rate
  // becomes the current rate for that metal + purity, the lagat
  // becomes the piece's cost, and the piece goes on the bill at once.
  const quickAdd = async () => {
    if (qaBusy) return;
    const category =
      qaCategory === OTHER_OPTION ? qaCatOther.trim() : qaCategory;
    const type =
      qaTypeOptions.length > 0
        ? qaType === OTHER_OPTION
          ? qaTypeOther.trim()
          : qaType
        : qaTypeOther.trim();
    const metal = qaMetal === OTHER_OPTION ? qaMetalOther.trim() : qaMetal;
    const purity =
      qaPurityOptions.length > 0
        ? qaPurity === OTHER_OPTION
          ? qaPurityOther.trim()
          : qaPurity
        : qaPurityOther.trim();
    const weight = Number(qaWeight),
      rate = Number(qaRate),
      lagat = Number(qaLagat || 0),
      making = Number(qaMaking || 0);
    if (!category) {
      E("Category chuno ya likho.");
      return;
    }
    if (!type) {
      E("Item ka type chuno ya likho.");
      return;
    }
    if (!metal) {
      E("Metal chuno ya likho.");
      return;
    }
    if (!purity) {
      E("Purity chuno ya likho.");
      return;
    }
    if (!(weight > 0)) {
      E("Vazan (gram) likho.");
      return;
    }
    if (!(rate > 0)) {
      E("Rate per gram likho.");
      return;
    }
    if (lagat < 0 || making < 0) {
      E("Lagat aur making 0 ya usse zyada honi chahiye.");
      return;
    }
    setQaBusy(true);
    E("");
    try {
      const product = buildQuickProduct({
        category,
        type,
        metal,
        purity,
        rate,
        weight,
        lagat,
        making,
      });
      await perform("product", product);
      const rateRec = rateUpsertFor(data.rates, metal, purity, rate);
      if (rateRec) await perform("rate", rateRec);
      I((s) => ({ ...s, items: [...s.items, newLine(product)] }));
      setQaWeight("");
      setQaLagat("");
      setQaMaking("");
      notify("Item bill me jud gaya.");
    } catch (e) {
      E(err(e));
    } finally {
      setQaBusy(false);
    }
  };
  // Fix a missing rate right inside its warning: the typed rate is
  // recorded at once, and the bill's amount appears immediately.
  const fixRate = async (metal: string, purity: string) => {
    const k = metal + " " + purity;
    const rate = Number(fixRates[k] ?? "");
    if (!(rate > 0)) {
      E(`${metal} ${purity} ka rate likho.`);
      return;
    }
    setFixBusy(k);
    try {
      const rec = rateUpsertFor(data.rates, metal, purity, rate);
      if (rec) await perform("rate", rec);
      setFixRates((s) => {
        const n = { ...s };
        delete n[k];
        return n;
      });
      notify("Rate save ho gaya — bill ka amount aa gaya.");
    } catch (e) {
      E(err(e));
    } finally {
      setFixBusy("");
    }
  };
  const saveFinal = async () => {
    if (busy) return;
    B(true);
    E("");
    try {
      if (!review) throw Error("Review the payment before finalizing.");
      await perform("invoice", review);
      notify(
        invoice.type === "Estimate"
          ? "Estimate saved."
          : advance
            ? "Advance recorded on customer account."
            : "Invoice finalized and stock posted.",
      );
      markSaved(document);
      nav("/billing/" + invoice.id, { replace: true });
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
        subtitle="Customer, item, rate aur payment — sab kuch ek hi screen par."
      />
      <div
        className="editor-grid"
        data-unsaved={JSON.stringify(initial) !== JSON.stringify(invoice)}
        data-saving={busy}
      >
        <div className="stack">
          <section className="panel form-panel">
            <h2>
              <span className="step-index">01</span>Customer
            </h2>
            <div className="form-grid">
              <Field label="Customer ka naam">
                <input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="e.g. Ramesh Kumar"
                />
              </Field>
              <Field label="Mobile number">
                <input
                  value={custPhone}
                  onChange={(e) => onCustPhone(e.target.value)}
                  placeholder="e.g. 98765 43210"
                  inputMode="tel"
                />
              </Field>
              <Field label="Address" full>
                <input
                  value={custAddress}
                  onChange={(e) => setCustAddress(e.target.value)}
                  placeholder="Gaon / mohalla, sheher"
                />
              </Field>
              {matchedCustomer && (
                <p className="muted">
                  Purana grahak mil gaya — naam aur address bhar gaya hai.
                </p>
              )}
              <Field label="Bill ka type">
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
                      return {
                        ...s,
                        type,
                        // New GST invoices start with the shop's usual %;
                        // the selector below can change it per bill.
                        ...(type === "GST invoice" &&
                        s.gstPercent === undefined
                          ? { gstPercent: defaultGstPercent(data.profile) }
                          : {}),
                      };
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
              {invoice.type === "GST invoice" && (
                <Field label="GST %">
                  <Select
                    value={
                      invoice.gstPercent ?? defaultGstPercent(data.profile)
                    }
                    onChange={(e) => change("gstPercent", +e.target.value)}
                  >
                    {GST_PERCENT_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}%
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
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
                  <span className="step-index">02</span>Item jodo
                </h2>
                <span className="count-pill">{invoice.items.length} items</span>
              </div>
              <label className="search-input full-search">
                <Search size={16} />
                <input
                  placeholder="Stock me khojo — naam ya SKU…"
                  value={query}
                  onChange={(e) => Q(e.target.value)}
                />
              </label>
              {query.trim() !== "" && (
                <div className="pick-list">
                  {data.products
                    .filter((p) =>
                      (p.name + p.sku)
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .slice(0, 6)
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
                  {!data.products.some((p) =>
                    (p.name + p.sku)
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  ) && (
                    <p className="muted">
                      Stock me nahi mila — neeche naya item bharo.
                    </p>
                  )}
                </div>
              )}
              {!invoice.items.length ? (
                <div className="item-placeholder">
                  <ReceiptText size={25} />
                  <strong>Add your first item</strong>
                  <p>Upar stock me khojo, ya neeche naya item bharo.</p>
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
              {missingRates.map(({ metal, purity }) => (
                <div
                  className="bill-alert"
                  role="alert"
                  key={metal + " " + purity}
                >
                  <div>
                    <strong>
                      {metal} {purity} ka rate dala nahi hai — bina rate ke
                      bill nahi banega.
                    </strong>
                    <p>
                      Yahin rate likho — kisi aur page par jaane ki jarurat
                      nahi hai.
                    </p>
                  </div>
                  <div className="form-grid">
                    <Field label={`${metal} ${purity} — Rate per gram (₹)`}>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="e.g. 11440"
                        value={fixRates[metal + " " + purity] ?? ""}
                        onChange={(e) =>
                          setFixRates((s) => ({
                            ...s,
                            [metal + " " + purity]: e.target.value,
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <div className="bill-alert-actions">
                    <button
                      className="btn primary"
                      disabled={fixBusy === metal + " " + purity}
                      onClick={() => fixRate(metal, purity)}
                    >
                      {fixBusy === metal + " " + purity
                        ? "Save ho raha hai…"
                        : "Rate save karo"}
                    </button>
                  </div>
                </div>
              ))}
              <h3 className="spaced">Naya item — seedha bill par bharo</h3>
              <div className="form-grid">
                <Field label="Category">
                  <Select
                    value={qaCategory}
                    onChange={(e) => {
                      const c = e.target.value;
                      setQaCategory(c);
                      setQaType(
                        c === OTHER_OPTION
                          ? ""
                          : (typesFor(c)[0] ?? ""),
                      );
                    }}
                  >
                    {PRODUCT_CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                    <option>{OTHER_OPTION}</option>
                  </Select>
                </Field>
                {qaCategory === OTHER_OPTION && (
                  <Field label="Custom category">
                    <input
                      value={qaCatOther}
                      onChange={(e) => setQaCatOther(e.target.value)}
                      placeholder="e.g. Kamarbandh"
                    />
                  </Field>
                )}
                {qaTypeOptions.length > 0 ? (
                  <Field label="Type">
                    <Select
                      value={qaType}
                      onChange={(e) => setQaType(e.target.value)}
                    >
                      {qaTypeOptions.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                      <option>{OTHER_OPTION}</option>
                    </Select>
                  </Field>
                ) : (
                  <Field label="Type">
                    <input
                      value={qaTypeOther}
                      onChange={(e) => setQaTypeOther(e.target.value)}
                      placeholder="e.g. Kamarbandh"
                    />
                  </Field>
                )}
                {qaType === OTHER_OPTION && qaTypeOptions.length > 0 && (
                  <Field label="Custom type">
                    <input
                      value={qaTypeOther}
                      onChange={(e) => setQaTypeOther(e.target.value)}
                      placeholder="e.g. Temple"
                    />
                  </Field>
                )}
                <Field label="Metal">
                  <Select value={qaMetal} onChange={(e) => onQaMetal(e.target.value)}>
                    {METALS.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                    <option>{OTHER_OPTION}</option>
                  </Select>
                </Field>
                {qaMetal === OTHER_OPTION && (
                  <Field label="Custom metal">
                    <input
                      value={qaMetalOther}
                      onChange={(e) => setQaMetalOther(e.target.value)}
                      placeholder="e.g. Copper"
                    />
                  </Field>
                )}
                {qaPurityOptions.length > 0 ? (
                  <Field label="Purity">
                    <Select
                      value={qaPurity}
                      onChange={(e) => onQaPurity(e.target.value)}
                    >
                      {qaPurityOptions.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                      <option>{OTHER_OPTION}</option>
                    </Select>
                  </Field>
                ) : (
                  <Field label="Purity">
                    <input
                      value={qaPurityOther}
                      onChange={(e) => setQaPurityOther(e.target.value)}
                      placeholder="e.g. 22K"
                    />
                  </Field>
                )}
                {qaPurity === OTHER_OPTION && qaPurityOptions.length > 0 && (
                  <Field label="Custom purity">
                    <input
                      value={qaPurityOther}
                      onChange={(e) => setQaPurityOther(e.target.value)}
                      placeholder="e.g. 21K"
                    />
                  </Field>
                )}
                <Field label="Rate per gram (₹)">
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={qaRate}
                    onChange={(e) => setQaRate(e.target.value)}
                    placeholder="e.g. 11440"
                  />
                </Field>
                <Field label="Lagat — khareed bhav (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={qaLagat}
                    onChange={(e) => setQaLagat(e.target.value)}
                    placeholder="e.g. 50000"
                  />
                </Field>
                <Field label="Vazan (gram)">
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={qaWeight}
                    onChange={(e) => setQaWeight(e.target.value)}
                    placeholder="e.g. 5"
                  />
                </Field>
                <Field label="Making (₹)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={qaMaking}
                    onChange={(e) => setQaMaking(e.target.value)}
                    placeholder="e.g. 500"
                  />
                </Field>
              </div>
              <button
                className="btn outline full-btn"
                disabled={qaBusy}
                onClick={quickAdd}
              >
                <Plus size={16} />
                {qaBusy ? "Jod rahe hain…" : "Item jodo"}
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
                  <dt>
                    GST
                    {preview.b?.lines[0]
                      ? ` (${preview.b.lines[0].taxPercent}%)`
                      : ""}
                  </dt>
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
              {needsCustomer && (
                <div className="bill-alert" role="alert">
                  <div>
                    <strong>
                      {rupee(balancePaise, 2)} udhar baki hai — kisike
                      khaate me likhna hai.
                    </strong>
                    <p>
                      Upar 01 Customer me naam likho — bina naam ke udhar
                      wala bill finalize nahi hoga. Ya Full payment karo.
                    </p>
                  </div>
                  <div className="bill-alert-actions">
                    <button
                      className="btn primary"
                      onClick={() => setPayment(total / 100, "full")}
                    >
                      Full payment karo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Problem message={friendlyError(error || preview.e)} />
          <button
            disabled={busy || !preview.b}
            className="btn primary full-btn"
            onClick={finalizeFlow}
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
            onClick={draftFlow}
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
            onClick={saveFinal}
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
    notify = useToast(),
    nav = useNavigate();
  const [voiding, V] = useState(false),
    [deleting, setDeleting] = useState(false),
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
        {!b.voidedAt && !b.convertedTo && (
          <button
            className="btn danger-outline"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={14} />
            Delete permanently
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
      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete this bill permanently?"
      >
        <p className="muted">
          {b.number} will be gone for good — the bill, its payments and
          its stock movements are deleted, and no record is left to
          audit. Stock is restored, like a void — but unlike a void,
          nothing is kept. Use “Void document” instead if you need an
          audit trail.
        </p>
        <div className="modal-actions">
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              B(true);
              try {
                await perform("deleteInvoice", { id: b.id });
                notify("Bill deleted permanently.");
                nav("/billing");
              } catch (e) {
                E(err(e));
                setDeleting(false);
              } finally {
                B(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Yes, delete permanently"}
          </button>
        </div>
      </Modal>
    </>
  );
}
