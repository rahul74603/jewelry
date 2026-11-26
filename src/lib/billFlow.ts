/**
 * Single-screen billing helpers ("Ek screen bill", v1.0.43).
 *
 * Everything on the bill screen that can be decided without React
 * lives here, so the counter flow is unit-testable: matching a typed
 * mobile to an existing customer, building a stock product straight
 * from the bill fields (rate + lagat typed on the bill), and making
 * the entered rate the current rate for that metal + purity.
 * The screen itself (src/pages/Billing.tsx) only wires these helpers
 * to `perform(...)` calls.
 */
import {
  customerSchema,
  productSchema,
  rateSchema,
  type Customer,
  type Product,
  type Rate,
} from "../../functions/src/core/model";
import { currentRates } from "../../functions/src/core/billing";
import { CATEGORY_SINGULAR } from "./catalog";
import { key } from "./format";

/**
 * Phone numbers as a shopkeeper types them — "+91 98765 43210",
 * "09876543210" and "9876543210" are the same customer. Strip
 * spaces/dashes, then a leading India country code or trunk 0 when
 * exactly 10 digits follow.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.replace(/^(?:91|0)(?=\d{10}$)/, "");
}

/** Find a customer by mobile, ignoring +91 / 0 / spaces. */
export function findCustomerByPhone(
  customers: Customer[],
  phone: string,
): Customer | undefined {
  const n = normalizePhone(phone);
  if (!n) return undefined;
  return customers.find((c) => normalizePhone(c.phone) === n);
}

export type BillCustomerFields = {
  name: string;
  phone: string;
  address: string;
};

export type BillCustomerResolution =
  | { customerId: string; create: Customer | null }
  | { error: string };

/**
 * Decide what the customer section on the bill means at save time.
 *
 * - Mobile matches an existing customer → reuse them (no duplicate).
 * - Name typed, no match → a new customer record to create, then link.
 * - Everything blank → walk-in customer (customerId "").
 * - Phone/address typed but no name, and the bill NEEDS a customer
 *   (udhar / advance) → plain-Hindi error instead of a silent walk-in.
 * `required` is false for a full payment or an estimate, where a
 * nameless phone can simply be ignored.
 */
export function resolveBillCustomer(
  customers: Customer[],
  fields: BillCustomerFields,
  opts: { required: boolean },
): BillCustomerResolution {
  const name = fields.name.trim();
  const phone = fields.phone.trim();
  const address = fields.address.trim();
  const match = phone ? findCustomerByPhone(customers, phone) : undefined;
  if (match) return { customerId: match.id, create: null };
  if (name) {
    const create = customerSchema.parse({
      id: key(),
      name,
      phone,
      email: "",
      address,
      gstin: "",
    });
    return { customerId: create.id, create };
  }
  if ((phone || address) && opts.required)
    return {
      error:
        "Udhar ke liye customer ka naam likho — upar 01 Customer me naam likho.",
    };
  return { customerId: "", create: null };
}

/** Display name for a piece added straight from the bill. */
export function quickProductName(
  category: string,
  type: string,
  metal: string,
  purity: string,
): string {
  const singular = CATEGORY_SINGULAR[category] ?? category;
  return `${metal} ${purity} ${type} ${singular}`.trim();
}

export type QuickAddFields = {
  category: string;
  type: string;
  metal: string;
  purity: string;
  /** Rate per gram (₹) typed on the bill. */
  rate: number;
  /** Gross weight in grams. */
  weight: number;
  /** Lagat — unit purchase cost (₹) typed on the bill. */
  lagat: number;
  /** Making amount (₹, Fixed). */
  making: number;
};

/**
 * Build the stock product for a new item typed on the bill. One piece
 * (stock 1 — the piece being sold), cost = the lagat typed on the
 * bill, making Fixed. Name + SKU are generated so the shopkeeper
 * never has to invent them; the schema still validates everything.
 */
export function buildQuickProduct(f: QuickAddFields): Product {
  const sku =
    "QK-" +
    Date.now().toString(36).toUpperCase() +
    Math.floor(Math.random() * 1296)
      .toString(36)
      .toUpperCase()
      .padStart(2, "0");
  return productSchema.parse({
    id: key(),
    name: quickProductName(f.category, f.type, f.metal, f.purity),
    sku,
    category: f.category,
    metal: f.metal,
    purity: f.purity,
    gross: f.weight,
    stone: 0,
    deduction: 0,
    stock: 1,
    cost: f.lagat,
    makingMode: "Fixed",
    making: f.making,
    hsn: "",
    huid: "",
  });
}

/** The current rate for a metal + purity, for pre-filling the bill. */
export function prefillRate(
  rates: Rate[],
  metal: string,
  purity: string,
): number | undefined {
  return currentRates(rates).find(
    (r) => r.metal === metal && r.purity === purity,
  )?.rate;
}

/**
 * The rate record the bill's typed rate becomes. Null when the typed
 * rate is already the current rate — no duplicate history entry.
 * A new record is effective now, so it is the current rate for the
 * next bill (and for this bill's own calculation).
 */
export function rateUpsertFor(
  rates: Rate[],
  metal: string,
  purity: string,
  rate: number,
  at = new Date().toISOString(),
): Rate | null {
  if (!(rate > 0)) return null;
  if (prefillRate(rates, metal, purity) === rate) return null;
  return rateSchema.parse({
    id: key(),
    metal,
    purity,
    rate,
    effectiveAt: at,
  });
}
