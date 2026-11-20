import Decimal from "decimal.js";
import {
  tenderModes,
  type TenderMode,
  type InvoiceInput,
  type Invoice,
  type Profile,
  type BillLine,
} from "./model";

// GST registration state/UT codes for ordinary domestic goods; place of supply
// is entered for the transaction, never inferred from a phone number/address.
export const supplyStates: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};
export function taxComponents(
  gstin: string,
  place: string,
  taxablePaise: number,
  rate: number,
): NonNullable<BillLine["components"]> {
  const origin = gstin.slice(0, 2);
  if (!supplyStates[place] || !supplyStates[origin])
    throw Error("Unsupported supplier state or place of supply.");
  const levy = new Decimal(taxablePaise).mul(rate).div(100);
  if (origin !== place) return { IGST: levy.round().toNumber() };
  // Split the rounded levy in two; the odd paise goes to SGST/UTGST so the
  // parts always add up to the tax charged on the bill.
  const total = levy.round().toNumber(),
    cgst = Math.floor(total / 2);
  return {
    CGST: cgst,
    [["04", "26", "31", "35", "38"].includes(place) ? "UTGST" : "SGST"]:
      total - cgst,
  };
}
export type Allocation = { mode: TenderMode; amountPaise: number };
export function allocations(
  input: Pick<InvoiceInput, "paid" | "mode" | "tenders">,
): Allocation[] {
  const total = new Decimal(input.paid).times(100).toNumber();
  if (input.mode !== "Split") {
    if (input.tenders !== undefined)
      throw Error("Use Split for multiple payment modes.");
    return [{ mode: input.mode, amountPaise: total }];
  }
  const parts = (input.tenders ?? []).map(({ mode, amount }) => ({
    mode,
    amountPaise: new Decimal(amount).mul(100).toNumber(),
  }));
  if (
    parts.length < 2 ||
    parts.some(
      (x) => !Number.isSafeInteger(x.amountPaise) || x.amountPaise <= 0,
    ) ||
    new Set(parts.map((x) => x.mode)).size !== parts.length ||
    parts.reduce((sum, p) => sum + p.amountPaise, 0) !== total
  )
    throw Error(
      "Split payments must be positive, use distinct modes and add up to the amount received.",
    );
  return parts.sort(
    (a, b) => tenderModes.indexOf(a.mode) - tenderModes.indexOf(b.mode),
  );
}
export const isSale = (b: Pick<Invoice, "type">) =>
  b.type === "GST invoice" || b.type === "Non-GST bill";
export const titles = {
  "Non-GST bill": "NON-GST BILL",
  "GST invoice": "GST TAX INVOICE",
  Estimate: "ESTIMATE",
  "Advance receipt": "ADVANCE RECEIPT",
  "Credit note": "CREDIT NOTE",
} as const;
export function documentNumber(
  profile: Profile,
  type: Invoice["type"] | "Credit note",
  seq: number,
) {
  const series =
    type === "Estimate"
      ? "/E"
      : type === "Advance receipt"
        ? "/A"
        : type === "Credit note"
          ? "/C"
          : "";
  return `${profile.prefix}${series}-${String(seq).padStart(5, "0")}`;
}
export function accountDelta(b: Invoice) {
  return b.type === "Estimate"
    ? 0
    : b.type === "Advance receipt"
      ? -b.paidPaise
      : b.balancePaise;
}
export function accountDocuments(data: { invoices: Invoice[] }) {
  return data.invoices.filter((b) => !b.voidedAt && b.type !== "Estimate");
}
