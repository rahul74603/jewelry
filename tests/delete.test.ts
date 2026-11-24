import { describe, it, expect } from "vitest";
import { demoMutation, seedDemo } from "../src/lib/demo";
import { calculateInvoice } from "../functions/src/core/billing";
import { accountDelta } from "../functions/src/core/documents";
import {
  emptyWorkspace,
  makeProfile,
  type InvoiceInput,
  type Product,
  type Workspace,
} from "../functions/src/core/model";

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
  const d = emptyWorkspace(makeProfile("Test shop", "Owner", ""));
  d.products = [structuredClone(product)];
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

function saleInput(id = "txn1"): InvoiceInput {
  return {
    id,
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
    paid: 0,
    settlement: "part",
    mode: "Cash",
  };
}

/** Finalize an input with full payment (estimates: no payment). */
function finalize(w: Workspace, input: InvoiceInput): Workspace {
  const preview = calculateInvoice(
    w,
    input,
    new Date().toISOString(),
    "PREVIEW",
  );
  const isEstimate = input.type === "Estimate";
  return demoMutation(w, "invoice", {
    ...input,
    paid: isEstimate ? 0 : preview.totalPaise / 100,
    confirmation: {
      totalPaise: preview.totalPaise,
      balancePaise: isEstimate ? preview.totalPaise : 0,
    },
  });
}

describe("delete draft", () => {
  it("removes only that draft and leaves invoices alone", () => {
    let w = demoMutation(data(), "draft", { ...saleInput("draft-1") });
    w = demoMutation(w, "draft", { ...saleInput("draft-2") });
    w = finalize(w, saleInput("txn1"));
    expect(w.drafts).toHaveLength(2);
    const next = demoMutation(w, "deleteDraft", { id: "draft-1" });
    expect(next.drafts.map((d) => d.id)).toEqual(["draft-2"]);
    expect(next.invoices).toHaveLength(1);
  });

  it("refuses an unknown draft", () => {
    expect(() =>
      demoMutation(data(), "deleteDraft", { id: "nope" }),
    ).toThrow("Draft not found");
  });
});

describe("delete invoice (permanent)", () => {
  it("removes a sale bill, restores stock and clears the customer balance", () => {
    let w = finalize(data(), saleInput());
    expect(w.products[0].stock).toBe(2);
    expect(w.invoices).toHaveLength(1);
    const next = demoMutation(w, "deleteInvoice", { id: "txn1" });
    expect(next.invoices).toHaveLength(0);
    expect(next.products[0].stock).toBe(3);
    expect(
      next.invoices.reduce((n, b) => n + accountDelta(b), 0),
    ).toBe(0);
  });

  it("removes an estimate without touching stock", () => {
    let w = finalize(data(), {
      ...saleInput("est-1"),
      type: "Estimate",
    });
    expect(w.products[0].stock).toBe(3);
    const next = demoMutation(w, "deleteInvoice", { id: "est-1" });
    expect(next.invoices).toHaveLength(0);
    expect(next.products[0].stock).toBe(3);
  });

  it("refuses a voided document — the audit trail stays", () => {
    let w = finalize(data(), saleInput());
    w = demoMutation(w, "void", { id: "txn1", reason: "Full return" });
    expect(() =>
      demoMutation(w, "deleteInvoice", { id: "txn1" }),
    ).toThrow("kept for audit");
  });

  it("refuses a converted estimate, and deleting the sale frees it", () => {
    let w = finalize(data(), { ...saleInput("est-1"), type: "Estimate" });
    w = finalize(w, { ...saleInput("txn1"), sourceEstimate: "est-1" });
    expect(w.invoices.find((b) => b.id === "est-1")?.convertedTo).toBe(
      "txn1",
    );
    expect(() =>
      demoMutation(w, "deleteInvoice", { id: "est-1" }),
    ).toThrow("already converted");
    const next = demoMutation(w, "deleteInvoice", { id: "txn1" });
    expect(next.invoices.find((b) => b.id === "est-1")?.convertedTo).toBe(
      undefined,
    );
  });

  it("refuses an unknown invoice", () => {
    expect(() =>
      demoMutation(data(), "deleteInvoice", { id: "nope" }),
    ).toThrow("Invoice not found");
  });
});

describe("clear workspace (start fresh)", () => {
  it("wipes every record but keeps the shop profile", () => {
    const w = seedDemo();
    expect(w.products.length).toBeGreaterThan(0);
    expect(w.invoices.length).toBeGreaterThan(0);
    const next = demoMutation(w, "clearWorkspace", {});
    expect(next.profile.shopName).toBe("Sample Jewellery Studio");
    expect(next.profile.bankName).toBe("");
    expect(next.products).toHaveLength(0);
    expect(next.customers).toHaveLength(0);
    expect(next.rates).toHaveLength(0);
    expect(next.invoices).toHaveLength(0);
    expect(next.drafts).toHaveLength(0);
    expect(next.loans).toHaveLength(0);
  });

  it("keeps bank details set in the profile", () => {
    const w = data();
    w.profile.bankName = "State Bank";
    w.profile.accountName = "Test Shop";
    w.profile.accountNumber = "12345678901";
    w.profile.ifsc = "SBIN0001234";
    const next = demoMutation(w, "clearWorkspace", {});
    expect(next.profile.bankName).toBe("State Bank");
    expect(next.profile.accountNumber).toBe("12345678901");
    expect(next.profile.ifsc).toBe("SBIN0001234");
    expect(next.products).toHaveLength(0);
  });
});
