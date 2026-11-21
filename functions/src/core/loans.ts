/** Girvi (pawn) + EMI interest, balances, due dates and reminders.
 *
 * Pure functions, shared by the demo mutation, the server handler and
 * the UI — no storage, no network.
 *
 * Interest rule (confirmed with the shopkeeper): monthly SIMPLE
 * interest on the outstanding principal, at the MANUAL rate stored on
 * each record (% per month). Interest accrues per completed calendar
 * month since the start date (or since the last payment): e.g. a loan
 * starting on 15 Oct has 1 month of interest on 15 Nov and 0 on
 * 14 Nov. A payment first settles accrued interest, then reduces
 * the principal — so paying the interest on time stops the principal
 * from shrinking, and paying extra shrinks the principal and the
 * interest charged on later months.
 */
import type { Loan, Product } from "./model";

export type LoanSummary = {
  /** Original principal (cash given / item price minus upfront). */
  principalPaise: number;
  /** All interest accrued up to asOf, including interest already paid. */
  interestAccruedPaise: number;
  interestPaidPaise: number;
  principalPaidPaise: number;
  /** Sum of all payments recorded. */
  paidPaise: number;
  outstandingPrincipalPaise: number;
  outstandingInterestPaise: number;
  /** What the customer still owes: principal + interest outstanding. */
  totalDuePaise: number;
  /** Same as totalDue — the balance. */
  balancePaise: number;
};

/** Today as a YYYY-MM-DD calendar date in the shop's timezone. */
export function todayDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Whole calendar months between two YYYY-MM-DD dates. A month counts
 * only once its anniversary day is reached: 15 Oct → 14 Nov is 0,
 * 15 Oct → 15 Nov is 1. */
export function wholeMonthsBetween(fromDay: string, toDay: string): number {
  const f = parseDay(fromDay),
    t = parseDay(toDay);
  let months =
    (t.getUTCFullYear() - f.getUTCFullYear()) * 12 +
    (t.getUTCMonth() - f.getUTCMonth());
  if (t.getUTCDate() < f.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (parseDay(toDay).getTime() - parseDay(fromDay).getTime()) / 86400000,
  );
}

/** Chronological simulation: accrue interest per completed month on
 * the outstanding principal, apply each payment interest-first, then
 * accrue up to asOf. */
export function loanSummary(loan: Loan, asOfDay = todayDay()): LoanSummary {
  const rate = loan.interestRatePct / 100;
  let outstandingPrincipal = loan.principalPaise;
  let accrued = 0,
    settledInterest = 0,
    settledPrincipal = 0,
    paid = 0,
    last = loan.startAt;
  const payments = [...loan.payments].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const accrueTo = (day: string) => {
    const months = wholeMonthsBetween(last, day);
    if (months > 0 && outstandingPrincipal > 0)
      accrued += Math.round(outstandingPrincipal * rate * months);
    if (day > last) last = day;
  };
  for (const p of payments) {
    const pDay = p.at.slice(0, 10);
    accrueTo(pDay < loan.startAt ? loan.startAt : pDay);
    paid += p.amountPaise;
    const toInterest = Math.min(
      p.amountPaise,
      Math.max(0, accrued - settledInterest),
    );
    settledInterest += toInterest;
    const toPrincipal = Math.min(p.amountPaise - toInterest, outstandingPrincipal);
    settledPrincipal += toPrincipal;
    outstandingPrincipal -= toPrincipal;
    // Any excess over the total due is ignored — the record never goes negative.
  }
  accrueTo(asOfDay < last ? last : asOfDay);
  const outstandingInterest = Math.max(0, accrued - settledInterest);
  const totalDue = outstandingPrincipal + outstandingInterest;
  return {
    principalPaise: loan.principalPaise,
    interestAccruedPaise: accrued,
    interestPaidPaise: settledInterest,
    principalPaidPaise: settledPrincipal,
    paidPaise: paid,
    outstandingPrincipalPaise: outstandingPrincipal,
    outstandingInterestPaise: outstandingInterest,
    totalDuePaise: totalDue,
    balancePaise: totalDue,
  };
}

/** One month's interest on the current outstanding principal — the
 * "is mahine ka byaj" figure in the reminder message. */
export function currentMonthInterestPaise(
  loan: Loan,
  asOfDay = todayDay(),
): number {
  const s = loanSummary(loan, asOfDay);
  return Math.round((s.outstandingPrincipalPaise * loan.interestRatePct) / 100);
}

export type LoanState = "active" | "due-soon" | "overdue" | "repaid" | "forfeited";

export function loanState(loan: Loan, asOfDay = todayDay()): LoanState {
  if (loan.status === "forfeited") return "forfeited";
  const s = loanSummary(loan, asOfDay);
  if (s.balancePaise <= 0) return "repaid";
  if (asOfDay > loan.dueAt) return "overdue";
  if (daysBetween(asOfDay, loan.dueAt) <= 7) return "due-soon";
  return "active";
}

export function isOverdue(loan: Loan, asOfDay = todayDay()): boolean {
  return loanState(loan, asOfDay) === "overdue";
}

/** Records that need a reminder today: overdue first, then due within
 * 7 days. Repaid and forfeited records never appear. */
export function dueLoans(loans: Loan[], asOfDay = todayDay()): Loan[] {
  return loans
    .filter((l) => {
      const s = loanState(l, asOfDay);
      return s === "overdue" || s === "due-soon";
    })
    .sort((a, b) => {
      const sa = loanState(a, asOfDay),
        sb = loanState(b, asOfDay);
      if (sa !== sb) return sa === "overdue" ? -1 : 1;
      return a.dueAt.localeCompare(b.dueAt);
    });
}

const inr = (paise: number) =>
  `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** Hindi reminder text for one due record. X = outstanding principal
 * (bakaya), Y = this month's interest, Z = total due. */
export function reminderMessage(
  loan: Loan,
  customerName: string,
  shopName: string,
  asOfDay = todayDay(),
): string {
  const s = loanSummary(loan, asOfDay);
  return (
    `Namaste ${customerName} ji, aapka ${shopName} me ` +
    `${inr(s.outstandingPrincipalPaise)} bakaya hai. Is mahine ka byaj ` +
    `${inr(currentMonthInterestPaise(loan, asOfDay))} bana, kul ` +
    `${inr(s.totalDuePaise)} ho gaya hai. Kripya jald bhugtan karein.`
  );
}

/** WhatsApp one-tap link with the message prefilled. Indian 10-digit
 * numbers get the 91 country code; without a usable number the link
 * opens WhatsApp's share sheet so the shopkeeper picks the contact. */
export function whatsappLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  const text = encodeURIComponent(message);
  if (digits.length === 10) return `https://wa.me/91${digits}?text=${text}`;
  if (digits.length >= 11) return `https://wa.me/${digits}?text=${text}`;
  return `https://api.whatsapp.com/send?text=${text}`;
}

/** The stock entry created when a girvi record is forfeited: the
 * collateral becomes the shop's item, valued at the balance still
 * owed when it was forfeited. */
export function forfeitedProduct(loan: Loan, balancePaise: number): Product {
  const short = loan.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase();
  return {
    id: `product-forfeit-${loan.id.replace(/^loan-/, "").slice(0, 40)}`,
    sku: `GRV-${short}`,
    name: loan.itemName,
    category: "Forfeited",
    metal: loan.itemMetal,
    purity: loan.itemPurity,
    gross: loan.itemWeight,
    stone: 0,
    deduction: 0,
    stock: 1,
    cost: Number((balancePaise / 100).toFixed(2)),
    makingMode: "Fixed",
    making: 0,
    hsn: "7113",
    huid: "",
  };
}
