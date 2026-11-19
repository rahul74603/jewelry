import type { ReactNode } from "react";
import type { BillLine, Invoice } from "../../functions/src/core/model";
import {
  allocations,
  supplyStates,
  titles,
  accountDelta,
} from "../../functions/src/core/documents";
import { paymentStatus } from "../../functions/src/core/billing";
import { day, rupee, cash } from "../lib/format";
import { amountInWords, pageRule } from "../lib/paper";
import "./invoice.css";
const money = (p: number) => rupee(p, 2);
const grams = (n: number) => Number(n.toFixed(3)) + " g";
function Items({ bill: b }: { bill: Invoice }) {
  const hasCharges = b.lines.some(
    (l) =>
      l.makingPaise ||
      l.wastagePaise ||
      l.discountPaise ||
      l.stonePaise ||
      l.otherPaise,
  );
  const tax = b.type === "GST invoice";
  const columns: [string, (line: BillLine) => ReactNode][] = [
    [
      "Item / metal",
      (l) => (
        <>
          <strong>{l.name}</strong>
          <small>
            {l.metal} · {l.purity}
          </small>
          {tax && l.hsn && <small>HSN {l.hsn}</small>}
        </>
      ),
    ],
    ["PCS", (l) => l.quantity],
    [
      "Net weight",
      (l) => (
        <>
          {grams(l.net)}
          {(l.stone > 0 || l.deduction > 0) && (
            <small>Gross {grams(l.gross * l.quantity)}</small>
          )}
          {l.stone > 0 && <small>Stone {grams(l.stone * l.quantity)}</small>}
          {l.deduction > 0 && (
            <small>Less {grams(l.deduction * l.quantity)}</small>
          )}
        </>
      ),
    ],
    ["Rate / g", (l) => cash(l.rate, 2)],
  ];
  if (hasCharges)
    columns.push([
      "Charges / adjustments",
      (l) => (
        <>
          {l.makingPaise !== 0 && (
            <small>
              Making ({l.makingMode}) {money(l.makingPaise)}
            </small>
          )}
          {l.wastagePaise !== 0 && (
            <small>
              Wastage ({l.wastagePct}%) {money(l.wastagePaise)}
            </small>
          )}
          {l.stonePaise !== 0 && <small>Stone {money(l.stonePaise)}</small>}
          {l.otherPaise !== 0 && <small>Other {money(l.otherPaise)}</small>}
          {l.discountPaise !== 0 && (
            <small>Discount −{money(l.discountPaise)}</small>
          )}
        </>
      ),
    ]);
  if (tax)
    columns.push([
      "GST",
      (l) => (
        <>
          {l.taxPercent}%<small>{money(l.taxPaise)}</small>
        </>
      ),
    ]);
  columns.push(["Amount", (l) => <b>{money(l.totalPaise)}</b>]);
  return (
    <>
      <h3 className="paper-kicker">
        Jewellery items{" "}
        <span>{b.lines.length.toString().padStart(2, "0")}</span>
      </h3>
      <table className="paper-items">
        <thead>
          <tr>
            {columns.map(([t]) => (
              <th key={t} scope="col">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.lines.map((l, n) => (
            <tr key={l.productId}>
              {columns.map(([t, render], j) => (
                <td data-label={t} key={t}>
                  {j === 0 && <em>{String(n + 1).padStart(2, "0")}</em>}
                  {render(l)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
function Figure({
  label,
  amount,
  accent,
}: {
  label: string;
  amount: number;
  accent?: string;
}) {
  return (
    <div className={accent}>
      <dt>{label}</dt>
      <dd>{money(amount)}</dd>
    </div>
  );
}
function Breakdown({ bill: b, credit }: { bill: Invoice; credit: boolean }) {
  const entries: [
    string,
    keyof Pick<
      BillLine,
      | "metalPaise"
      | "stonePaise"
      | "makingPaise"
      | "wastagePaise"
      | "otherPaise"
      | "discountPaise"
    >,
  ][] = [
    ["Metal value", "metalPaise"],
    ["Stone value", "stonePaise"],
    ["Making charges", "makingPaise"],
    ["Wastage", "wastagePaise"],
    ["Other charges", "otherPaise"],
    ["Discount", "discountPaise"],
  ];
  const gst = b.type === "GST invoice",
    levies = new Map<string, number>();
  for (const l of b.lines)
    for (const [name, sum] of Object.entries(l.components ?? {}))
      levies.set(name, (levies.get(name) ?? 0) + sum);
  return (
    <section>
      <h3 className="paper-kicker">Amount summary</h3>
      <dl>
        {entries.map(([label, key]) => {
          const value = b.lines.reduce((v, l) => v + l[key], 0);
          return (
            (value !== 0 || key === "metalPaise") && (
              <Figure
                key={key}
                label={label}
                amount={key === "discountPaise" ? -value : value}
              />
            )
          );
        })}
        <Figure
          label={gst ? "Taxable value" : "Subtotal"}
          amount={b.subtotalPaise}
        />
        {gst &&
          (levies.size ? (
            [...levies].map(([t, v]) => <Figure key={t} label={t} amount={v} />)
          ) : (
            <Figure label="GST (as recorded)" amount={b.taxPaise} />
          ))}
        {(b.roundOffPaise !== 0 || b.shop.roundOff) && (
          <Figure label="Round-off" amount={b.roundOffPaise} />
        )}
        <Figure
          accent="paper-total"
          label={credit ? "Credit amount" : "Grand total"}
          amount={b.totalPaise}
        />
      </dl>
    </section>
  );
}
function Payment({ bill: b, credit }: { bill: Invoice; credit: boolean }) {
  const prev = b.previousBalancePaise,
    account = (prev ?? 0) + accountDelta(b);
  return (
    <section>
      <h3 className="paper-kicker">
        {credit ? "Reversal details" : "Payment summary"}
      </h3>
      <dl>
        <Figure
          label={
            credit
              ? "Original bill value"
              : b.type === "Advance receipt"
                ? "Deposit amount"
                : "Bill amount"
          }
          amount={b.totalPaise}
        />
        {!credit && !!prev && (
          <Figure
            label={
              prev < 0 ? "Previous account credit" : "Previous outstanding"
            }
            amount={Math.abs(prev)}
          />
        )}
        {allocations(b.input).map((a) => (
          <Figure
            key={a.mode}
            label={`${credit ? "Receipt reversed" : "Received"} · ${a.mode}`}
            amount={a.amountPaise}
          />
        ))}
        <Figure
          label={credit ? "Total receipts reversed" : "Total received"}
          amount={b.paidPaise}
        />
        {credit ? (
          <Figure label="Dues reversed" amount={b.balancePaise} />
        ) : (
          <>
            {b.type !== "Advance receipt" && (
              <Figure
                accent="paper-balance"
                label="Balance"
                amount={b.balancePaise}
              />
            )}{" "}
            {prev !== undefined &&
              (prev !== 0 || b.type === "Advance receipt") && (
                <Figure
                  label={
                    account < 0
                      ? "Account credit after document"
                      : "Account outstanding after document"
                  }
                  amount={Math.abs(account)}
                />
              )}
          </>
        )}
      </dl>
    </section>
  );
}
/** An issued document accepts only its stored snapshot. Never resolve current shop,
 * product, rates, tax configuration, customer balance or branding while printing. */
export function InvoiceReceipt({
  bill: b,
  sample,
  credit = false,
}: {
  bill: Invoice;
  sample: boolean;
  credit?: boolean;
}) {
  const note = credit ? b.creditNote : undefined,
    shop = note?.shop ?? b.shop,
    issued = note?.issuedAt ?? b.issuedAt,
    kind = note ? "Credit note" : b.type;
  return (
    <>
      <style>{pageRule(shop.format)}</style>
      <article className="receipt" data-format={shop.format}>
        <header
          className="receipt-brand"
          data-badged={!!b.authorizedMark && !note}
        >
          {shop.logo && <img src={shop.logo} alt="Shop logo" />}
          <div>
            <h2>{shop.shopName}</h2>
            {shop.showOwner && shop.ownerName && <p>{shop.ownerName}</p>}
            {shop.address && <p>{shop.address}</p>}
            {(shop.mobile || shop.email) && (
              <p>{[shop.mobile, shop.email].filter(Boolean).join(" · ")}</p>
            )}
            {shop.gstRegistered && shop.gstin && <p>GSTIN {shop.gstin}</p>}
          </div>
          {b.authorizedMark && !note && (
            <img
              className="approved-mark"
              src={b.authorizedMark.artwork}
              alt={"Authorised mark · " + b.authorizedMark.reference}
            />
          )}
        </header>
        <div className="paper-content">
          <div className="paper-title">
            <h3>{titles[kind]}</h3>
            <span>
              {sample ? "SAMPLE · " : ""}
              {note
                ? "FULL REVERSAL"
                : b.voidedAt
                  ? "VOIDED"
                  : b.type === "Estimate"
                    ? "Quotation only · Not a tax invoice"
                    : paymentStatus(b)}
            </span>
          </div>
          <div className="paper-info">
            <section>
              <h4>Document details</h4>
              <strong>{note?.number ?? b.number}</strong>
              <p>
                {day(issued)} ·{" "}
                {day(issued, { hour: "2-digit", minute: "2-digit" })} IST
              </p>
              {note && (
                <p>
                  Against {b.number} · {day(b.issuedAt)}
                  <br />
                  {note.reason}
                </p>
              )}
              {b.type === "GST invoice" && b.input.placeOfSupply && (
                <p>
                  Place of supply: {supplyStates[b.input.placeOfSupply]} (
                  {b.input.placeOfSupply})
                </p>
              )}
            </section>
            <section>
              <h4>Bill to</h4>
              <strong>{b.customer?.name ?? "Walk-in customer"}</strong>
              {[
                b.customer?.address,
                b.customer?.phone,
                b.customer?.email,
                b.customer?.gstin && "GSTIN " + b.customer.gstin,
              ]
                .filter(Boolean)
                .map((s, i) => (
                  <p key={i}>{s}</p>
                ))}
            </section>
          </div>
          {b.type === "Advance receipt" ? (
            <section className="advance-purpose">
              <h3 className="paper-kicker">Advance for</h3>
              <p>{b.input.advanceFor}</p>
              <small>
                Customer account deposit · No sale or stock movement.
              </small>
            </section>
          ) : (
            <Items bill={b} />
          )}
          <div className="receipt-totals">
            {b.type !== "Advance receipt" && (
              <Breakdown bill={b} credit={!!note} />
            )}{" "}
            {b.type !== "Estimate" && <Payment bill={b} credit={!!note} />}
          </div>
          <div className="paper-words">
            <h4>Amount in words</h4>
            <p>{amountInWords(b.totalPaise)}</p>
          </div>
          {shop.exchangePolicy && (
            <section className="paper-policy">
              <h4>Return & exchange policy</h4>
              <p>{shop.exchangePolicy}</p>
            </section>
          )}
          {shop.invoiceTerms && (
            <section className="paper-policy">
              <h4>Terms & conditions</h4>
              <p>{shop.invoiceTerms}</p>
            </section>
          )}
          <div className="paper-sign">
            <strong>Authorised signature</strong>
            <p>For {shop.shopName}</p>
          </div>
        </div>
        <footer className="paper-thanks">
          {shop.invoiceFooter ?? "Thank you for your business."}
          {sample && <small>Sample workspace · Not a tax document</small>}
        </footer>
      </article>
    </>
  );
}
