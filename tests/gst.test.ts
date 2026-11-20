import { describe, it, expect } from "vitest";
import {
  calculateInvoice,
  defaultGstPercent,
} from "../functions/src/core/billing";
import { taxComponents } from "../functions/src/core/documents";
import {
  makeProfile,
  emptyWorkspace,
  type Product,
  type InvoiceInput,
  type Workspace,
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
    taxes: [{ hsn: "7113", percent: 2.5, effective: "2026-01-01" }],
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
  ];
  return d;
}
const input = (): InvoiceInput => ({
  id: "txn1",
  customerId: "c",
  type: "GST invoice",
  placeOfSupply: "23",
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
  paid: 0,
  mode: "Cash",
});
// Fixture math: net 4.8 g x Rs 5,000 = Rs 24,000 metal + Rs 960 making
// = Rs 24,960 taxable (2,496,000 paise) before any discount.
describe("Manual GST % on the Billing screen", () => {
  it("drives the tax without any HSN rule", () => {
    const d = data(),
      i = input();
    d.profile.taxes = [];
    i.gstPercent = 10;
    const b = calculateInvoice(d, i, date, "GST-1");
    expect(b.lines[0].taxPercent).toBe(10);
    expect(b.lines[0].taxablePaise).toBe(2496000);
    expect(b.taxPaise).toBe(249600);
    expect(b.totalPaise).toBe(2745600);
  });
  it("overrides the HSN rule for the whole bill", () => {
    const b = calculateInvoice(
      data(),
      { ...input(), gstPercent: 15 },
      date,
      "GST-2",
    );
    expect(b.lines[0].taxPercent).toBe(15);
    expect(b.taxPaise).toBe(374400);
  });
  it("still falls back to the HSN rule when no manual % is set", () => {
    const b = calculateInvoice(data(), input(), date, "GST-3");
    expect(b.lines[0].taxPercent).toBe(2.5);
    expect(b.taxPaise).toBe(62400);
  });
  it("defaults to the shop's latest rule when it is 5/10/15/20, else 5%", () => {
    const d = data();
    expect(defaultGstPercent(d.profile)).toBe(5);
    d.profile.taxes = [{ hsn: "7113", percent: 10, effective: "2026-01-01" }];
    expect(defaultGstPercent(d.profile)).toBe(10);
    d.profile.taxes = [
      { hsn: "7113", percent: 5, effective: "2026-01-01" },
      { hsn: "7113", percent: 20, effective: "2026-07-01" },
    ];
    expect(defaultGstPercent(d.profile)).toBe(20);
  });
});
describe("Discount is applied before GST", () => {
  it("line discount reduces the taxable value, then GST is charged on it", () => {
    const i = input();
    i.items[0].discount = 100;
    i.gstPercent = 10;
    const b = calculateInvoice(data(), i, date, "GST-4");
    expect(b.lines[0].discountPaise).toBe(10000);
    expect(b.lines[0].taxablePaise).toBe(2486000);
    expect(b.taxPaise).toBe(248600);
    expect(b.totalPaise).toBe(2734600);
  });
});
describe("CGST/SGST vs IGST split", () => {
  it("same state splits the tax into CGST + SGST", () => {
    const b = calculateInvoice(
      data(),
      { ...input(), gstPercent: 10, placeOfSupply: "23" },
      date,
      "GST-5",
    );
    expect(b.lines[0].components).toEqual({ CGST: 124800, SGST: 124800 });
    expect(b.taxPaise).toBe(249600);
  });
  it("another state puts the full tax into IGST", () => {
    const b = calculateInvoice(
      data(),
      { ...input(), gstPercent: 10, placeOfSupply: "27" },
      date,
      "GST-6",
    );
    expect(b.lines[0].components).toEqual({ IGST: 249600 });
    expect(b.taxPaise).toBe(249600);
  });
  it("odd paise goes to SGST so the parts add up to the tax", () => {
    expect(taxComponents("23ABCDE1234F1Z5", "23", 101, 3)).toEqual({
      CGST: 1,
      SGST: 2,
    });
    // Rs 24,959.95 taxable at 15% = Rs 3,743.9925 -> 374,399 paise tax.
    const i = input();
    i.items[0].discount = 0.05;
    i.gstPercent = 15;
    const b = calculateInvoice(data(), i, date, "GST-7");
    expect(b.lines[0].taxablePaise).toBe(2495995);
    expect(b.lines[0].components).toEqual({ CGST: 187199, SGST: 187200 });
    expect(b.taxPaise).toBe(374399);
    expect(b.totalPaise).toBe(2870394);
  });
});
