import { describe, it, expect } from "vitest";
import {
  calculateInvoice,
  paymentSelection,
  assertReviewedPayment,
  postings,
  paise,
  currentRates,
} from "../functions/src/core/billing";
import { accountDelta } from "../functions/src/core/documents";
import {
  makeProfile,
  emptyWorkspace,
  type Product,
  type InvoiceInput,
  type Workspace,
  productSchema,
  invoiceSchema,
} from "../functions/src/core/model";
const date = "2026-06-01T10:00:00.000Z";
const product: Product = {
  id: "a",
  name: "Test item",
  category: "Rings",
  sku: "TEST-1",
  metal: "Gold",
  purity: "22K",
  stock: 3,
  gross: 5.125,
  stone: 0.321,
  deduction: 0.004,
  cost: 19000,
  makingMode: "Per gram",
  making: 200,
  hsn: "7113",
  huid: "",
};
function data(): Workspace {
  const d = emptyWorkspace({
    ...makeProfile("Test shop", "Owner", ""),
    gstin: "23ABCDE1234F1Z5",
    gstRegistered: true,
    taxes: [
      { hsn: "7113", percent: 2.5, effective: "2026-01-01" },
      { hsn: "7113", percent: 4, effective: "2026-07-01" },
    ],
  });
  d.products = [product];
  d.customers = [
    {
      id: "c",
      name: "Test customer",
      email: "",
      address: "",
      phone: "",
      gstin: "",
    },
  ];
  d.rates = [
    {
      id: "r1",
      metal: "Gold",
      purity: "22K",
      rate: 5000,
      effectiveAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "r2",
      metal: "Gold",
      purity: "22K",
      rate: 9000,
      effectiveAt: "2026-07-01T00:00:00.000Z",
    },
  ];
  return d;
}
const input = (): InvoiceInput => ({
  id: "txn1",
  customerId: "c",
  type: "Non-GST bill",
  items: [
    {
      productId: "a",
      quantity: 1,
      makingMode: "Per gram",
      making: 200,
      wastagePct: 0,
      stoneValue: 0,
      otherCharges: 0,
      discount: 0,
    },
  ],
  paid: 1000,
  mode: "UPI",
});
describe("Precise shared billing", () => {
  it("deducts stone and other weight before valuing gold and per-gram making", () => {
    const b = calculateInvoice(data(), input(), date, "INV-1");
    expect(b.lines[0].net).toBe(4.8);
    expect(b.lines[0].metalPaise).toBe(2400000);
    expect(b.totalPaise).toBe(2496000);
    expect(b.balancePaise).toBe(2396000);
  });
  it("uses the effective tax classification, not a constant GST rate", () => {
    const d = data(),
      i = input();
    i.type = "GST invoice";
    const b = calculateInvoice(d, i, date, "GST-1");
    expect(b.lines[0].taxPercent).toBe(2.5);
    expect(b.taxPaise).toBe(62400);
    d.rates[0].rate = 100;
    d.profile.shopName = "Renamed";
    expect(b.lines[0].rate).toBe(5000);
    expect(b.shop.shopName).toBe("Test shop");
  });
  it("rejects a missing effective HSN rule and an unregistered GST shop", () => {
    const d = data(),
      i = input();
    i.type = "GST invoice";
    d.profile.taxes = [];
    expect(() => calculateInvoice(d, i, date, "x")).toThrow("HSN");
    d.profile.gstRegistered = false;
    expect(() => calculateInvoice(d, i, date, "x")).toThrow("registered");
  });
  it("combines silver, diamond and gold independently with fixed and percentage making", () => {
    const d = data(),
      i = input();
    for (const [id, metal, rate] of [
      ["s", "Silver", 100],
      ["d", "Diamond", 10000],
    ] as const) {
      d.products.push({ ...product, id, metal });
      d.rates.push({ ...d.rates[0], id: "r" + id, metal, rate });
      i.items.push({
        ...i.items[0],
        productId: id,
        makingMode: id === "s" ? "Fixed" : "Percentage",
        making: id === "s" ? 100 : 10,
      });
    }
    const b = calculateInvoice(d, i, date, "mixed");
    expect(b.lines.map((x) => x.totalPaise)).toEqual([2496000, 58000, 5280000]);
    expect(b.lines.map((x) => x.costPaise)).toEqual([
      1900000, 1900000, 1900000,
    ]);
    expect(b.taxPaise).toBe(0);
  });
  it("bills a Silver 925 item from its own rate, and refuses without one", () => {
    const d = data(),
      i = input();
    d.products = [
      {
        ...product,
        id: "s925",
        name: "Silver anklet pair",
        category: "Anklets",
        metal: "Silver",
        purity: "925",
        gross: 10,
        stone: 0,
        deduction: 0,
        cost: 900,
        makingMode: "Fixed",
        making: 200,
      },
    ];
    d.rates = [
      {
        id: "rs925",
        metal: "Silver",
        purity: "925",
        rate: 160,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    i.items = [
      {
        productId: "s925",
        quantity: 1,
        makingMode: "Fixed",
        making: 200,
        wastagePct: 0,
        stoneValue: 0,
        otherCharges: 0,
        discount: 0,
      },
    ];
    const b = calculateInvoice(d, i, date, "silver-925");
    expect(b.lines[0].net).toBe(10);
    expect(b.lines[0].metalPaise).toBe(160000);
    expect(b.lines[0].totalPaise).toBe(180000);
    expect(b.totalPaise).toBe(180000);
    d.rates = [];
    expect(() => calculateInvoice(d, i, date, "silver-925")).toThrow(
      "Add an effective rate for Silver 925.",
    );
  });
  it("rounds money half-up, applies quantity, wastage and discount before tax", () => {
    expect(paise("0.005")).toBe(1);
    const i = input();
    Object.assign(i.items[0], {
      quantity: 2,
      discount: 100,
      wastagePct: 1,
      stoneValue: 12,
      otherCharges: 2,
      makingMode: "Fixed",
      making: 10,
    });
    const b = calculateInvoice(data(), i, date, "x");
    expect(b.lines[0].net).toBe(9.6);
    expect(b.subtotalPaise).toBe(paise(48000 + 480 + 24 + 4 + 20 - 100));
  });
  it("honours optional rupee rounding and credit", () => {
    const d = data(),
      i = input();
    d.profile.roundOff = true;
    i.items[0].otherCharges = 0.55;
    i.paid = 0;
    const b = calculateInvoice(d, i, date, "x");
    expect(b.roundOffPaise).toBe(45);
    expect(b.balancePaise).toBe(b.totalPaise);
  });
  it("rejects overpayment, an excessive discount and anonymous debt", () => {
    const i = input();
    i.paid = 100000;
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow("exceeds");
    i.paid = 0;
    i.items[0].discount = 60000;
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow("Discount");
    i.items[0].discount = 0;
    i.customerId = "";
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow(
      "Select a customer",
    );
  });
  it("rejects overselling, unknown tenant products and duplicate product lines", () => {
    const i = input();
    i.items[0].quantity = 4;
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow("stock");
    i.items[0].quantity = 1;
    i.items.push(i.items[0]);
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow("Combine");
    i.items = [{ ...i.items[0], productId: "other-shop-item" }];
    expect(() => calculateInvoice(data(), i, date, "x")).toThrow("not found");
  });
  it("never applies a future rate to a past invoice", () => {
    const d = data();
    d.rates = d.rates.slice(1);
    expect(currentRates(d.rates, Date.parse(date))).toHaveLength(0);
    expect(() => calculateInvoice(d, input(), date, "x")).toThrow(
      "effective rate",
    );
  });
  it("estimates make no financial or inventory movements", () => {
    const i = input();
    i.type = "Estimate";
    expect(() => calculateInvoice(data(), i, date, "e")).toThrow("payment");
    i.paid = 0;
    i.items[0].quantity = 10;
    const b = calculateInvoice(data(), i, date, "EST-1");
    expect(postings(b)).toEqual({ movements: [], received: 0, receivable: 0 });
  });
  it("full reversal negates all linked postings", () => {
    const b = calculateInvoice(data(), input(), date, "x"),
      a = postings(b),
      r = postings(b, true);
    expect(a.movements[0].delta + r.movements[0].delta).toBe(0);
    expect(a.received + r.received).toBe(0);
    expect(a.receivable + r.receivable).toBe(0);
  });
  it("validates precision, positive net weight and legal document references", () => {
    expect(
      productSchema.safeParse({ ...product, gross: 1, stone: 2 }).success,
    ).toBe(false);
    expect(productSchema.safeParse({ ...product, gross: 5.1255 }).success).toBe(
      false,
    );
    expect(
      invoiceSchema.safeParse({ ...input(), id: "wrong/path" }).success,
    ).toBe(false);
  });
});

describe("Draft payment intent", () => {
  it("reads legacy amounts without replacing zero, including when the quote is zero", () => {
    expect(paymentSelection({ paid: 0 }, 0)).toBe("part");
    expect(paymentSelection({ paid: 0 }, 500000)).toBe("part");
    expect(paymentSelection({ paid: 2000 }, 500000)).toBe("part");
    expect(paymentSelection({ paid: 5000 }, 500000)).toBe("full");
    expect(paymentSelection({ paid: 5000, settlement: "part" }, 500000)).toBe(
      "part",
    );
  });
  it("does not top up a full payment when the quote changes; re-review is required", () => {
    const d = data(),
      i = input();
    i.paid = 24960;
    i.settlement = "full";
    const reviewed = calculateInvoice(d, i, date, "Preview");
    d.rates[0].rate += 10;
    expect(() => calculateInvoice(d, i, date, "New price")).toThrow(
      "Full payment must match",
    );
    i.settlement = "part";
    const repriced = calculateInvoice(d, i, date, "New price");
    expect(repriced.paidPaise).toBe(reviewed.paidPaise);
    expect(() => assertReviewedPayment(repriced, reviewed)).toThrow(
      "balance changed",
    );
  });
});

describe("Shopkeeper demo flow (25 Nov 2026)", () => {
  // Ajay's exact shop-counter scenario: a 22K gold ring, 5 g at
  // ₹500/g (metal ₹2,500) + Fixed making ₹100 = ₹2,600 total.
  const demoData = () => {
    const d = data();
    d.products = [
      {
        ...product,
        id: "ring",
        name: "Classic gold band",
        category: "Rings",
        metal: "Gold",
        purity: "22K",
        gross: 5,
        stone: 0,
        deduction: 0,
        stock: 10,
        cost: 0,
        makingMode: "Fixed",
        making: 100,
      },
    ];
    d.rates = [
      {
        id: "r-gold-22k",
        metal: "Gold",
        purity: "22K",
        rate: 500,
        effectiveAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    return d;
  };
  const demoInput = (): InvoiceInput => ({
    id: "demo1",
    customerId: "",
    type: "Non-GST bill",
    items: [
      {
        productId: "ring",
        quantity: 1,
        makingMode: "Fixed",
        making: 100,
        wastagePct: 0,
        stoneValue: 0,
        otherCharges: 0,
        discount: 0,
      },
    ],
    paid: 2000,
    settlement: "part",
    mode: "Cash",
  });

  it("refuses a bill when the product's metal rate was never recorded, naming it", () => {
    const d = demoData();
    d.rates = [];
    expect(() => calculateInvoice(d, demoInput(), date, "x")).toThrow(
      "Add an effective rate for Gold 22K.",
    );
  });

  it("refuses a partial payment with no customer, because the udhar needs a khata", () => {
    const d = demoData(),
      i = demoInput();
    expect(() => calculateInvoice(d, i, date, "x")).toThrow(
      "Select a customer for a credit or partial payment.",
    );
  });

  it("finalizes the same ₹2,600 / ₹2,000 bill with a customer and posts ₹600 to their khata", () => {
    const d = demoData(),
      i = demoInput();
    i.customerId = "c";
    const b = calculateInvoice(d, i, date, "demo-2600");
    expect(b.totalPaise).toBe(260000);
    expect(b.lines[0].metalPaise).toBe(250000);
    expect(b.paidPaise).toBe(200000);
    expect(b.balancePaise).toBe(60000);
    expect(b.customer?.id).toBe("c");
    // The ₹600 balance is the customer's outstanding (udhar).
    expect(accountDelta(b)).toBe(60000);
  });
});
