import { describe, it, expect } from "vitest";
import {
  calculateInvoice,
  assertDraftPayment,
  postings,
  saleInvoices,
} from "../functions/src/core/billing";
import {
  accountDelta,
  allocations,
  documentNumber,
  taxComponents,
} from "../functions/src/core/documents";
import { approvedMark } from "../functions/src/core/authorization";
import {
  emptyWorkspace,
  makeProfile,
  profileSchema,
  finalizeSchema,
  type InvoiceInput,
} from "../functions/src/core/model";
import { amountInWords } from "../src/lib/paper";
import { demoMutation } from "../src/lib/demo";
const at = "2026-01-02T00:00:00.000Z";
function fixture() {
  const data = emptyWorkspace({
    ...makeProfile("Test Studio", "Owner", ""),
    prefix: "TS",
  });
  data.products.push({
    id: "a",
    sku: "A",
    name: "Payal",
    category: "Anklet",
    metal: "Silver",
    purity: "925",
    stock: 5,
    gross: 10,
    stone: 0,
    deduction: 0,
    cost: 200,
    makingMode: "Fixed",
    making: 200,
    hsn: "7113",
    huid: "",
  });
  data.rates.push({
    id: "r",
    metal: "Silver",
    purity: "925",
    rate: 200,
    effectiveAt: "2025-12-31T00:00:00.000Z",
  });
  data.customers.push({
    id: "c",
    name: "Buyer",
    email: "",
    phone: "",
    address: "",
    gstin: "",
  });
  const input: InvoiceInput = {
    id: "test",
    customerId: "c",
    type: "Non-GST bill",
    items: [
      {
        productId: "a",
        quantity: 1,
        makingMode: "Fixed",
        making: 200,
        discount: 100,
        stoneValue: 0,
        otherCharges: 0,
        wastagePct: 0,
      },
    ],
    mode: "UPI",
    paid: 100,
    settlement: "part",
  };
  return { data, input };
}
describe("Issue-time document evidence", () => {
  it("Silver Payal: ₹2,000 + ₹200 − ₹100 = ₹2,100, without GST", () => {
    const { data, input } = fixture();
    const b = calculateInvoice(data, input, at, "TS-1");
    expect([
      b.lines[0].net,
      b.lines[0].metalPaise,
      b.lines[0].makingPaise,
      b.lines[0].discountPaise,
      b.taxPaise,
      b.totalPaise,
    ]).toEqual([10, 200000, 20000, 10000, 0, 210000]);
    expect(b.lines[0].components).toBeUndefined();
  });
  for (const [where, expected] of [
    ["23", { CGST: 3150, SGST: 3150 }],
    ["27", { IGST: 6300 }],
  ] as const)
    it(`effective HSN + actual destination ${where} freeze correct tax components`, () => {
      const { data, input } = fixture();
      Object.assign(data.profile, {
        gstRegistered: true,
        gstin: "23ABCDE1234F1Z5",
        taxes: [{ hsn: "7113", effective: "2026-01-01", percent: 3 }],
      });
      const b = calculateInvoice(
        data,
        { ...input, type: "GST invoice", placeOfSupply: where },
        at,
        "T",
      );
      expect(b.lines[0].components).toEqual(expected);
      expect(b.totalPaise).toBe(216300);
    });
  it("GST needs an explicit domestic supply jurisdiction; UT GST is not SGST", () => {
    const { input } = fixture();
    expect(() =>
      finalizeSchema.parse({
        ...input,
        type: "GST invoice",
        confirmation: { totalPaise: 0, balancePaise: 0 },
      }),
    ).toThrow(/place of supply/);
    expect(() => taxComponents("23ABCDE1234F1Z5", "99", 100, 3)).toThrow();
    expect(taxComponents("04ABCDE1234F1Z5", "04", 101, 3)).toEqual({
      CGST: 2,
      UTGST: 2,
    });
  });
  it("split is one collection, allocated by mode; changed allocation cannot replace a draft", () => {
    const { data, input } = fixture();
    const s: InvoiceInput = {
      ...input,
      mode: "Split",
      tenders: [
        { mode: "UPI", amount: 60 },
        { mode: "Cash", amount: 40 },
      ],
    };
    const b = calculateInvoice(data, s, at, "X");
    expect(allocations(s)).toEqual([
      { mode: "Cash", amountPaise: 4000 },
      { mode: "UPI", amountPaise: 6000 },
    ]);
    expect(postings(b).received).toBe(10000);
    expect(postings(b, true).received).toBe(-10000);
    expect(() =>
      assertDraftPayment(
        {
          ...s,
          tenders: [
            { mode: "Cash", amount: 30 },
            { mode: "UPI", amount: 70 },
          ],
        },
        s,
      ),
    ).toThrow(/saved draft/);
  });
  it("rejects duplicate tenders, hidden allocations and nonmatching totals", () => {
    const { input } = fixture();
    for (const [mode, tenders] of [
      [
        "Split",
        [
          { mode: "Bank", amount: 40 },
          { mode: "Bank", amount: 60 },
        ],
      ],
      [
        "Split",
        [
          { mode: "Bank", amount: 50 },
          { mode: "Card", amount: 51 },
        ],
      ],
      [
        "Cash",
        [
          { mode: "Bank", amount: 50 },
          { mode: "Cash", amount: 50 },
        ],
      ],
    ] as const)
      expect(() =>
        allocations({ ...input, mode, tenders: [...tenders] }),
      ).toThrow();
  });
  it("does not re-issue an estimate as a sale, move stock or use a fixed shop series", () => {
    const { data, input } = fixture();
    const b = calculateInvoice(
      data,
      { ...input, type: "Estimate", paid: 0 },
      at,
      documentNumber(data.profile, "Estimate", 1),
    );
    expect(b.number).toBe("TS/E-00001");
    expect(postings(b)).toEqual({ received: 0, receivable: 0, movements: [] });
    expect(saleInvoices({ ...data, invoices: [b] })).toHaveLength(0);
  });
  it("advances credit the account once; full-sale credit notes reverse the sale only", () => {
    const { data, input } = fixture();
    let w = demoMutation(data, "invoice", {
      ...input,
      id: "deposit",
      type: "Advance receipt",
      items: [],
      advanceFor: "Custom order",
      paid: 50,
      confirmation: { totalPaise: 5000, balancePaise: 0 },
    });
    expect(postings(w.invoices[0])).toEqual({
      received: 5000,
      receivable: -5000,
      movements: [],
    });
    expect(w.products[0].stock).toBe(5);
    w = demoMutation(w, "invoice", {
      ...input,
      confirmation: { totalPaise: 210000, balancePaise: 200000 },
    });
    expect(w.invoices[1].previousBalancePaise).toBe(-5000);
    expect(w.products[0].stock).toBe(4);
    w = demoMutation(w, "void", { id: input.id, reason: "Full return" });
    expect(w.invoices[1].creditNote?.number).toBe("TS/C-00001");
    expect(w.products[0].stock).toBe(5);
    expect(saleInvoices(w)).toHaveLength(0);
    expect(
      w.invoices
        .filter((b) => !b.voidedAt)
        .reduce((n, b) => n + accountDelta(b), 0),
    ).toBe(-5000);
  });
  it("preserves Indian crore/lakh/thousand, paise, zero and the reviewed example", () => {
    expect(amountInWords(10602390)).toBe(
      "Rupees One Lakh Six Thousand Twenty Three and Ninety Paise Only",
    );
    expect(amountInWords(1234567890)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only",
    );
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(105)).toBe("Rupees One and Five Paise Only");
  });
  it("owner settings cannot authorize a mark; expiry, scope and reference are required", () => {
    const { data } = fixture(),
      a = {
        status: "verified",
        verifiedBy: "reviewer",
        reference: "Permit-T",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        validUntil: "2026-01-03T00:00:00.000Z",
        artwork: "data:image/png;base64,YQ==",
        types: ["Non-GST bill"],
      };
    expect(
      profileSchema.parse({ ...data.profile, authorizedMark: a }),
    ).not.toHaveProperty("authorizedMark");
    expect(approvedMark(a, "Estimate", Date.parse(at))).toBeNull();
    expect(
      approvedMark(a, "Non-GST bill", Date.parse(a.validUntil)),
    ).toBeNull();
    expect(
      approvedMark({ ...a, status: "revoked" }, "Non-GST bill", Date.parse(at)),
    ).toBeNull();
    expect(approvedMark(a, "Non-GST bill", Date.parse(at))?.reference).toBe(
      a.reference,
    );
  });
});
