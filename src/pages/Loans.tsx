import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, HandCoins, MessageCircle, Plus, Scale } from "lucide-react";
import { useShop, useToast } from "../lib/store";
import { rupee, day, err, key } from "../lib/format";
import { useClosePanel } from "../lib/navigation";
import {
  Avatar,
  Empty,
  Field,
  Modal,
  PageHead,
  Problem,
  Records,
  Select,
  Status,
} from "../components/ui";
import {
  loanSchema,
  tenderModes,
  type Loan,
  type LoanPayment,
  type TenderMode,
} from "../../functions/src/core/model";
import {
  currentMonthInterestPaise,
  dueLoans,
  loanState,
  loanSummary,
  quickPayAmounts,
  receiptMessage,
  reminderMessage,
  todayDay,
  whatsappLink,
} from "../../functions/src/core/loans";
import {
  isAutoSmsSupported,
  loadAutoSmsSettings,
  loadSentLog,
  sentTodayLoanIds,
} from "../lib/autoSms";

const stateText = (l: Loan) =>
  ({
    active: "Active",
    "due-soon": "Due soon",
    overdue: "Overdue",
    repaid: "Repaid",
    forfeited: "Forfeited",
    settled: "Settled",
  })[loanState(l)];

function customerName(data: { customers: { id: string; name: string }[] }, id: string) {
  return data.customers.find((c) => c.id === id)?.name ?? "Unknown customer";
}

function LoanForm({ close }: { close: () => void }) {
  const { data, perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [kind, K] = useState<"girvi" | "emi">("girvi"),
    [customerId, C] = useState(data.customers[0]?.id ?? ""),
    [itemName, N] = useState(""),
    [itemMetal, M] = useState("Gold"),
    [itemPurity, P] = useState("22K"),
    [weight, W] = useState(""),
    [principal, PR] = useState(""),
    [total, T] = useState(""),
    [upfront, U] = useState(""),
    [rate, R] = useState("2"),
    [compound, CP] = useState(false),
    [startAt, S] = useState(todayDay()),
    [dueAt, D] = useState(
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    );
  const submit = async () => {
    E("");
    const num = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    try {
      if (!customerId) throw Error("Add a customer first, then create the record.");
      if (!itemName.trim()) throw Error("Enter the item name.");
      const principalRs = kind === "girvi" ? num(principal) : num(total) - num(upfront);
      const totalRs = kind === "girvi" ? num(principal) : num(total);
      const upfrontRs = kind === "girvi" ? 0 : num(upfront);
      if (!Number.isFinite(principalRs) || principalRs <= 0)
        throw Error(
          kind === "girvi"
            ? "Enter the cash given."
            : "Item price must be more than the upfront paid.",
        );
      const ratePct = num(rate);
      if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100)
        throw Error("Enter the monthly interest rate (0–100%).");
      const w = num(weight);
      if (kind === "girvi" && (!Number.isFinite(w) || w <= 0))
        throw Error("Girvi needs the item weight — the collateral goes to stock if it is forfeited.");
      const loan: Loan = loanSchema.parse({
        id: `loan-${key()}`,
        kind,
        customerId,
        itemName: itemName.trim(),
        itemMetal: itemMetal.trim() || "Gold",
        itemPurity: itemPurity.trim() || "",
        itemWeight: Number.isFinite(w) && w > 0 ? w : 0,
        principalPaise: Math.round(principalRs * 100),
        totalPaise: Math.round(totalRs * 100),
        upfrontPaise: Math.round(upfrontRs * 100),
        interestRatePct: ratePct,
        compound,
        startAt,
        dueAt,
        payments: [],
        status: "active",
        createdAt: new Date().toISOString(),
      });
      B(true);
      await perform("loan", loan);
      notify(kind === "girvi" ? "Girvi record added." : "EMI record added.");
      close();
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
    }
  };
  return (
    <div>
      <div className="form-grid">
        <div className="field full">
          <span>Type</span>
          <span className="seg-row">
            <button
              type="button"
              className={"btn " + (kind === "girvi" ? "primary" : "outline")}
              onClick={() => K("girvi")}
            >
              <Scale size={15} /> Girvi (pawn)
            </button>
            <button
              type="button"
              className={"btn " + (kind === "emi" ? "primary" : "outline")}
              onClick={() => K("emi")}
            >
              <HandCoins size={15} /> EMI / kist
            </button>
          </span>
        </div>
        <Field label="Customer" full>
          <Select value={customerId} onChange={(e) => C(e.target.value)}>
            {data.customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.phone ? ` · ${c.phone}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Item name" full>
          <input
            value={itemName}
            onChange={(e) => N(e.target.value)}
            placeholder={kind === "girvi" ? "e.g. Gold necklace 22K" : "e.g. Temple gold necklace"}
          />
        </Field>
        <Field label="Metal">
          <input value={itemMetal} onChange={(e) => M(e.target.value)} />
        </Field>
        <Field label="Purity">
          <input value={itemPurity} onChange={(e) => P(e.target.value)} placeholder="22K" />
        </Field>
        <Field label={kind === "girvi" ? "Weight (grams) *" : "Weight (grams)"}>
          <input
            type="number"
            min="0"
            step="0.001"
            value={weight}
            onChange={(e) => W(e.target.value)}
            placeholder="e.g. 12.5"
          />
        </Field>
        {kind === "girvi" ? (
          <Field label="Cash given (₹)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={principal}
              onChange={(e) => PR(e.target.value)}
              placeholder="e.g. 50000"
            />
          </Field>
        ) : (
          <>
            <Field label="Item price (₹)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={total}
                onChange={(e) => T(e.target.value)}
                placeholder="e.g. 151200"
              />
            </Field>
            <Field label="Paid now / upfront (₹)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={upfront}
                onChange={(e) => U(e.target.value)}
                placeholder="e.g. 51200"
              />
            </Field>
          </>
        )}
        <Field label="Interest rate — manual (% per month)" hint="Har record par apne hisab se rate dalen. Baad me nahi badlega.">
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={rate}
            onChange={(e) => R(e.target.value)}
          />
        </Field>
        <Field label="Chakravarti byaj (compound)" hint="OFF ho to simple byaj — sirf principal par. ON ho to baki byaj par bhi byaj lagega.">
          <label className="check-line">
            <input
              type="checkbox"
              checked={compound}
              onChange={(e) => CP(e.target.checked)}
            />
            Compound interest ON karen
          </label>
        </Field>
        <Field label="Start date">
          <input type="date" value={startAt} onChange={(e) => S(e.target.value)} />
        </Field>
        <Field label={kind === "girvi" ? "Validity / due date" : "Due date (full payment by)"}>
          <input type="date" value={dueAt} onChange={(e) => D(e.target.value)} />
        </Field>
      </div>
      <p className="muted">
        {kind === "girvi"
          ? compound
            ? "Chakravarti byaj ON hai — har mahine baki byaj par bhi byaj lagega. Date tak pure paise wapas na aaye to record overdue hoga aur aap ek tap se item ko dukaan ka kar sakte hain."
            : "Byaj mahine ka simple hoga, bakaya rakam par. Date tak pure paise wapas na aaye to record overdue hoga aur aap ek tap se item ko dukaan ka kar sakte hain."
          : "Koi fixed kist nahi — customer jab chahe jitna chahe de sakta hai. Har payment pehle byaj me, phir principal me jayegi."}
      </p>
      <Problem message={error} />
      <div className="modal-actions">
        <button disabled={busy} className="btn primary" onClick={submit}>
          {busy ? "Saving…" : kind === "girvi" ? "Add girvi record" : "Add EMI record"}
        </button>
      </div>
    </div>
  );
}

function PaymentForm({
  loan,
  close,
  onDone,
}: {
  loan: Loan;
  close: () => void;
  onDone: (payment: LoanPayment) => void;
}) {
  const { data, perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [amount, A] = useState(""),
    [mode, MO] = useState<TenderMode>("Cash"),
    [date, DT] = useState(todayDay()),
    [note, NO] = useState("");
  const balance = loanSummary(loan).balancePaise;
  const amountPaise = Math.round(Number(amount) * 100);
  const over = Number.isFinite(Number(amount)) && amountPaise > balance
    ? amountPaise - balance
    : 0;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        E("");
        const rs = Number(amount);
        if (!Number.isFinite(rs) || rs <= 0) return E("Enter the amount received.");
        const payment: LoanPayment = {
          id: `loanpay-${key()}`,
          at: new Date(`${date}T12:00:00`).toISOString(),
          amountPaise: Math.round(rs * 100),
          mode,
          ...(note.trim() ? { note: note.trim() } : {}),
          extraPaise: Math.max(0, Math.round(rs * 100) - balance),
        };
        try {
          B(true);
          await perform("loanPayment", { loanId: loan.id, payment });
          notify("Payment recorded.");
          onDone(payment);
          close();
        } catch (e2) {
          E(err(e2));
        } finally {
          B(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Amount received (₹)" hint="Manual payment — koi bhi amount, balance se zyada bhi de sakte hain. Zyada amount extra record hoga aur mamla khatam ho jayega.">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => A(e.target.value)}
            placeholder={`Balance due ${rupee(balance, 2)}`}
          />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => MO(e.target.value as TenderMode)}>
            {tenderModes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => DT(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => NO(e.target.value)} placeholder="e.g. byaj ke liye" />
        </Field>
      </div>
      {over > 0 && (
        <p className="muted">
          Ye amount balance se {rupee(over, 2)} zyada hai — extra record hoga
          aur mamla khatam ho jayega.
        </p>
      )}
      <Problem message={error} />
      <div className="modal-actions">
        <button disabled={busy} className="btn primary">
          {busy ? "Saving…" : "Record payment"}
        </button>
      </div>
    </form>
  );
}

/**
 * Quick payment — "Payment liya" from the due list itself. Cash at
 * the counter, one tap: the amount is pre-filled with the full
 * balance due, with quick chips for the full balance and for this
 * month's interest only. One confirm records it through the normal
 * Record payment path (interest-first allocation, manual overpayment
 * rules) — so the month list gets its ✓ and a fully-paid record
 * drops off the due list at once.
 */
function QuickPayForm({
  loan,
  close,
  onDone,
}: {
  loan: Loan;
  close: () => void;
  onDone: (payment: LoanPayment) => void;
}) {
  const { perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [mode, MO] = useState<TenderMode>("Cash");
  const { fullPaise, monthInterestPaise } = quickPayAmounts(loan);
  const rupees = (paise: number) =>
    Number((paise / 100).toFixed(2)).toString();
  const [amount, A] = useState(rupees(fullPaise));
  const amountPaise = Math.round(Number(amount) * 100);
  const over =
    Number.isFinite(Number(amount)) && amountPaise > fullPaise
      ? amountPaise - fullPaise
      : 0;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        E("");
        const rs = Number(amount);
        if (!Number.isFinite(rs) || rs <= 0)
          return E("Enter the amount received.");
        const payment: LoanPayment = {
          id: `loanpay-${key()}`,
          at: new Date().toISOString(),
          amountPaise: Math.round(rs * 100),
          mode,
          extraPaise: Math.max(0, Math.round(rs * 100) - fullPaise),
        };
        try {
          B(true);
          await perform("loanPayment", { loanId: loan.id, payment });
          notify("Payment recorded.");
          onDone(payment);
          close();
        } catch (e2) {
          E(err(e2));
        } finally {
          B(false);
        }
      }}
    >
      <div className="form-grid">
        <Field
          label="Amount received (₹)"
          full
          hint="Cash counter par liya — ek tap me record ho jayega, baad ke liye pending nahi rahega."
        >
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => A(e.target.value)}
            placeholder={`Balance due ${rupee(fullPaise, 2)}`}
          />
        </Field>
        <div className="field full">
          <span>Quick amount</span>
          <span className="seg-row">
            <button
              type="button"
              className="btn outline"
              onClick={() => A(rupees(fullPaise))}
            >
              Poora bakaya {rupee(fullPaise, 2)}
            </button>
            <button
              type="button"
              className="btn outline"
              disabled={monthInterestPaise <= 0}
              onClick={() => A(rupees(monthInterestPaise))}
            >
              Sirf is mahine ka byaj {rupee(monthInterestPaise, 2)}
            </button>
          </span>
        </div>
        <Field label="Mode">
          <Select
            value={mode}
            onChange={(e) => MO(e.target.value as TenderMode)}
          >
            {tenderModes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </div>
      {over > 0 && (
        <p className="muted">
          Ye amount balance se {rupee(over, 2)} zyada hai — extra record hoga
          aur mamla khatam ho jayega.
        </p>
      )}
      <Problem message={error} />
      <div className="modal-actions">
        <button disabled={busy} className="btn primary">
          {busy ? "Saving…" : "Payment liya — record karen"}
        </button>
      </div>
    </form>
  );
}

function SettlementForm({
  loan,
  close,
  onDone,
}: {
  loan: Loan;
  close: () => void;
  onDone: (payment: LoanPayment) => void;
}) {
  const { data, perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [amount, A] = useState(""),
    [mode, MO] = useState<TenderMode>("Cash"),
    [date, DT] = useState(todayDay()),
    [note, NO] = useState("");
  const balance = loanSummary(loan).balancePaise;
  const amountPaise = Math.round(Number(amount) * 100);
  const waived =
    Number.isFinite(Number(amount)) && amountPaise > 0 && amountPaise < balance
      ? balance - amountPaise
      : 0;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        E("");
        const rs = Number(amount);
        if (!Number.isFinite(rs) || rs <= 0) return E("Enter the settlement amount.");
        if (Math.round(rs * 100) >= balance)
          return E(
            `Settlement amount must be less than the balance due (${rupee(balance, 2)}) — for a full payment, use Record payment.`,
          );
        const payment: LoanPayment = {
          id: `loanpay-${key()}`,
          at: new Date(`${date}T12:00:00`).toISOString(),
          amountPaise: Math.round(rs * 100),
          mode,
          note: note.trim() ? note.trim() : "Settlement — mamla khatam",
          extraPaise: 0,
        };
        try {
          B(true);
          await perform("loanSettle", { loanId: loan.id, payment });
          notify("Mamla khatam — record settled.");
          onDone(payment);
          close();
        } catch (e2) {
          E(err(e2));
        } finally {
          B(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Settlement amount (₹)" hint={`Balance due ${rupee(balance, 2)} — isse kam amount par mamla khatam hoga, baaki maaf ho jayega.`}>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => A(e.target.value)}
            placeholder={`Less than ${rupee(balance, 2)}`}
          />
        </Field>
        <Field label="Mode">
          <Select value={mode} onChange={(e) => MO(e.target.value as TenderMode)}>
            {tenderModes.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => DT(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input value={note} onChange={(e) => NO(e.target.value)} placeholder="e.g. mamla khatam" />
        </Field>
      </div>
      {waived > 0 && (
        <p className="muted">
          Mamla khatam hoga — {rupee(waived, 2)} maaf ho jayega.
        </p>
      )}
      <Problem message={error} />
      <div className="modal-actions">
        <button disabled={busy} className="btn primary">
          {busy ? "Saving…" : "Mamla khatam karen"}
        </button>
      </div>
    </form>
  );
}

function LoanDetail({ loan }: { loan: Loan }) {
  const { data, perform } = useShop(),
    notify = useToast(),
    [error, E] = useState(""),
    [showPay, SP] = useState(false),
    [showSettle, SS] = useState(false),
    [confirmForfeit, CF] = useState(false),
    [busy, B] = useState(false),
    [compoundBusy, CB] = useState(false),
    [receipt, setReceipt] = useState<null | {
      payment: LoanPayment;
      settled: boolean;
    }>(null);
  const s = loanSummary(loan),
    state = loanState(loan),
    isOpen = state === "active" || state === "due-soon" || state === "overdue",
    name = customerName(data, loan.customerId),
    customer = data.customers.find((c) => c.id === loan.customerId),
    msg = reminderMessage(loan, name, data.profile.shopName);
  const forfeit = async () => {
    E("");
    try {
      B(true);
      await perform("loanForfeit", { loanId: loan.id });
      notify("Forfeited — the item is now shop stock.");
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
      CF(false);
    }
  };
  const toggleCompound = async (next: boolean) => {
    E("");
    try {
      CB(true);
      await perform("loanCompound", { loanId: loan.id, compound: next });
      notify(
        next
          ? "Compound interest ON — baki byaj par bhi byaj lagega."
          : "Compound interest OFF — ab simple byaj lagega.",
      );
    } catch (e) {
      E(err(e));
    } finally {
      CB(false);
    }
  };
  return (
    <>
      <div className="identity-row">
        <Avatar name={name} />
        <div>
          <h3>{name}</h3>
          <p>
            {loan.kind === "girvi" ? "Girvi (pawn)" : "EMI / kist"} · {loan.itemName} ·{" "}
            {loan.itemMetal} {loan.itemPurity}
            {loan.itemWeight ? ` · ${loan.itemWeight} g` : ""}
          </p>
        </div>
        <Status text={stateText(loan)} />
      </div>
      <p className="muted">
        Start {day(loan.startAt)} · Due {day(loan.dueAt)} · Interest{" "}
        {loan.interestRatePct}% per month (manual)
        {loan.compound ? " · Compound (chakravarti) ON" : " · Simple"}
        {loan.status === "forfeited" &&
          loan.forfeitedAt &&
          ` · Forfeited ${day(loan.forfeitedAt)} — item moved to stock`}
        {loan.status === "settled" &&
          loan.settledAt &&
          ` · Settled ${day(loan.settledAt)} — mamla khatam`}
      </p>
      {receipt && (
        <>
          <div className="balance-banner">
            <span>
              <Check size={18} />{" "}
              {receipt.settled ? "Mamla khatam ho gaya" : "Payment mil gaya"}
            </span>
            <strong>{rupee(receipt.payment.amountPaise, 2)}</strong>
          </div>
          <p className="muted">
            Ab kul bakaya {rupee(s.balancePaise, 2)} hai.
            {receipt.settled && loan.waivedPaise
              ? ` ${rupee(loan.waivedPaise, 2)} maaf kiya gaya.`
              : ""}
          </p>
          <div className="modal-actions">
            <a
              className="btn gold"
              href={whatsappLink(
                customer?.phone ?? "",
                receiptMessage(loan, receipt.payment, name, data.profile.shopName),
              )}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={15} /> WhatsApp receipt bhejen
            </a>
          </div>
        </>
      )}
      {state === "settled" ? (
        <div className="balance-banner">
          <span>Mamla khatam — settlement mila</span>
          <strong>{rupee(loan.settlementAmountPaise ?? 0, 2)}</strong>
        </div>
      ) : (
        <div className="balance-banner">
          <span>Balance due</span>
          <strong>{rupee(s.balancePaise, 2)}</strong>
        </div>
      )}
      {isOpen && (
        <label className="check-line spaced">
          <input
            type="checkbox"
            checked={loan.compound ?? false}
            disabled={compoundBusy}
            onChange={(e) => void toggleCompound(e.target.checked)}
          />
          Chakravarti byaj (compound){" "}
          {loan.compound ? "ON — baki byaj par bhi byaj lagega" : "OFF — sirf principal par byaj lagega"}
        </label>
      )}
      <div className="pick-list">
        {(
          [
            ["Principal (original)", rupee(s.principalPaise, 2)],
            ["Principal outstanding", rupee(s.outstandingPrincipalPaise, 2)],
            ["Interest accrued till today", rupee(s.interestAccruedPaise, 2)],
            ["Interest outstanding", rupee(s.outstandingInterestPaise, 2)],
            ["This month's interest", rupee(currentMonthInterestPaise(loan), 2)],
            ["Interest type", loan.compound ? "Compound (chakravarti)" : "Simple"],
            ["Paid so far", rupee(s.paidPaise, 2)],
            ...(s.extraPaidPaise > 0
              ? ([["Extra paid (balance se zyada)", rupee(s.extraPaidPaise, 2)]] as const)
              : []),
            ...(loan.status === "settled"
              ? ([
                  ["Settlement amount", rupee(loan.settlementAmountPaise ?? 0, 2)],
                  ["Waived (maaf kiya)", rupee(loan.waivedPaise ?? 0, 2)],
                ] as const)
              : []),
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="kv-row">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      <h3 className="spaced">Mahine-wise byaj</h3>
      <div className="pick-list">
        {s.buckets.map((b) => (
          <div key={b.dueDay} className="kv-row">
            <span>
              {b.label} ka byaj
              {b.unpaidPaise === 0 && (
                <>
                  {" "}
                  <Check size={15} /> paid
                </>
              )}
            </span>
            <b>
              {rupee(b.interestPaise, 2)}
              {b.unpaidPaise > 0 && ` · baki ${rupee(b.unpaidPaise, 2)}`}
              {b.waivedPaise > 0 && ` · maaf ${rupee(b.waivedPaise, 2)}`}
            </b>
          </div>
        ))}
        {!s.buckets.length && (
          <Empty title="Abhi tak byaj nahi bana hai" text="Poora mahina hone par har mahine ka byaj yahan aayega." />
        )}
      </div>
      <h3 className="spaced">Payment history</h3>
      <div className="pick-list">
        {[...loan.payments].reverse().map((p) => (
          <div key={p.id} className="kv-row">
            <span>
              <Check size={15} /> {day(p.at)} · {p.mode}
              {p.note ? ` · ${p.note}` : ""}
              {p.extraPaise > 0 ? ` · Extra ${rupee(p.extraPaise, 2)}` : ""}
            </span>
            <b>{rupee(p.amountPaise, 2)}</b>
          </div>
        ))}
        {!loan.payments.length && (
          <Empty title="No payments yet" text="Payments recorded here reduce the interest first, then the principal." />
        )}
      </div>
      <Problem message={error} />
      <div className="modal-actions">
        {isOpen && (
          <>
            <button className="btn primary" onClick={() => { SP((v) => !v); SS(false); }}>
              Record payment
            </button>
            <button className="btn outline" onClick={() => { SS((v) => !v); SP(false); }}>
              Mamla khatam (settlement)
            </button>
            <a
              className="btn gold"
              href={whatsappLink(customer?.phone ?? "", msg)}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={15} /> WhatsApp reminder
            </a>
          </>
        )}
        {loan.kind === "girvi" && isOpen && (
          <button
            disabled={busy}
            className="btn danger"
            onClick={() => (confirmForfeit ? void forfeit() : CF(true))}
          >
            {confirmForfeit
              ? "Confirm — item dukaan ka karen?"
              : "Forfeit — item dukaan ka karen"}
          </button>
        )}
      </div>
      {showPay && isOpen && (
        <PaymentForm
          loan={loan}
          close={() => SP(false)}
          onDone={(p) => setReceipt({ payment: p, settled: false })}
        />
      )}
      {showSettle && isOpen && (
        <SettlementForm
          loan={loan}
          close={() => SS(false)}
          onDone={(p) => setReceipt({ payment: p, settled: true })}
        />
      )}
      {state === "forfeited" && (
        <p className="muted">
          Forfeited — the collateral is now shop stock (see Inventory, category
          “Forfeited”).
        </p>
      )}
      {state === "settled" && (
        <p className="muted">
          Mamla khatam — settlement {rupee(loan.settlementAmountPaise ?? 0, 2)}{" "}
          mila aur {rupee(loan.waivedPaise ?? 0, 2)} maaf kiya gaya. Is record
          par aur payment nahi ho sakti.
        </p>
      )}
    </>
  );
}

export function Loans() {
  const closePanel = useClosePanel();
  const { data } = useShop(),
    [params, P] = useSearchParams();
  const selected = (data.loans ?? []).find((l) => l.id === params.get("item")),
    due = useMemo(() => dueLoans(data.loans ?? []), [data.loans]),
    totalDue = (data.loans ?? []).reduce(
      (n, l) => n + loanSummary(l).balancePaise,
      0,
    );
  const [sentToday, setSentToday] = useState<Set<string>>(new Set()),
    [autoSmsOn] = useState(() => loadAutoSmsSettings().enabled),
    [quickPay, setQuickPay] = useState<Loan | null>(null),
    [quickReceipt, setQuickReceipt] = useState<{
      loanId: string;
      payment: LoanPayment;
    } | null>(null);
  // Record whose quick payment was just recorded — the receipt panel
  // reads the live record, so the balance shown is post-payment, the
  // paid month(s) already show ✓ in the detail, and a fully-paid
  // record has already dropped off the due list.
  const quickLoan = quickReceipt
    ? (data.loans ?? []).find((l) => l.id === quickReceipt.loanId)
    : undefined;
  // Which due records got their SMS today (native sent log) — shown
  // as "aaj SMS bhej diya ✓" so the shopkeeper knows at a glance.
  useEffect(() => {
    if (!isAutoSmsSupported()) return;
    void (async () => setSentToday(sentTodayLoanIds(await loadSentLog())))();
  }, []);
  return (
    <>
      <PageHead
        eyebrow="GIRVI & EMI"
        title="Girvi & EMI"
        subtitle="Pawn loans and instalment sales — manual interest, flexible payments, due-date reminders."
      >
        <button className="btn primary" onClick={() => P({ new: "1" })}>
          <Plus size={16} />
          New record
        </button>
      </PageHead>
      {quickReceipt && quickLoan && (
        <section className="panel">
          <div className="balance-banner">
            <span>
              <Check size={18} /> Payment mil gaya
            </span>
            <strong>{rupee(quickReceipt.payment.amountPaise, 2)}</strong>
          </div>
          <p className="muted">
            {customerName(data, quickLoan.customerId)} · Ab kul bakaya{" "}
            {rupee(loanSummary(quickLoan).balancePaise, 2)} hai.
            {loanSummary(quickLoan).balancePaise === 0
              ? " Mamla khatam ho gaya — record due list se hat gaya."
              : ""}
          </p>
          <div className="modal-actions">
            {data.customers.find((c) => c.id === quickLoan.customerId)
              ?.phone && (
              <a
                className="btn gold"
                href={whatsappLink(
                  data.customers.find((c) => c.id === quickLoan.customerId)
                    ?.phone ?? "",
                  receiptMessage(
                    quickLoan,
                    quickReceipt.payment,
                    customerName(data, quickLoan.customerId),
                    data.profile.shopName,
                  ),
                )}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={15} /> WhatsApp receipt bhejen
              </a>
            )}
            <button
              className="btn outline"
              onClick={() => setQuickReceipt(null)}
            >
              Theek hai
            </button>
          </div>
        </section>
      )}
      {due.length > 0 && (
        <section className="panel">
          <h2>Due today / overdue — reminder bhejen</h2>
          <p className="muted">
            Roz subah yahi list check karen. WhatsApp par tap karte hi message
            ready milega — bas send dabana hai.
            {autoSmsOn
              ? " Automatic SMS ON hai — roz subah 10 baje ye reminders SMS se bhi jayenge (jinka number hai)."
              : ""}
          </p>
          <div className="pick-list">
            {due.map((l) => {
              const name = customerName(data, l.customerId),
                s = loanSummary(l),
                customer = data.customers.find((c) => c.id === l.customerId);
              return (
                <div key={l.id} className="kv-row">
                  <span>
                    <strong>{name}</strong> · {l.itemName}
                    <small>
                      {" "}
                      · {loanState(l) === "overdue" ? "Overdue since" : "Due"}{" "}
                      {day(l.dueAt)} · Balance {rupee(s.balancePaise, 2)}
                      {sentToday.has(l.id)
                        ? " · aaj SMS bhej diya ✓"
                        : !customer?.phone
                          ? " · number nahi hai — SMS nahi jayega"
                          : ""}
                    </small>
                  </span>
                  <span className="seg-row">
                    <button
                      className="btn primary"
                      onClick={() => {
                        setQuickReceipt(null);
                        setQuickPay(l);
                      }}
                    >
                      Payment liya
                    </button>
                    <a
                      className="btn gold"
                      href={whatsappLink(
                        customer?.phone ?? "",
                        reminderMessage(l, name, data.profile.shopName),
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle size={15} /> WhatsApp
                    </a>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <p className="muted">
        {(data.loans ?? []).filter((l) => loanState(l) !== "repaid" && loanState(l) !== "forfeited").length}{" "}
        active records · Total balance due {rupee(totalDue, 2)}
      </p>
      <Records
        items={data.loans ?? []}
        search={(l) => customerName(data, l.customerId) + " " + l.itemName}
        placeholder="Find by customer or item…"
        action={(l) => P({ item: l.id })}
        columns={[
          {
            label: "Customer",
            value: (l) => (
              <div className="person">
                <Avatar name={customerName(data, l.customerId)} index={data.customers.findIndex((c) => c.id === l.customerId)} />
                <strong>{customerName(data, l.customerId)}</strong>
              </div>
            ),
            sort: (l) => customerName(data, l.customerId),
          },
          {
            label: "Item",
            value: (l) => `${l.itemName} · ${l.itemMetal} ${l.itemPurity}`,
          },
          {
            label: "Type",
            value: (l) => (l.kind === "girvi" ? "Girvi" : "EMI"),
          },
          {
            label: "Due date",
            value: (l) => day(l.dueAt),
            sort: (l) => l.dueAt,
          },
          {
            label: "Balance due",
            value: (l) => <strong>{rupee(loanSummary(l).balancePaise, 2)}</strong>,
            sort: (l) => loanSummary(l).balancePaise,
            align: "right",
          },
          {
            label: "Status",
            value: (l) => <Status text={stateText(l)} />,
          },
        ]}
      />
      <Modal
        open={params.has("new")}
        title="New girvi / EMI record"
        description="Interest rate is manual — enter it per record. It never changes later."
        routePanel
        wide
        onClose={closePanel}
      >
        <LoanForm close={closePanel} />
      </Modal>
      <Modal
        open={!!selected}
        title={selected?.kind === "emi" ? "EMI record" : "Girvi record"}
        routePanel
        onClose={closePanel}
      >
        {selected && <LoanDetail loan={selected} />}
      </Modal>
      <Modal
        open={!!quickPay}
        title="Payment liya"
        description={
          quickPay
            ? `${customerName(data, quickPay.customerId)} · ${quickPay.itemName} — balance due ${rupee(loanSummary(quickPay).balancePaise, 2)}`
            : undefined
        }
        onClose={() => setQuickPay(null)}
      >
        {quickPay && (
          <QuickPayForm
            loan={quickPay}
            close={() => setQuickPay(null)}
            onDone={(p) =>
              setQuickReceipt({ loanId: quickPay.id, payment: p })
            }
          />
        )}
      </Modal>
    </>
  );
}
