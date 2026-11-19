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
} from "../../functions/src/core/model";
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
  } else throw Error("Unsupported sample operation.");
  return d;
}
