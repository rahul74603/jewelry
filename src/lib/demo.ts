/** Disposable sample fixtures: never imported by the licensed production entry. */
import {
  makeProfile,
  emptyWorkspace,
  type Workspace,
  type Product,
  type InvoiceInput,
  type Action,
  type Rate,
  productSchema,
  profileSchema,
  customerSchema,
  rateSchema,
  draftSchema,
  finalizeSchema,
  adjustment,
  workspaceSchema,
  loanSchema,
  loanPaymentInputSchema,
  loanForfeitInputSchema,
  loanSettleInputSchema,
  loanCompoundInputSchema,
} from "../../functions/src/core/model";
import {
  forfeitedProduct,
  loanSummary,
  todayDay,
} from "../../functions/src/core/loans";
import {
  calculateInvoice,
  assertReviewedPayment,
  assertDraftPayment,
  postings,
} from "../../functions/src/core/billing";
import {
  allocations,
  accountDelta,
  documentNumber,
  isSale,
} from "../../functions/src/core/documents";
import type { PrefsStore } from "./backup";

/** localStorage key for the Demo (Customer APK) workspace. The Demo
 * build has no server, so the workspace lives here — without it, every
 * app restart re-ran `seedDemo()` and "Start fresh" (plus any bill,
 * customer or girvi the shopkeeper entered) was lost. */
export const DEMO_WORKSPACE_KEY = "aurum:demo-workspace-v1";

/** Minimal key/value store, same shape backup.ts uses: localStorage in
 * the Capacitor WebView, a memory store in tests. */
const localDemoStore: PrefsStore = {
  get: (key) => {
    try {
      return typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      if (typeof localStorage !== "undefined")
        localStorage.setItem(key, value);
    } catch (e) {
      // Quota / unavailable: warn, never swallow silently — a failed
      // save would resurrect the old workspace on the next launch.
      console.warn("Demo workspace could not be saved:", e);
    }
  },
};

/** Load the persisted Demo workspace. Missing, unreadable or invalid
 * data falls back to the sample workspace — and saves it, so the first
 * launch still shows sample data and later launches reload it. */
export function loadDemoWorkspace(
  store: PrefsStore = localDemoStore,
): Workspace {
  try {
    const raw = store.get(DEMO_WORKSPACE_KEY);
    if (raw)
      return workspaceSchema.parse(JSON.parse(raw)) as unknown as Workspace;
  } catch {
    // Corrupt / outdated payload: fall through to re-seeding below.
  }
  const seeded = seedDemo();
  saveDemoWorkspace(seeded, store);
  return seeded;
}

/** Persist the Demo workspace. A storage failure only warns — the
 * in-memory mutation still applies — but it is never silent, because
 * a failed save (e.g. after clearWorkspace / restore) would bring the
 * old workspace back on the next launch. */
export function saveDemoWorkspace(
  data: Workspace,
  store: PrefsStore = localDemoStore,
): void {
  try {
    store.set(DEMO_WORKSPACE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("Demo workspace could not be saved:", e);
  }
}

export function seedDemo(): Workspace {
  const profile = {
    ...makeProfile("Sample Jewellery Studio", "Studio Owner", ""),
    mobile: "",
    address: "",
    setupComplete: true,
  };
  const w = emptyWorkspace(profile);
  const metals: [string, string, number, number][] = [
    ["Gold", "22K", 11440, 82],
    ["Gold", "24K", 12480, 95],
    ["Silver", "999", 162.5, -1.2],
    ["Diamond", "Natural", 58000, 180],
    ["Gold", "18K", 9360, 65],
    ["Silver", "925", 150.3, -0.8],
  ];
  const now = Date.now();
  metals.forEach(([metal, purity, rate, change], n) =>
    [0, 1].forEach((k) =>
      w.rates.push({
        id: `rate-${n}-${k}`,
        metal,
        purity,
        rate: Number((rate - (k ? 0 : change)).toFixed(2)),
        effectiveAt: new Date(
          now - (k ? 0 : 90) * 86400000 - 60000,
        ).toISOString(),
      }),
    ),
  );
  const products: [
    string,
    string,
    string,
    string,
    number,
    number,
    number,
    number,
  ][] = [
    ["Heritage gold bangle", "Bangles", "Gold", "22K", 8.25, 0, 18, 82000],
    ["Lotus drop earrings", "Earrings", "Gold", "22K", 3.84, 0.12, 24, 37100],
    ["Classic gold band", "Rings", "Gold", "22K", 3.24, 0, 28, 31900],
    ["Silver anklet pair", "Anklets", "Silver", "999", 34.8, 0, 32, 4380],
    ["Lakshmi gold coin", "Coins", "Gold", "24K", 5, 0, 16, 55800],
    [
      "Petite diamond pendant",
      "Pendants",
      "Diamond",
      "Natural",
      1.28,
      0.08,
      3,
      61000,
    ],
    [
      "Temple gold necklace",
      "Necklaces",
      "Gold",
      "22K",
      15.22,
      0.48,
      8,
      151200,
    ],
    ["Silver filigree ring", "Rings", "Silver", "925", 4.62, 0, 4, 580],
    ["Everyday hoop earrings", "Earrings", "Gold", "18K", 2.32, 0, 20, 18600],
    ["Antique gold chain", "Necklaces", "Gold", "22K", 6.14, 0, 14, 61200],
  ];
  w.products = products.map(
    ([name, category, metal, purity, gross, stone, stock, cost], n) => ({
      id: `product-${n}`,
      sku: `AU-${String(n + 101).padStart(4, "0")}`,
      name,
      category,
      metal,
      purity,
      gross,
      stone,
      deduction: 0,
      stock,
      cost,
      makingMode: "Per gram",
      making: metal === "Silver" ? 18 : 650,
      hsn: "7113",
      huid: "",
    }),
  );
  w.customers = [
    "Meera Sharma",
    "Arjun Mehta",
    "Priya Patel",
    "Ananya Gupta",
    "Rajesh Verma",
    "Sneha Iyer",
    "Rohan Shah",
    "Kavya Jain",
  ].map((name, n) => ({
    id: `client-${n}`,
    name,
    phone: "",
    address: "",
    email: "",
    gstin: "",
  }));
  // Sample girvi + EMI records: one overdue girvi, one due-soon girvi
  // and one active EMI, so the due list and the reminders are visible.
  const dayISO = (offset: number) =>
    new Date(now + offset * 86400000).toISOString().slice(0, 10);
  const atISO = (offset: number) =>
    new Date(now + offset * 86400000).toISOString();
  w.loans = [
    {
      id: "loan-girvi-overdue",
      kind: "girvi" as const,
      customerId: "client-0",
      itemName: "Gold necklace 22K",
      itemMetal: "Gold",
      itemPurity: "22K",
      itemWeight: 12.5,
      principalPaise: 2000000,
      totalPaise: 2000000,
      upfrontPaise: 0,
      interestRatePct: 2,
      compound: false,
      startAt: dayISO(-75),
      dueAt: dayISO(-5),
      payments: [],
      status: "active" as const,
      createdAt: atISO(-75),
    },
    {
      id: "loan-girvi-soon",
      kind: "girvi" as const,
      customerId: "client-2",
      itemName: "Gold bangles pair 22K",
      itemMetal: "Gold",
      itemPurity: "22K",
      itemWeight: 8.25,
      principalPaise: 5000000,
      totalPaise: 5000000,
      upfrontPaise: 0,
      interestRatePct: 2,
      compound: false,
      startAt: dayISO(-40),
      dueAt: dayISO(5),
      payments: [
        {
          id: "loanpay-1",
          at: atISO(-10),
          amountPaise: 200000,
          mode: "Cash" as const,
          extraPaise: 0,
        },
      ],
      status: "active" as const,
      createdAt: atISO(-40),
    },
    {
      id: "loan-emi-1",
      kind: "emi" as const,
      customerId: "client-1",
      itemName: "Temple gold necklace",
      itemMetal: "Gold",
      itemPurity: "22K",
      itemWeight: 15.22,
      principalPaise: 10000000,
      totalPaise: 15120000,
      upfrontPaise: 5120000,
      interestRatePct: 1.5,
      compound: false,
      startAt: dayISO(-60),
      dueAt: dayISO(30),
      payments: [
        {
          id: "loanpay-2",
          at: atISO(-30),
          amountPaise: 1000000,
          mode: "UPI" as const,
          extraPaise: 0,
        },
      ],
      status: "active" as const,
      createdAt: atISO(-60),
    },
  ];
  let seq = 1000;
  const start = new Date(now + 19800000).toISOString().slice(0, 10);
  const midnight = Date.parse(start + "T00:00:00+05:30");
  const week = [
    [2, 3, 1, 0, 8, 6],
    [2, 0, 4, 1, 5],
    [8, 7, 3, 6],
    [1, 6, 2, 4],
    [5, 1, 4],
    [6, 3, 8, 1],
    [5, 2, 1],
  ];
  for (let day = 34; day >= 0; day--) {
    const count = week[day]?.length ?? [3, 4, 3, 5, 4, 3, 5][day % 7];
    for (let j = 0; j < count; j++) {
      const p =
          w.products[
            week[day]?.[j] ?? (day * 3 + j * 2 + (day % 3)) % w.products.length
          ],
        customer = w.customers[(day + j) % w.customers.length];
      const when = new Date(
        midnight -
          day * 86400000 +
          (day === 0
            ? Math.floor(((now - midnight) * (j + 1)) / (count + 1))
            : (10 + j * 1.4) * 3600000),
      ).toISOString();
      const input: InvoiceInput = {
        id: `document-${++seq}`,
        customerId: customer.id,
        type: "Non-GST bill",
        items: [newLine(p)],
        paid: 0,
        mode: (["UPI", "Cash", "Card", "Bank"] as const)[(day + j) % 4],
      };
      const b = calculateInvoice(
        w,
        input,
        when,
        `${profile.prefix}-${seq}`,
        false,
      );
      input.paid = Number(
        (
          (b.totalPaise / 100) *
          (day < 7 ? (j === 1 ? 0.4 : j === 2 ? 0.68 : 1) : 1)
        ).toFixed(2),
      );
      w.invoices.push(
        calculateInvoice(w, input, when, `${profile.prefix}-${seq}`, false),
      );
    }
  }
  return w;
}
/**
 * Minimal demo set for a fresh/empty workspace — one tap fills just
 * enough to make the first bill immediately: a Gold 22K rate, a
 * Silver 925 rate, one sample 22K ring and one demo customer. Rates
 * match the full sample workspace (seedDemo) so a demo bill prices
 * the same either way. The caller adds only the records that are not
 * already present (same metal+purity rate, same SKU, same customer
 * id), so pressing the button twice never duplicates anything.
 */
export function demoSampleRecords(now = new Date()): {
  rates: Rate[];
  products: Product[];
  customers: {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    gstin: string;
  }[];
} {
  const at = now.toISOString();
  return {
    rates: [
      {
        id: "demo-rate-gold-22k",
        metal: "Gold",
        purity: "22K",
        rate: 11440,
        effectiveAt: at,
      },
      {
        id: "demo-rate-silver-925",
        metal: "Silver",
        purity: "925",
        rate: 150.3,
        effectiveAt: at,
      },
    ],
    products: [
      {
        id: "demo-product-ring",
        sku: "DEMO-0001",
        name: "Classic gold band",
        category: "Rings",
        metal: "Gold",
        purity: "22K",
        gross: 3.24,
        stone: 0,
        deduction: 0,
        stock: 5,
        cost: 0,
        makingMode: "Per gram",
        making: 650,
        hsn: "7113",
        huid: "",
      },
    ],
    customers: [
      {
        id: "demo-customer-1",
        name: "Demo Grahak",
        phone: "",
        email: "",
        address: "",
        gstin: "",
      },
    ],
  };
}
export function newLine(p: Product) {
  return {
    productId: p.id,
    quantity: 1,
    makingMode: p.makingMode,
    making: p.making,
    wastagePct: 0,
    stoneValue: 0,
    otherCharges: 0,
    discount: 0,
  };
}
export function demoMutation(
  old: Workspace,
  action: Action,
  raw: unknown,
): Workspace {
  const d = structuredClone(old),
    at = new Date().toISOString();
  if (action === "profile") d.profile = profileSchema.parse(raw);
  else if (action === "customer") d.customers.push(customerSchema.parse(raw));
  else if (action === "product") d.products.push(productSchema.parse(raw));
  else if (action === "rate") d.rates.push(rateSchema.parse(raw));
  else if (action === "adjust") {
    const a = adjustment.parse(raw);
    const p = d.products.find((p) => p.id === a.productId);
    if (!p || p.stock + a.delta < 0)
      throw Error("Adjustment would create negative stock.");
    p.stock += a.delta;
  } else if (action === "draft") {
    const i = draftSchema.parse(raw);
    allocations(i);
    if (d.invoices.some((b) => b.id === i.id))
      throw Error("Already finalized.");
    d.drafts = d.drafts.filter((b) => b.id !== i.id);
    d.drafts.push({ ...i, updatedAt: at });
  } else if (action === "invoice") {
    const { confirmation, ...i } = finalizeSchema.parse(raw);
    if (d.invoices.some((b) => b.id === i.id))
      throw Error("This document was already finalized.");
    const source = d.invoices.find((b) => b.id === i.sourceEstimate);
    if (
      i.sourceEstimate &&
      (!source ||
        source.type !== "Estimate" ||
        source.voidedAt ||
        source.convertedTo)
    )
      throw Error("Estimate is no longer available.");
    const b = calculateInvoice(
      d,
      i,
      at,
      documentNumber(d.profile, i.type, 1001 + d.invoices.length),
    );
    assertReviewedPayment(b, confirmation);
    assertDraftPayment(
      i,
      d.drafts.find((draft) => draft.id === i.id),
    );
    if (b.customer && b.type !== "Estimate")
      b.previousBalancePaise = d.invoices
        .filter((x) => !x.voidedAt && x.customer?.id === b.customer?.id)
        .reduce((n, x) => n + accountDelta(x), 0);
    d.invoices.push(b);
    if (source) source.convertedTo = i.id;
    postings(b).movements.forEach((m) => {
      d.products.find((p) => p.id === m.productId)!.stock += m.delta;
    });
    d.drafts = d.drafts.filter((b) => b.id !== i.id);
  } else if (action === "void") {
    const b = d.invoices.find((b) => b.id === (raw as { id: string }).id);
    if (!b || b.voidedAt || b.convertedTo)
      throw Error("Document cannot be voided.");
    b.voidedAt = at;
    if (isSale(b))
      b.creditNote = {
        number: documentNumber(
          d.profile,
          "Credit note",
          1 + d.invoices.filter((x) => x.creditNote).length,
        ),
        issuedAt: at,
        reason: (raw as { reason: string }).reason,
        shop: {
          ...structuredClone(d.profile),
          gstin: b.shop.gstin,
          gstRegistered: b.shop.gstRegistered,
        },
      };
    postings(b, true).movements.forEach((m) => {
      d.products.find((p) => p.id === m.productId)!.stock += m.delta;
    });
  } else if (action === "deleteDraft") {
    const draftId = (raw as { id: string }).id;
    if (!d.drafts.some((x) => x.id === draftId))
      throw Error("Draft not found.");
    d.drafts = d.drafts.filter((x) => x.id !== draftId);
  } else if (action === "deleteInvoice") {
    // Permanent deletion — no record is kept, unlike void. Stock is
    // restored exactly as voiding would reverse it; payments and
    // receivables disappear with the invoice because they are derived
    // from it. Voided documents and converted estimates stay: the
    // audit trail needs them.
    const invoiceId = (raw as { id: string }).id;
    const b = d.invoices.find((x) => x.id === invoiceId);
    if (!b) throw Error("Invoice not found.");
    if (b.voidedAt)
      throw Error(
        "A voided document is kept for audit — it cannot be deleted.",
      );
    if (b.convertedTo)
      throw Error(
        "This estimate was already converted — it cannot be deleted.",
      );
    postings(b, true).movements.forEach((m) => {
      d.products.find((p) => p.id === m.productId)!.stock += m.delta;
    });
    // A converted sale bill held its source estimate hostage; free it
    // so the estimate can be converted again.
    const src = b.input.sourceEstimate
      ? d.invoices.find((x) => x.id === b.input.sourceEstimate)
      : undefined;
    if (src) delete src.convertedTo;
    d.invoices = d.invoices.filter((x) => x.id !== invoiceId);
  } else if (action === "clearWorkspace") {
    // Start fresh: keep the shop profile (name, bank details, tax
    // rules…), wipe every product, customer, bill, draft, loan and
    // rate on this phone. A backup must be made first — the caller
    // (Settings danger zone) says so before confirming.
    return emptyWorkspace(d.profile);
  } else if (action === "loan") {
    const l = loanSchema.parse(raw);
    if (d.loans.some((x) => x.id === l.id))
      throw Error("This girvi / EMI record already exists.");
    if (!d.customers.some((c) => c.id === l.customerId))
      throw Error("Customer not found.");
    d.loans.push(l);
  } else if (action === "loanPayment") {
    const { loanId, payment } = loanPaymentInputSchema.parse(raw);
    const l = d.loans.find((x) => x.id === loanId);
    if (!l) throw Error("Girvi / EMI record not found.");
    if (l.status === "forfeited")
      throw Error("This record is forfeited — no more payments.");
    if (l.status === "settled")
      throw Error("This record is settled (mamla khatam) — no more payments.");
    if (loanSummary(l).balancePaise <= 0)
      throw Error("This record is fully repaid.");
    if (payment.at.slice(0, 10) < l.startAt)
      throw Error("Payment cannot be before the start date.");
    // Manual payment: any amount is allowed. Excess over the balance
    // at the payment date is recorded as extra and closes the record
    // as repaid — the record never goes negative.
    const balance = loanSummary(l, payment.at.slice(0, 10)).balancePaise;
    const extra = Math.max(0, payment.amountPaise - balance);
    l.payments.push({ ...payment, extraPaise: extra });
  } else if (action === "loanSettle") {
    const { loanId, payment } = loanSettleInputSchema.parse(raw);
    const l = d.loans.find((x) => x.id === loanId);
    if (!l) throw Error("Girvi / EMI record not found.");
    if (l.status !== "active")
      throw Error("Only an active record can be settled.");
    if (payment.at.slice(0, 10) < l.startAt)
      throw Error("Payment cannot be before the start date.");
    const balance = loanSummary(l, payment.at.slice(0, 10)).balancePaise;
    if (balance <= 0) throw Error("This record is fully repaid.");
    if (payment.amountPaise >= balance)
      throw Error(
        "Settlement amount must be less than the balance due — for a full payment, use Record payment.",
      );
    l.payments.push({
      ...payment,
      note: payment.note?.trim() ? payment.note : "Settlement — mamla khatam",
    });
    l.status = "settled";
    l.settledAt = at;
    l.settlementAmountPaise = payment.amountPaise;
    l.waivedPaise = balance - payment.amountPaise;
  } else if (action === "loanCompound") {
    const { loanId, compound } = loanCompoundInputSchema.parse(raw);
    const l = d.loans.find((x) => x.id === loanId);
    if (!l) throw Error("Girvi / EMI record not found.");
    if (l.status !== "active")
      throw Error("Only an active record can change the interest type.");
    l.compound = compound;
  } else if (action === "loanForfeit") {
    const { loanId, note } = loanForfeitInputSchema.parse(raw);
    const l = d.loans.find((x) => x.id === loanId);
    if (!l) throw Error("Girvi / EMI record not found.");
    if (l.kind !== "girvi")
      throw Error("Only a girvi record can be forfeited.");
    if (l.status !== "active")
      throw Error("This record is already forfeited.");
    const balance = loanSummary(l, todayDay()).balancePaise;
    if (balance <= 0)
      throw Error("This record is fully repaid — nothing to forfeit.");
    l.status = "forfeited";
    l.forfeitedAt = at;
    if (note) l.forfeitNote = note;
    // The collateral becomes the shop's item, valued at the balance
    // still owed when it was forfeited.
    d.products.push(forfeitedProduct(l, balance));
  } else if (action === "restore") {
    // Whole-workspace replace from a backup file. The payload must be a
    // backup's data that already passed validateBackup() (checksum +
    // counts) in the UI — it is re-parsed here so a bad payload can never
    // silently wipe the workspace. No bypass, no merge: the backup wins.
    return structuredClone(workspaceSchema.parse(raw) as unknown as Workspace);
  } else throw Error("Unsupported sample operation.");
  return d;
}
