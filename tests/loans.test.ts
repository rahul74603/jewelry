import { it, expect, describe } from "vitest";
import {
  emptyWorkspace,
  makeProfile,
  loanSchema,
  type Loan,
} from "../functions/src/core/model";
import {
  currentMonthInterestPaise,
  dueLoans,
  isOverdue,
  loanState,
  loanSummary,
  reminderMessage,
  whatsappLink,
  wholeMonthsBetween,
} from "../functions/src/core/loans";
import { demoMutation, seedDemo } from "../src/lib/demo";
import {
  countsFor,
  createBackup,
  parseBackup,
  validateBackup,
} from "../src/lib/backup";

function loan(over: Partial<Loan> = {}): Loan {
  return loanSchema.parse({
    id: "loan-test-1",
    kind: "girvi",
    customerId: "client-0",
    itemName: "Gold necklace 22K",
    itemMetal: "Gold",
    itemPurity: "22K",
    itemWeight: 12.5,
    principalPaise: 10000000,
    totalPaise: 10000000,
    upfrontPaise: 0,
    interestRatePct: 2,
    startAt: "2026-09-01",
    dueAt: "2026-12-01",
    payments: [],
    status: "active",
    createdAt: "2026-09-01T06:30:00.000Z",
    ...over,
  });
}

describe("wholeMonthsBetween", () => {
  it("counts only completed months", () => {
    expect(wholeMonthsBetween("2026-10-15", "2026-11-14")).toBe(0);
    expect(wholeMonthsBetween("2026-10-15", "2026-11-15")).toBe(1);
    expect(wholeMonthsBetween("2026-09-01", "2026-11-01")).toBe(2);
    expect(wholeMonthsBetween("2026-10-15", "2026-10-15")).toBe(0);
  });
  it("handles month-end starts", () => {
    expect(wholeMonthsBetween("2026-01-31", "2026-02-28")).toBe(0);
    expect(wholeMonthsBetween("2026-01-31", "2026-03-31")).toBe(2);
  });
});

describe("interest calculation", () => {
  it("charges monthly simple interest on the principal", () => {
    const s = loanSummary(loan(), "2026-11-01");
    // ₹1,00,000 at 2%/month for 2 months = ₹4,000 interest.
    expect(s.interestAccruedPaise).toBe(400000);
    expect(s.balancePaise).toBe(10400000);
  });
  it("charges no interest inside the first month", () => {
    const s = loanSummary(loan(), "2026-09-20");
    expect(s.interestAccruedPaise).toBe(0);
    expect(s.balancePaise).toBe(10000000);
  });
  it("charges this month's interest on the outstanding principal", () => {
    expect(currentMonthInterestPaise(loan(), "2026-11-01")).toBe(200000);
  });
});

describe("payment allocation (interest first)", () => {
  it("settles interest before principal", () => {
    const l = loan({
      principalPaise: 5000000,
      totalPaise: 5000000,
      startAt: "2026-10-01",
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 100000,
          mode: "Cash",
        },
      ],
    });
    const s = loanSummary(l, "2026-11-01");
    // 1 month interest on ₹50,000 = ₹1,000 — the whole payment is interest.
    expect(s.interestPaidPaise).toBe(100000);
    expect(s.principalPaidPaise).toBe(0);
    expect(s.outstandingPrincipalPaise).toBe(5000000);
    expect(s.balancePaise).toBe(5000000);
  });
  it("splits a larger payment and charges later interest on the reduced principal", () => {
    const l = loan({
      principalPaise: 5000000,
      totalPaise: 5000000,
      startAt: "2026-10-01",
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 600000,
          mode: "Cash",
        },
      ],
    });
    const s = loanSummary(l, "2026-12-01");
    // Nov: ₹1,000 interest + ₹5,000 principal. Dec: 2% on ₹45,000 = ₹900.
    expect(s.interestAccruedPaise).toBe(190000);
    expect(s.interestPaidPaise).toBe(100000);
    expect(s.principalPaidPaise).toBe(500000);
    expect(s.outstandingPrincipalPaise).toBe(4500000);
    expect(s.outstandingInterestPaise).toBe(90000);
    expect(s.balancePaise).toBe(4590000);
  });
  it("a full repayment leaves a zero balance", () => {
    const l = loan({
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 10400000,
          mode: "UPI",
        },
      ],
    });
    expect(loanSummary(l, "2026-11-01").balancePaise).toBe(0);
    expect(loanState(l, "2026-11-01")).toBe("repaid");
  });
});

describe("due dates", () => {
  it("is overdue after the due date with a balance", () => {
    expect(isOverdue(loan({ dueAt: "2026-11-01" }), "2026-11-02")).toBe(true);
    expect(loanState(loan({ dueAt: "2026-11-01" }), "2026-11-01")).toBe(
      "due-soon",
    );
  });
  it("is due-soon within 7 days of the due date", () => {
    expect(loanState(loan({ dueAt: "2026-11-05" }), "2026-11-01")).toBe(
      "due-soon",
    );
    expect(loanState(loan({ dueAt: "2026-11-20" }), "2026-11-01")).toBe(
      "active",
    );
  });
  it("dueLoans lists overdue first, then due-soon", () => {
    const list = dueLoans(
      [
        loan({ id: "loan-a", dueAt: "2026-11-20" }),
        loan({ id: "loan-b", dueAt: "2026-10-15" }),
        loan({ id: "loan-c", dueAt: "2026-11-03" }),
      ],
      "2026-11-01",
    );
    expect(list.map((l) => l.id)).toEqual(["loan-b", "loan-c"]);
  });
  it("repaid and forfeited records never appear in the due list", () => {
    const repaid = loan({
      id: "loan-d",
      dueAt: "2026-10-01",
      payments: [
        {
          id: "loanpay-a",
          at: "2026-09-15T06:30:00.000Z",
          amountPaise: 10000000,
          mode: "Cash",
        },
      ],
    });
    const forfeited = loan({
      id: "loan-e",
      dueAt: "2026-10-01",
      status: "forfeited",
    });
    expect(dueLoans([repaid, forfeited], "2026-11-01")).toEqual([]);
  });
});

describe("reminder message and WhatsApp link", () => {
  it("builds the Hindi message with bakaya, byaj and total", () => {
    const msg = reminderMessage(
      loan(),
      "Meera Sharma",
      "Sample Jewellery Studio",
      "2026-11-01",
    );
    expect(msg).toContain("Meera Sharma");
    expect(msg).toContain("Sample Jewellery Studio");
    expect(msg).toContain("₹1,00,000");
    expect(msg).toContain("₹2,000");
    expect(msg).toContain("₹1,04,000");
  });
  it("prefills a wa.me link with the customer number", () => {
    const link = whatsappLink("98765 43210", "hello");
    expect(link.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(link).toContain(encodeURIComponent("hello"));
  });
  it("falls back to the WhatsApp share sheet without a number", () => {
    expect(whatsappLink("", "hello")).toBe(
      "https://api.whatsapp.com/send?text=hello",
    );
  });
});

describe("loan schema validation", () => {
  it("rejects an EMI whose principal + upfront is not the price", () => {
    expect(() =>
      loan({
        kind: "emi",
        principalPaise: 9000000,
        totalPaise: 10000000,
        upfrontPaise: 500000,
      }),
    ).toThrow();
  });
  it("rejects a girvi without a weight", () => {
    expect(() => loan({ itemWeight: 0 })).toThrow();
  });
  it("rejects a due date before the start date", () => {
    expect(() => loan({ dueAt: "2026-08-01" })).toThrow();
  });
});

describe("demo mutations", () => {
  it("creates a loan and records a payment", () => {
    const w = seedDemo();
    const before = w.loans.length;
    const next = demoMutation(w, "loan", loan({ id: "loan-new-1" }));
    expect(next.loans.length).toBe(before + 1);
    const paid = demoMutation(next, "loanPayment", {
      loanId: "loan-new-1",
      payment: {
        id: "loanpay-new",
        at: new Date().toISOString(),
        amountPaise: 50000,
        mode: "Cash",
      },
    });
    expect(
      paid.loans.find((l) => l.id === "loan-new-1")!.payments.length,
    ).toBe(1);
  });
  it("rejects a payment larger than the balance", () => {
    const w = seedDemo();
    expect(() =>
      demoMutation(w, "loanPayment", {
        loanId: "loan-girvi-overdue",
        payment: {
          id: "loanpay-big",
          at: new Date().toISOString(),
          amountPaise: 999999999,
          mode: "Cash",
        },
      }),
    ).toThrow("more than the balance");
  });
  it("forfeits a girvi record and moves the collateral to stock", () => {
    const w = seedDemo();
    const productsBefore = w.products.length;
    const next = demoMutation(w, "loanForfeit", {
      loanId: "loan-girvi-overdue",
    });
    const l = next.loans.find((x) => x.id === "loan-girvi-overdue")!;
    expect(l.status).toBe("forfeited");
    expect(l.forfeitedAt).toBeTruthy();
    expect(next.products.length).toBe(productsBefore + 1);
    const p = next.products[next.products.length - 1];
    expect(p.category).toBe("Forfeited");
    expect(p.name).toBe("Gold necklace 22K");
    expect(p.stock).toBe(1);
    expect(p.gross).toBe(12.5);
    // Balance at forfeit: ₹20,000 principal + 2 months interest ₹800.
    expect(p.cost).toBe(20800);
    // A forfeited record takes no more payments.
    expect(() =>
      demoMutation(next, "loanPayment", {
        loanId: "loan-girvi-overdue",
        payment: {
          id: "loanpay-late",
          at: new Date().toISOString(),
          amountPaise: 100,
          mode: "Cash",
        },
      }),
    ).toThrow("forfeited");
  });
  it("refuses to forfeit an EMI record", () => {
    expect(() =>
      demoMutation(seedDemo(), "loanForfeit", { loanId: "loan-emi-1" }),
    ).toThrow("Only a girvi record");
  });
});

describe("backup includes loans", () => {
  it("counts, checksums and restores loans", async () => {
    const w = seedDemo();
    expect(w.loans.length).toBe(3);
    const file = await createBackup(w);
    expect(file.counts.loans).toBe(3);
    expect((await validateBackup(file)).valid).toBe(true);
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.valid).toBe(true);
    const restored = demoMutation(
      emptyWorkspace(makeProfile("Other Shop", "Owner", "")),
      "restore",
      (parsed as { valid: true; file: typeof file }).file.data,
    );
    expect(restored.loans.length).toBe(3);
    expect(countsFor(restored)).toEqual(file.counts);
  });
  it("an older backup without loans still restores, with loans: []", async () => {
    const w = seedDemo();
    const old = structuredClone(w) as unknown as Record<string, unknown>;
    delete old.loans;
    const file = await createBackup(old as never);
    expect(file.counts.loans).toBe(0);
    expect((await validateBackup(file)).valid).toBe(true);
    const restored = demoMutation(
      emptyWorkspace(makeProfile("Other Shop", "Owner", "")),
      "restore",
      file.data,
    );
    expect(restored.loans).toEqual([]);
  });
});
