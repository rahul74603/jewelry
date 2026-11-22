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
  monthBoundaries,
  receiptMessage,
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

describe("month-wise interest buckets", () => {
  it("lists month completion dates", () => {
    expect(monthBoundaries("2026-10-15", "2026-12-20")).toEqual([
      "2026-11-15",
      "2026-12-15",
    ]);
    expect(monthBoundaries("2026-01-31", "2026-03-31")).toEqual([
      "2026-03-01",
      "2026-03-31",
    ]);
  });
  it("labels each completed month with its interest", () => {
    const s = loanSummary(loan(), "2026-11-01");
    expect(s.buckets.map((b) => [b.label, b.interestPaise])).toEqual([
      ["October", 200000],
      ["November", 200000],
    ]);
    expect(s.unpaidBuckets.length).toBe(2);
  });
  it("settles the oldest buckets first", () => {
    const l = loan({
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 300000,
          mode: "Cash",
        },
      ],
    });
    const s = loanSummary(l, "2026-11-01");
    // ₹2,000 Oct + ₹2,000 Nov accrued; ₹3,000 pays Oct fully, Nov partly.
    expect(s.buckets[0].paidPaise).toBe(200000);
    expect(s.buckets[0].unpaidPaise).toBe(0);
    expect(s.buckets[1].paidPaise).toBe(100000);
    expect(s.buckets[1].unpaidPaise).toBe(100000);
    expect(s.unpaidBuckets.map((b) => b.label)).toEqual(["November"]);
  });
  it("restarts the clock on payment — no bucket before the anniversary", () => {
    // Priya's case: start 13 Oct, ₹2,000 paid on 12 Nov (1 day before
    // the first month completes), so no interest has accrued by 22 Nov.
    const l = loan({
      principalPaise: 5000000,
      totalPaise: 5000000,
      startAt: "2026-10-13",
      dueAt: "2026-12-13",
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-12T06:30:00.000Z",
          amountPaise: 200000,
          mode: "Cash",
        },
      ],
    });
    const s = loanSummary(l, "2026-11-22");
    expect(s.buckets).toEqual([]);
    expect(s.interestAccruedPaise).toBe(0);
    expect(s.outstandingPrincipalPaise).toBe(4800000);
    // One month after the payment the first bucket appears — December,
    // 2% on the reduced ₹48,000 principal.
    const later = loanSummary(l, "2026-12-12");
    expect(later.buckets.map((b) => [b.label, b.interestPaise])).toEqual([
      ["December", 96000],
    ]);
  });
  it("handles month-end starts without changing the total", () => {
    const s = loanSummary(
      loan({ startAt: "2026-01-31", dueAt: "2026-12-31" }),
      "2026-03-31",
    );
    expect(s.buckets.length).toBe(2);
    expect(s.interestAccruedPaise).toBe(400000);
    // Two months complete in March — labels stay distinct.
    expect(s.buckets.map((b) => b.label)).toEqual(["March 1", "March 31"]);
  });
});

describe("compound interest (chakravarti byaj)", () => {
  it("charges simple interest by default", () => {
    const s = loanSummary(loan(), "2026-11-01");
    expect(s.compound).toBe(false);
    expect(s.interestAccruedPaise).toBe(400000);
  });
  it("compounds unpaid interest monthly when ON", () => {
    const s = loanSummary(loan({ compound: true }), "2026-11-01");
    // Month 1: 2% on ₹1,00,000 = ₹2,000. Month 2: 2% on ₹1,02,000 = ₹2,040.
    expect(s.interestAccruedPaise).toBe(404000);
    expect(s.buckets.map((b) => b.interestPaise)).toEqual([200000, 204000]);
    expect(s.balancePaise).toBe(10404000);
  });
  it("charges the next month on principal only once interest is paid", () => {
    const l = loan({
      compound: true,
      payments: [
        {
          id: "loanpay-a",
          at: "2026-10-01T06:30:00.000Z",
          amountPaise: 200000,
          mode: "Cash",
        },
      ],
    });
    const s = loanSummary(l, "2026-11-01");
    // Oct interest ₹2,000 paid in full on 1 Oct; Nov: 2% on ₹1,00,000.
    expect(s.interestAccruedPaise).toBe(400000);
    expect(s.balancePaise).toBe(10200000);
  });
  it("flips the whole record when the toggle changes", () => {
    const w = seedDemo();
    const toggled = demoMutation(w, "loanCompound", {
      loanId: "loan-girvi-overdue",
      compound: true,
    });
    const l = toggled.loans.find((x) => x.id === "loan-girvi-overdue")!;
    expect(l.compound).toBe(true);
    // ₹20,000 @2% compound for 2 months: 400 + 408 = ₹808.
    expect(loanSummary(l).interestAccruedPaise).toBe(80800);
    const back = demoMutation(toggled, "loanCompound", {
      loanId: "loan-girvi-overdue",
      compound: false,
    });
    const l2 = back.loans.find((x) => x.id === "loan-girvi-overdue")!;
    expect(loanSummary(l2).interestAccruedPaise).toBe(80000);
  });
  it("refuses to change the interest type on a closed record", () => {
    const w = seedDemo();
    const forfeited = demoMutation(w, "loanForfeit", {
      loanId: "loan-girvi-overdue",
    });
    expect(() =>
      demoMutation(forfeited, "loanCompound", {
        loanId: "loan-girvi-overdue",
        compound: true,
      }),
    ).toThrow("Only an active record");
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
  it("names the unpaid months and their combined interest", () => {
    const msg = reminderMessage(
      loan(),
      "Meera Sharma",
      "Sample Jewellery Studio",
      "2026-11-01",
    );
    expect(msg).toContain("Meera Sharma");
    expect(msg).toContain("Sample Jewellery Studio");
    expect(msg).toContain("₹1,00,000");
    expect(msg).toContain("October aur November ka byaj mila kar ₹4,000 hua");
    expect(msg).toContain("₹1,04,000");
  });
  it("says plainly when no interest has accrued yet", () => {
    const msg = reminderMessage(
      loan(),
      "Meera Sharma",
      "Sample Jewellery Studio",
      "2026-09-20",
    );
    expect(msg).toContain("₹1,00,000");
    expect(msg).toContain("Abhi tak byaj nahi bana hai");
    expect(msg).not.toContain("bana, kul");
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
  it("allows a manual payment larger than the balance, records the extra and closes the record", () => {
    const w = seedDemo();
    const l0 = w.loans.find((x) => x.id === "loan-girvi-overdue")!;
    const balance = loanSummary(l0).balancePaise;
    const next = demoMutation(w, "loanPayment", {
      loanId: "loan-girvi-overdue",
      payment: {
        id: "loanpay-big",
        at: new Date().toISOString(),
        amountPaise: balance + 50000,
        mode: "Cash",
      },
    });
    const l = next.loans.find((x) => x.id === "loan-girvi-overdue")!;
    expect(l.payments).toHaveLength(1);
    expect(l.payments[0].extraPaise).toBe(50000);
    expect(loanSummary(l).extraPaidPaise).toBe(50000);
    expect(loanSummary(l).balancePaise).toBe(0);
    expect(loanState(l)).toBe("repaid");
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

describe("manual payment and settlement (mamla khatam)", () => {
  it("settles a record for less — waived amount recorded, no more payments", () => {
    const w = seedDemo();
    const l0 = w.loans.find((x) => x.id === "loan-girvi-overdue")!;
    const balance = loanSummary(l0).balancePaise;
    const amount = balance - 500000; // ₹5,000 less than the balance.
    const next = demoMutation(w, "loanSettle", {
      loanId: "loan-girvi-overdue",
      payment: {
        id: "loanpay-settle",
        at: new Date().toISOString(),
        amountPaise: amount,
        mode: "Cash",
      },
    });
    const l = next.loans.find((x) => x.id === "loan-girvi-overdue")!;
    expect(l.status).toBe("settled");
    expect(l.settlementAmountPaise).toBe(amount);
    expect(l.waivedPaise).toBe(500000);
    expect(l.settledAt).toBeTruthy();
    expect(l.payments).toHaveLength(1);
    expect(loanSummary(l).balancePaise).toBe(0);
    expect(loanState(l)).toBe("settled");
    expect(
      dueLoans(next.loans).map((x) => x.id),
    ).not.toContain("loan-girvi-overdue");
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
    ).toThrow("settled");
    expect(() =>
      demoMutation(next, "loanSettle", {
        loanId: "loan-girvi-overdue",
        payment: {
          id: "loanpay-again",
          at: new Date().toISOString(),
          amountPaise: 100,
          mode: "Cash",
        },
      }),
    ).toThrow("Only an active record");
  });
  it("refuses a settlement amount at or above the balance", () => {
    const w = seedDemo();
    const balance = loanSummary(
      w.loans.find((x) => x.id === "loan-girvi-overdue")!,
    ).balancePaise;
    expect(() =>
      demoMutation(w, "loanSettle", {
        loanId: "loan-girvi-overdue",
        payment: {
          id: "loanpay-s",
          at: new Date().toISOString(),
          amountPaise: balance,
          mode: "Cash",
        },
      }),
    ).toThrow("less than the balance");
  });
  it("refuses to settle a forfeited record", () => {
    const w = seedDemo();
    const forfeited = demoMutation(w, "loanForfeit", {
      loanId: "loan-girvi-overdue",
    });
    expect(() =>
      demoMutation(forfeited, "loanSettle", {
        loanId: "loan-girvi-overdue",
        payment: {
          id: "loanpay-s",
          at: new Date().toISOString(),
          amountPaise: 100,
          mode: "Cash",
        },
      }),
    ).toThrow("Only an active record");
  });
});

describe("receipt message", () => {
  it("includes customer, amount, date and remaining balance", () => {
    const l = loan({
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 5000000,
          mode: "UPI",
        },
      ],
    });
    const msg = receiptMessage(
      l,
      l.payments[0],
      "Meera Sharma",
      "Sample Jewellery Studio",
      "2026-11-01",
    );
    expect(msg).toContain("Meera Sharma");
    expect(msg).toContain("₹50,000");
    expect(msg).toContain("1 Nov 2026");
    // ₹50,000 paid: ₹4,000 interest + ₹46,000 principal → ₹54,000 left.
    expect(msg).toContain("₹54,000");
  });
  it("says the matter is closed with the waived amount for a settled record", () => {
    const l = loan({
      status: "settled",
      settledAt: "2026-11-01T06:30:00.000Z",
      settlementAmountPaise: 9000000,
      waivedPaise: 1400000,
      payments: [
        {
          id: "loanpay-a",
          at: "2026-11-01T06:30:00.000Z",
          amountPaise: 9000000,
          mode: "Cash",
          note: "Settlement — mamla khatam",
        },
      ],
    });
    const msg = receiptMessage(
      l,
      l.payments[0],
      "Meera Sharma",
      "Sample Jewellery Studio",
      "2026-11-01",
    );
    expect(msg).toContain("₹90,000");
    expect(msg).toContain("₹0");
    expect(msg).toContain("Mamla khatam");
    expect(msg).toContain("₹14,000 maaf");
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
  it("keeps compound, settlement and extra through backup/restore", async () => {
    const w = seedDemo();
    const withCompound = demoMutation(w, "loanCompound", {
      loanId: "loan-emi-1",
      compound: true,
    });
    const girvi = withCompound.loans.find((x) => x.id === "loan-girvi-overdue")!;
    const balance = loanSummary(girvi).balancePaise;
    const settled = demoMutation(withCompound, "loanSettle", {
      loanId: "loan-girvi-overdue",
      payment: {
        id: "loanpay-settle",
        at: new Date().toISOString(),
        amountPaise: balance - 100000,
        mode: "Cash",
      },
    });
    const emi = settled.loans.find((x) => x.id === "loan-emi-1")!;
    const emiBalance = loanSummary(emi).balancePaise;
    const overpaid = demoMutation(settled, "loanPayment", {
      loanId: "loan-emi-1",
      payment: {
        id: "loanpay-extra",
        at: new Date().toISOString(),
        amountPaise: emiBalance + 10000,
        mode: "UPI",
      },
    });
    const file = await createBackup(overpaid);
    expect((await validateBackup(file)).valid).toBe(true);
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.valid).toBe(true);
    const restored = demoMutation(
      emptyWorkspace(makeProfile("Other Shop", "Owner", "")),
      "restore",
      (parsed as { valid: true; file: typeof file }).file.data,
    );
    const restoredEmi = restored.loans.find((x) => x.id === "loan-emi-1")!;
    expect(restoredEmi.compound).toBe(true);
    expect(restoredEmi.payments[restoredEmi.payments.length - 1].extraPaise).toBe(10000);
    const restoredGirvi = restored.loans.find(
      (x) => x.id === "loan-girvi-overdue",
    )!;
    expect(restoredGirvi.status).toBe("settled");
    expect(restoredGirvi.waivedPaise).toBe(100000);
    expect(restoredGirvi.settlementAmountPaise).toBe(balance - 100000);
    expect(loanSummary(restoredGirvi).balancePaise).toBe(0);
  });
  it("an older backup without the new fields still restores with defaults", () => {
    const w = seedDemo();
    const old = structuredClone(w) as unknown as Record<string, unknown>;
    for (const l of old.loans as Record<string, unknown>[]) {
      delete l.compound;
      delete l.settledAt;
      delete l.settlementAmountPaise;
      delete l.waivedPaise;
      for (const p of l.payments as Record<string, unknown>[])
        delete p.extraPaise;
    }
    const restored = demoMutation(
      emptyWorkspace(makeProfile("Other Shop", "Owner", "")),
      "restore",
      old as never,
    );
    expect(restored.loans.every((l) => l.compound === false)).toBe(true);
    expect(restored.loans.every((l) => l.status === "active")).toBe(true);
    expect(
      restored.loans
        .flatMap((l) => l.payments)
        .every((p) => p.extraPaise === 0),
    ).toBe(true);
  });
});
