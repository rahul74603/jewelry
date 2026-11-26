import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LOAN_CUSTOMER_REQUIRED,
  buildQuickProduct,
  findCustomerByPhone,
  normalizePhone,
  prefillRate,
  rateUpsertFor,
  resolveBillCustomer,
} from "../src/lib/billFlow";
import { demoMutation, newLine } from "../src/lib/demo";
import { calculateInvoice } from "../functions/src/core/billing";
import { accountDelta } from "../functions/src/core/documents";
import {
  emptyWorkspace,
  makeProfile,
  type Customer,
  type InvoiceInput,
  type Workspace,
} from "../functions/src/core/model";

const now = () => new Date().toISOString();
const fresh = (): Workspace =>
  emptyWorkspace(makeProfile("Test shop", "Owner", ""));

/** Fresh workspace with one quick-added piece on the shelf (Gold 22K,
 * 5 g at ₹500/g + Fixed making ₹100 = ₹2,600 bill). */
function stocked(): Workspace {
  let w = fresh();
  const product = buildQuickProduct({
    category: "Rings",
    type: "Band",
    metal: "Gold",
    purity: "22K",
    rate: 500,
    weight: 5,
    lagat: 0,
    making: 100,
  });
  w = demoMutation(w, "product", product);
  const rate = rateUpsertFor(w.rates, "Gold", "22K", 500, "2026-01-01T00:00:00.000Z");
  w = demoMutation(w, "rate", rate!);
  return w;
}

function finalize(
  w: Workspace,
  input: InvoiceInput,
): Workspace {
  const preview = calculateInvoice(w, input, now(), "PREVIEW");
  return demoMutation(w, "invoice", {
    ...input,
    confirmation: {
      totalPaise: preview.totalPaise,
      balancePaise: preview.balancePaise,
    },
  });
}

describe("Bill-screen customer (section 01)", () => {
  it("matches a mobile across +91 / 0 / spaces", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalizePhone("09876543210")).toBe("9876543210");
    expect(normalizePhone("98765 43210")).toBe("9876543210");
    const customers: Customer[] = [
      {
        id: "c1",
        name: "Priya",
        phone: "9876543210",
        email: "",
        address: "",
        gstin: "",
      },
    ];
    expect(findCustomerByPhone(customers, "+91-98765 43210")?.id).toBe("c1");
    expect(findCustomerByPhone(customers, "99999 99999")).toBeUndefined();
    expect(findCustomerByPhone(customers, "")).toBeUndefined();
  });

  it("creates a new customer from the typed fields, walk-in when blank", () => {
    const res = resolveBillCustomer(
      [],
      { name: "Ramesh Kumar", phone: "98765 43210", address: "Main Bazar" },
      { required: true },
    );
    expect("error" in res).toBe(false);
    if ("error" in res) throw Error("unexpected error");
    expect(res.create?.name).toBe("Ramesh Kumar");
    expect(res.create?.phone).toBe("98765 43210");
    expect(res.create?.address).toBe("Main Bazar");
    expect(res.customerId).toBe(res.create?.id);
    expect(
      resolveBillCustomer(
        [],
        { name: "", phone: "", address: "" },
        { required: true },
      ),
    ).toEqual({ customerId: "", create: null });
  });

  it("refuses a nameless phone when the bill needs a customer (udhar)", () => {
    const res = resolveBillCustomer(
      [],
      { name: "", phone: "98765 43210", address: "" },
      { required: true },
    );
    expect("error" in res).toBe(true);
    if (!("error" in res)) throw Error("expected an error");
    expect(res.error).toContain("naam likho");
    // Same fields, full payment: no customer needed, walk-in is fine.
    expect(
      resolveBillCustomer(
        [],
        { name: "", phone: "98765 43210", address: "" },
        { required: false },
      ),
    ).toEqual({ customerId: "", create: null });
  });

  it("reuses the matched customer when resolving, with +91 / 0 / spaces", () => {
    const customers: Customer[] = [
      {
        id: "c1",
        name: "Priya",
        phone: "9876543210",
        email: "",
        address: "Old address",
        gstin: "",
      },
    ];
    // Same number typed three ways — always the same old record, no duplicate.
    for (const phone of ["+91 98765 43210", "09876543210", "98765 43210"]) {
      expect(
        resolveBillCustomer(
          customers,
          { name: "Priya", phone, address: "New address typed" },
          { required: true, requiredError: LOAN_CUSTOMER_REQUIRED },
        ),
      ).toEqual({ customerId: "c1", create: null });
    }
  });

  it("a loan form's required error names this form's customer fields — billing keeps its own wording", () => {
    const res = resolveBillCustomer(
      [],
      { name: "", phone: "98765 43210", address: "" },
      { required: true, requiredError: LOAN_CUSTOMER_REQUIRED },
    );
    expect("error" in res).toBe(true);
    if (!("error" in res)) throw Error("expected an error");
    expect(res.error).toBe(LOAN_CUSTOMER_REQUIRED);
    expect(res.error).toContain("Customer ka naam likho");
    expect(res.error).not.toContain("01 Customer");
    // No override: billing's wording is unchanged.
    expect(
      resolveBillCustomer(
        [],
        { name: "", phone: "98765 43210", address: "" },
        { required: true },
      ),
    ).toEqual({
      error:
        "Udhar ke liye customer ka naam likho — upar 01 Customer me naam likho.",
    });
  });
});

describe("Bill-screen quick-add (section 02)", () => {
  it("creates a stock product with the entered lagat as its cost", () => {
    const p = buildQuickProduct({
      category: "Necklaces",
      type: "Mangalsutra",
      metal: "Gold",
      purity: "22K",
      rate: 11440,
      weight: 8.5,
      lagat: 95000,
      making: 1200,
    });
    expect(p.cost).toBe(95000);
    expect(p.stock).toBe(1);
    expect(p.gross).toBe(8.5);
    expect(p.metal).toBe("Gold");
    expect(p.purity).toBe("22K");
    expect(p.name).toBe("Gold 22K Mangalsutra Necklace");
    expect(p.makingMode).toBe("Fixed");
    expect(p.making).toBe(1200);
    const w = demoMutation(fresh(), "product", p);
    expect(w.products[0].cost).toBe(95000);
  });

  it("the rate typed on the bill becomes the current rate, and the next bill pre-fills it", () => {
    let w = fresh();
    expect(prefillRate(w.rates, "Gold", "22K")).toBeUndefined();
    const rec = rateUpsertFor(
      w.rates,
      "Gold",
      "22K",
      11440,
      "2026-01-01T00:00:00.000Z",
    );
    expect(rec).not.toBeNull();
    w = demoMutation(w, "rate", rec!);
    expect(prefillRate(w.rates, "Gold", "22K")).toBe(11440);
    // Typing the same rate again records nothing new.
    expect(rateUpsertFor(w.rates, "Gold", "22K", 11440)).toBeNull();
    // A changed rate becomes the new current rate.
    const rec2 = rateUpsertFor(
      w.rates,
      "Gold",
      "22K",
      11500,
      "2026-06-01T00:00:00.000Z",
    );
    expect(rec2).not.toBeNull();
    w = demoMutation(w, "rate", rec2!);
    expect(prefillRate(w.rates, "Gold", "22K")).toBe(11500);
    expect(w.rates).toHaveLength(2);
  });
});

describe("Bill-screen finalize (sections 01–03)", () => {
  it("finalize with a new customer creates the record and links the bill", () => {
    let w = stocked();
    const product = w.products[0];
    const res = resolveBillCustomer(
      w.customers,
      { name: "Meera Sharma", phone: "+91 98765 43210", address: "Station Road" },
      { required: true },
    );
    expect("error" in res).toBe(false);
    if ("error" in res) throw Error("unexpected error");
    if (res.create) w = demoMutation(w, "customer", res.create);
    const input: InvoiceInput = {
      id: "bill-c",
      customerId: res.customerId,
      type: "Non-GST bill",
      items: [newLine(product)],
      paid: 2600,
      settlement: "full",
      mode: "Cash",
    };
    w = finalize(w, input);
    expect(w.customers).toHaveLength(1);
    expect(w.customers[0].name).toBe("Meera Sharma");
    expect(w.customers[0].address).toBe("Station Road");
    expect(w.invoices[0].customer?.id).toBe(res.customerId);
    expect(w.invoices[0].customer?.name).toBe("Meera Sharma");
    expect(w.invoices[0].balancePaise).toBe(0);
  });

  it("finalize with an existing mobile reuses that customer — no duplicate", () => {
    let w = stocked();
    w = demoMutation(w, "customer", {
      id: "cust-old",
      name: "Priya",
      phone: "9876543210",
      email: "",
      address: "Old address",
      gstin: "",
    });
    const res = resolveBillCustomer(
      w.customers,
      { name: "Priya", phone: "+91-98765 43210", address: "New address typed" },
      { required: true },
    );
    expect(res).toEqual({ customerId: "cust-old", create: null });
    const input: InvoiceInput = {
      id: "bill-d",
      customerId: "cust-old",
      type: "Non-GST bill",
      items: [newLine(w.products[0])],
      paid: 2000,
      settlement: "part",
      mode: "Cash",
    };
    w = finalize(w, input);
    expect(w.customers).toHaveLength(1);
    expect(w.invoices[0].customer?.id).toBe("cust-old");
    expect(w.invoices[0].balancePaise).toBe(60000);
  });

  it("counter flow from a FRESH state: rate → item → bill → partial payment → customer → finalize", () => {
    let w = fresh();
    expect(w.rates).toHaveLength(0);
    expect(w.products).toHaveLength(0);
    expect(w.customers).toHaveLength(0);
    // 1. Rate typed on the bill + item added (Gold 22K, 5 g, ₹500/g,
    //    making ₹100, lagat ₹0) — no rate or product pre-seeded.
    const product = buildQuickProduct({
      category: "Rings",
      type: "Band",
      metal: "Gold",
      purity: "22K",
      rate: 500,
      weight: 5,
      lagat: 0,
      making: 100,
    });
    w = demoMutation(w, "product", product);
    const rate = rateUpsertFor(w.rates, "Gold", "22K", 500);
    expect(rate).not.toBeNull();
    w = demoMutation(w, "rate", rate!);
    // 2. Bill built: 1 piece, partial payment ₹2,000 of ₹2,600.
    const input: InvoiceInput = {
      id: "bill-1",
      customerId: "",
      type: "Non-GST bill",
      items: [newLine(product)],
      paid: 2000,
      settlement: "part",
      mode: "Cash",
    };
    // No customer yet — the calc refuses, because udhar needs a khata.
    expect(() => calculateInvoice(w, input, now(), "x")).toThrow(
      "Select a customer",
    );
    // 3. Customer typed on the bill (section 01).
    const res = resolveBillCustomer(
      w.customers,
      { name: "Ramesh Kumar", phone: "98765 43210", address: "Main Bazar" },
      { required: true },
    );
    expect("error" in res).toBe(false);
    if ("error" in res) throw Error("unexpected error");
    if (res.create) w = demoMutation(w, "customer", res.create);
    input.customerId = res.customerId;
    // 4. Finalize — the bill forms with a non-zero total.
    const preview = calculateInvoice(w, input, now(), "PREVIEW");
    expect(preview.totalPaise).toBe(260000);
    w = demoMutation(w, "invoice", {
      ...input,
      confirmation: {
        totalPaise: preview.totalPaise,
        balancePaise: preview.balancePaise,
      },
    });
    const bill = w.invoices[0];
    expect(bill.totalPaise).toBe(260000);
    expect(bill.paidPaise).toBe(200000);
    expect(bill.balancePaise).toBe(60000);
    expect(bill.customer?.name).toBe("Ramesh Kumar");
    expect(bill.customer?.phone).toBe("98765 43210");
    // The ₹600 balance posts to the customer's khata (udhar).
    expect(accountDelta(bill)).toBe(60000);
    // The piece sold: stock drops from 1 to 0.
    expect(w.products[0].stock).toBe(0);
    expect(w.customers).toHaveLength(1);
  });
});

describe("No Metal Rates page anymore (sidebar + dashboard)", () => {
  const shell = readFileSync(
    new URL("../src/components/Shell.tsx", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../src/pages/Dashboard.tsx", import.meta.url),
    "utf8",
  );
  const billing = readFileSync(
    new URL("../src/pages/Billing.tsx", import.meta.url),
    "utf8",
  );

  it("sidebar links contain no /rates entry and no MetalRates import", () => {
    expect(shell).not.toContain('"/rates"');
    expect(shell).not.toContain("MetalRates");
  });

  it("dashboard no longer links to /rates", () => {
    expect(dashboard).not.toContain('to="/rates"');
  });

  it("billing screen no longer links to /rates", () => {
    expect(billing).not.toContain('to="/rates"');
  });
});

describe("Loan form uses the bill's inline customer fields", () => {
  const loans = readFileSync(
    new URL("../src/pages/Loans.tsx", import.meta.url),
    "utf8",
  );

  it("has no customer dropdown and no 'add a customer first' dead end", () => {
    expect(loans).not.toContain("Add a customer first");
    expect(loans).not.toContain('label="Customer"');
  });

  it("types naam, mobile and address on the form itself, like billing section 01", () => {
    expect(loans).toContain('label="Customer ka naam"');
    expect(loans).toContain('label="Mobile number"');
    expect(loans).toContain('label="Address"');
    expect(loans).toContain("onCustPhone");
    expect(loans).toContain("findCustomerByPhone");
  });

  it("resolves the customer with required: true and the loan form's own error wording", () => {
    expect(loans).toContain("resolveBillCustomer");
    expect(loans).toContain("required: true");
    expect(loans).toContain("requiredError: LOAN_CUSTOMER_REQUIRED");
    expect(loans).toContain('perform("customer", res.create)');
    expect(loans).toContain('perform("loan", loan)');
  });
});
