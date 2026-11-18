import Decimal from "decimal.js";
import {
  invoiceSchema,
  type Invoice,
  type InvoiceInput,
  type BillLine,
  type Workspace,
  type Rate,
} from "./model";
const D = (n: Decimal.Value) => new Decimal(n);
export const paise = (r: Decimal.Value) =>
  D(r).times(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
const add = (v: number[]) => v.reduce((a, b) => a + b, 0);
export const indiaDay = (date: string | number | Date) =>
  new Date(new Date(date).getTime() + 19800000).toISOString().slice(0, 10);
export function currentRates(rates: Rate[], at = Date.now()) {
  const seen = new Set<string>();
  return [...rates]
    .filter((r) => Date.parse(r.effectiveAt) <= at)
    .sort(
      (a, b) =>
        b.effectiveAt.localeCompare(a.effectiveAt) || b.id.localeCompare(a.id),
    )
    .filter((r) => {
      const k = JSON.stringify([r.metal, r.purity]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
/** All line charge inputs are per unit except discount, which is per line. Fixed making
 * is per unit; percentage making and wastage use metal value as their base. */
export function calculateInvoice(
  data: Pick<Workspace, "profile" | "customers" | "rates" | "products">,
  raw: InvoiceInput,
  issuedAt: string,
  number: string,
  checkStock = true,
  checkPayment = true,
): Invoice {
  const input = invoiceSchema.parse(raw);
  const { profile } = data;
  if (input.type === "GST invoice" && !profile.gstRegistered)
    throw Error("Configure a GST-registered shop and tax rules first.");
  const customer = input.customerId
    ? data.customers.find((c) => c.id === input.customerId)
    : null;
  if (input.customerId && !customer)
    throw Error("Customer not found in this shop.");
  const rates = currentRates(data.rates, Date.parse(issuedAt));
  const used = new Set<string>();
  const lines: BillLine[] = input.items.map((i) => {
    const p = data.products.find((v) => v.id === i.productId);
    if (!p) throw Error("Product not found in this shop.");
    if (used.has(p.id))
      throw Error("Combine identical products using quantity.");
    used.add(p.id);
    if (checkStock && input.type !== "Estimate" && i.quantity > p.stock)
      throw Error(`Not enough stock: ${p.name}.`);
    const r = rates.find((r) => r.metal === p.metal && r.purity === p.purity);
    if (!r) throw Error(`Add an effective rate for ${p.metal} ${p.purity}.`);
    const net = D(p.gross).minus(p.stone).minus(p.deduction).times(i.quantity);
    const metalValue = net.times(r.rate);
    const metalPaise = paise(metalValue),
      wastagePaise = paise(metalValue.times(i.wastagePct).div(100));
    const makingPaise = paise(
      i.makingMode === "Fixed"
        ? D(i.making).times(i.quantity)
        : i.makingMode === "Per gram"
          ? net.times(i.making)
          : metalValue.times(i.making).div(100),
    );
    const otherPaise = paise(D(i.otherCharges).times(i.quantity)),
      stonePaise = paise(D(i.stoneValue).times(i.quantity)),
      discountPaise = paise(i.discount);
    const taxablePaise =
      metalPaise +
      makingPaise +
      wastagePaise +
      otherPaise +
      stonePaise -
      discountPaise;
    if (taxablePaise < 0) throw Error("Discount cannot exceed the line value.");
    const rule = profile.taxes
      .filter((t) => t.hsn === p.hsn && t.effective <= indiaDay(issuedAt))
      .sort((a, b) => b.effective.localeCompare(a.effective))[0];
    if (input.type === "GST invoice" && !rule)
      throw Error(`No effective GST rule for HSN ${p.hsn || "(missing)"}.`);
    const taxPercent = input.type === "GST invoice" ? rule!.percent : 0,
      taxPaise = D(taxablePaise).times(taxPercent).div(100).round().toNumber();
    const totalPaise = taxablePaise + taxPaise;
    if (!Number.isSafeInteger(totalPaise) || totalPaise > 1e13)
      throw Error("Line value exceeds the supported billing limit.");
    return {
      ...i,
      name: p.name,
      sku: p.sku,
      metal: p.metal,
      purity: p.purity,
      hsn: p.hsn,
      gross: p.gross,
      stone: p.stone,
      deduction: p.deduction,
      net: net.toNumber(),
      rate: r.rate,
      costPaise: paise(D(p.cost).times(i.quantity)),
      metalPaise,
      wastagePaise,
      makingPaise,
      stonePaise,
      otherPaise,
      discountPaise,
      taxablePaise,
      taxPercent,
      taxPaise,
      totalPaise,
    };
  });
  const subtotalPaise = add(lines.map((l) => l.taxablePaise)),
    taxPaise = add(lines.map((l) => l.taxPaise)),
    before = subtotalPaise + taxPaise;
  const totalPaise = profile.roundOff
      ? D(before).div(100).round().times(100).toNumber()
      : before,
    paidPaise = paise(input.paid);
  if (input.type === "Estimate" && paidPaise)
    throw Error("Estimates cannot record a payment.");
  if (paidPaise > totalPaise) throw Error("Payment exceeds the invoice total.");
  if (
    checkPayment &&
    !customer &&
    paidPaise < totalPaise &&
    input.type !== "Estimate"
  )
    throw Error("Select a customer for a credit or partial payment.");
  return {
    id: input.id,
    number,
    issuedAt,
    type: input.type,
    customer: customer ? { ...customer } : null,
    shop: { ...profile, taxes: profile.taxes.map((r) => ({ ...r })) },
    lines,
    input,
    mode: input.mode,
    subtotalPaise,
    taxPaise,
    roundOffPaise: totalPaise - before,
    totalPaise,
    paidPaise,
    balancePaise: totalPaise - paidPaise,
  };
}
export function postings(b: Invoice, reverse = false) {
  const factor = reverse ? -1 : 1;
  return b.type === "Estimate"
    ? { movements: [], received: 0, receivable: 0 }
    : {
        movements: b.lines.map((l) => ({
          productId: l.productId,
          delta: -l.quantity * factor,
          kind: reverse ? "Sale reversal" : "Sale out",
        })),
        received: b.paidPaise * factor,
        receivable: b.balancePaise * factor,
      };
}
export const saleInvoices = (data: Workspace) =>
  data.invoices.filter((i) => i.type !== "Estimate" && !i.voidedAt);
export function paymentStatus(i: Invoice) {
  return i.voidedAt
    ? "Voided"
    : i.type === "Estimate"
      ? "Estimate"
      : i.balancePaise === 0
        ? "Paid"
        : i.paidPaise === 0
          ? "Unpaid"
          : "Partial";
}
