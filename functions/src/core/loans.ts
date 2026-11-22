/** Girvi (pawn) + EMI interest, balances, due dates and reminders.
 *
 * Pure functions, shared by the demo mutation, the server handler and
 * the UI — no storage, no network.
 *
 * Interest rule (confirmed with the shopkeeper): monthly interest on
 * the outstanding principal, at the MANUAL rate stored on each record
 * (% per month). Interest accrues per completed calendar month since
 * the start date (or since the last payment): e.g. a loan starting on
 * 15 Oct has 1 month of interest on 15 Nov and 0 on 14 Nov. A payment
 * first settles accrued interest, then reduces the principal — so
 * paying the interest on time stops the principal from shrinking, and
 * paying extra shrinks the principal and the interest charged on
 * later months. Each completed month is one bucket (labelled by the
 * month it fell due — "July", "September"), and payments settle the
 * oldest buckets first.
 *
 * Chakravarti byaj (compound, OFF by default, per record): when ON,
 * unpaid interest is added to the principal at each month boundary,
 * so the next month's interest is charged on principal + unpaid
 * interest. When OFF, interest is always simple — only on the
 * outstanding principal.
 *
 * A record can close three ways: fully repaid (balance 0), forfeited
 * (girvi only — the collateral moves to stock), or settled (mamla
 * khatam — closed at a smaller amount, the rest waived). A manual
 * payment may be any amount: excess over the balance is recorded as
 * extra and closes the record as repaid.
 */
import type { Loan, LoanPayment, Product } from "./model";

/** One completed month of interest. `label` is the month the interest
 * fell due ("July"); `dueDay` is the anniversary date it completed. */
export type MonthBucket = {
  label: string;
  dueDay: string;
  interestPaise: number;
  paidPaise: number;
  /** Waived by a settlement (mamla khatam) — not paid, but no longer due. */
  waivedPaise: number;
  unpaidPaise: number;
};

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
  /** Per-month interest buckets, oldest first. */
  buckets: MonthBucket[];
  /** Buckets with unpaid interest, oldest first. */
  unpaidBuckets: MonthBucket[];
  /** Extra paid above the total due (manual overpayment), paise. */
  extraPaidPaise: number;
  /** Whether this record compounds unpaid interest monthly. */
  compound: boolean;
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

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonthsClamped(from: Date, months: number): Date {
  const y = from.getUTCFullYear(),
    m = from.getUTCMonth() + months,
    d = from.getUTCDate(),
    lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastDay)));
}

function firstOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Completion dates of each whole month after `fromDay`, up to `toDay`.
 * A month completes on its anniversary day (15 Oct → 15 Nov). For a
 * start on the 29th–31st the anniversary clamps to the month end, and
 * when a month has no such day the month completes on the 1st of the
 * next month — the same rule wholeMonthsBetween uses, so the bucket
 * totals always match the old accrued total. */
export function monthBoundaries(fromDay: string, toDay: string): string[] {
  const f = parseDay(fromDay),
    t = parseDay(toDay);
  const out: string[] = [];
  for (let k = 1; ; k++) {
    const cand = addMonthsClamped(f, k);
    const d =
      wholeMonthsBetween(fromDay, isoDay(cand)) >= k
        ? cand
        : firstOfNextMonth(cand);
    if (d > t) break;
    out.push(isoDay(d));
  }
  return out;
}

/** Chronological simulation: accrue interest per completed month on
 * the outstanding principal, apply each payment interest-first (oldest
 * month buckets first), then accrue up to asOf. With compound ON, each
 * month's interest is charged on principal + unpaid interest. A closed
 * record (settled / forfeited) stops accruing on its closing day. */
export function loanSummary(loan: Loan, asOfDay = todayDay()): LoanSummary {
  const rate = loan.interestRatePct / 100;
  const compound = loan.compound ?? false;
  const closedDay =
    loan.status === "settled"
      ? loan.settledAt?.slice(0, 10)
      : loan.status === "forfeited"
        ? loan.forfeitedAt?.slice(0, 10)
        : undefined;
  const horizon = closedDay && closedDay < asOfDay ? closedDay : asOfDay;
  let outstandingPrincipal = loan.principalPaise;
  let outstandingInterest = 0,
    accrued = 0,
    settledInterest = 0,
    settledPrincipal = 0,
    paid = 0,
    extraPaid = 0,
    last = loan.startAt;
  const buckets: MonthBucket[] = [];
  const payments = [...loan.payments].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  const accrueTo = (day: string) => {
    const target = day > horizon ? horizon : day;
    for (const boundary of monthBoundaries(last, target)) {
      const base = compound
        ? outstandingPrincipal + outstandingInterest
        : outstandingPrincipal;
      const interest = base > 0 ? Math.round(base * rate) : 0;
      if (interest > 0) {
        accrued += interest;
        outstandingInterest += interest;
        buckets.push({
          label: "",
          dueDay: boundary,
          interestPaise: interest,
          paidPaise: 0,
          waivedPaise: 0,
          unpaidPaise: interest,
        });
      }
    }
    if (target > last) last = target;
  };
  for (const p of payments) {
    const pDay = p.at.slice(0, 10);
    accrueTo(pDay < loan.startAt ? loan.startAt : pDay);
    paid += p.amountPaise;
    let remaining = p.amountPaise;
    // Oldest month buckets first.
    for (const b of buckets) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, b.unpaidPaise);
      b.paidPaise += take;
      b.unpaidPaise -= take;
      settledInterest += take;
      remaining -= take;
    }
    const toPrincipal = Math.min(remaining, outstandingPrincipal);
    settledPrincipal += toPrincipal;
    outstandingPrincipal -= toPrincipal;
    remaining -= toPrincipal;
    // Excess over the total due is extra (manual payment) — recorded,
    // never negative, and it closes the record as repaid.
    if (remaining > 0) extraPaid += remaining;
    outstandingInterest = buckets.reduce((n, b) => n + b.unpaidPaise, 0);
  }
  accrueTo(horizon);
  if (loan.status === "settled") {
    // The settlement waives whatever remained at closing: oldest
    // buckets first, then principal. The record is closed — nothing
    // is due, even if interest accrued between the settlement payment
    // date and the closing day.
    let waive = loan.waivedPaise ?? 0;
    for (const b of buckets) {
      if (waive <= 0) break;
      const take = Math.min(waive, b.unpaidPaise);
      b.waivedPaise += take;
      b.unpaidPaise -= take;
      waive -= take;
    }
    for (const b of buckets) {
      b.waivedPaise += b.unpaidPaise;
      b.unpaidPaise = 0;
    }
    outstandingPrincipal = 0;
  }
  outstandingInterest = buckets.reduce((n, b) => n + b.unpaidPaise, 0);
  const totalDue =
    loan.status === "settled"
      ? 0
      : outstandingPrincipal + outstandingInterest;
  // Month labels: the month the interest fell due. If the same month
  // name repeats (a start on the 29th–31st can complete two months in
  // one calendar month), add the completion day so the rows stay
  // distinct — "March 1", "March 31".
  const labels = buckets.map(
    (b) => MONTH_NAMES[parseDay(b.dueDay).getUTCMonth()],
  );
  const counts = new Map<string, number>();
  labels.forEach((l) => counts.set(l, (counts.get(l) ?? 0) + 1));
  buckets.forEach((b, i) => {
    b.label =
      (counts.get(labels[i]) ?? 0) > 1
        ? `${labels[i]} ${parseDay(b.dueDay).getUTCDate()}`
        : labels[i];
  });
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
    buckets,
    unpaidBuckets: buckets.filter((b) => b.unpaidPaise > 0),
    extraPaidPaise: extraPaid,
    compound,
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

export type LoanState =
  | "active"
  | "due-soon"
  | "overdue"
  | "repaid"
  | "forfeited"
  | "settled";

export function loanState(loan: Loan, asOfDay = todayDay()): LoanState {
  if (loan.status === "forfeited") return "forfeited";
  if (loan.status === "settled") return "settled";
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

/** Hindi reminder text for one due record. Only the months whose
 * interest is still unpaid are named — e.g. "July aur September ka
 * byaj mila kar ₹800 hua". When no interest has accrued yet the
 * message says so plainly instead of implying interest already
 * joined the total. */
export function reminderMessage(
  loan: Loan,
  customerName: string,
  shopName: string,
  asOfDay = todayDay(),
): string {
  const s = loanSummary(loan, asOfDay);
  const base =
    `Namaste ${customerName} ji, aapka ${shopName} me ` +
    `${inr(s.outstandingPrincipalPaise)} bakaya hai.`;
  if (s.outstandingInterestPaise <= 0) {
    return (
      `${base} Abhi tak byaj nahi bana hai, kul ` +
      `${inr(s.totalDuePaise)} hai. Kripya jald bhugtan karein.`
    );
  }
  const months = s.unpaidBuckets.map((b) => b.label);
  const monthText =
    months.length === 1
      ? `${months[0]} ka byaj`
      : months.length === 2
        ? `${months[0]} aur ${months[1]} ka byaj`
        : `${months.slice(0, -1).join(", ")} aur ${months[months.length - 1]} ka byaj`;
  return (
    `${base} ${monthText} mila kar ` +
    `${inr(s.outstandingInterestPaise)} hua, kul ` +
    `${inr(s.totalDuePaise)} ho gaya hai. Kripya jald bhugtan karein.`
  );
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-11-12" → "12 Nov 2026", for receipts. */
function shortDay(day: string): string {
  const d = parseDay(day);
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** WhatsApp receipt text after a payment: customer, amount, date,
 * remaining balance. For a settled record it also says the matter is
 * closed and how much was waived. */
export function receiptMessage(
  loan: Loan,
  payment: LoanPayment,
  customerName: string,
  shopName: string,
  asOfDay = todayDay(),
): string {
  const s = loanSummary(loan, asOfDay);
  let msg =
    `Namaste ${customerName} ji, ${shopName} ko ` +
    `${inr(payment.amountPaise)} mila — dhanyavad! ` +
    `${shortDay(payment.at.slice(0, 10))} ko payment mila. ` +
    `Ab kul bakaya ${inr(s.balancePaise)} hai.`;
  if (payment.extraPaise > 0)
    msg += ` Isme se ${inr(payment.extraPaise)} extra mila.`;
  if (loan.status === "settled")
    msg += ` Mamla khatam — ${inr(loan.waivedPaise ?? 0)} maaf kar diya gaya.`;
  return msg;
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
