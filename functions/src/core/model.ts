import { z } from "zod";

export const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,80}$/, "Invalid record reference");
export const money = z
  .number()
  .finite()
  .nonnegative()
  .max(100_000_000)
  .multipleOf(0.01);
const weight = z.number().finite().nonnegative().max(100_000).multipleOf(0.001);
const text = (max = 100) => z.string().trim().min(1).max(max);
const phone = z
  .string()
  .regex(/^(?:\+?[\d ()-]{7,18})?$/, "Enter a valid phone number");
const email = z.union([z.literal(""), z.string().email().max(254)]);
const gstin = z
  .string()
  .regex(
    /^(?:[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])?$/,
    "Check the 15-character GSTIN",
  );
export const taxRule = z.object({
  hsn: z.string().regex(/^\d{4,8}$/),
  effective: z.string().date("Enter a valid effective date"),
  percent: z.number().min(0).max(100).multipleOf(0.01),
});
export const profileSchema = z
  .object({
    shopName: text(),
    ownerName: text(),
    mobile: phone,
    email,
    address: z.string().max(400),
    gstin,
    logo: z
      .string()
      .max(150000)
      .regex(/^(?:data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)?$/),
    prefix: z
      .string()
      .regex(
        /^[A-Z0-9-]{1,12}$/,
        "Use 1–12 uppercase letters, numbers or hyphens",
      ),
    gstRegistered: z.boolean(),
    taxes: z.array(taxRule).max(60),
    roundOff: z.boolean(),
    format: z.enum(["A4", "A5", "80mm", "58mm"]),
    language: z.enum(["en", "hi"]),
    setupComplete: z.boolean(),
  })
  .refine((p) => !p.gstRegistered || p.gstin.length === 15, {
    message: "A registered shop needs a GSTIN",
    path: ["gstin"],
  })
  .refine(
    (p) =>
      new Set(p.taxes.map((r) => r.hsn + ":" + r.effective)).size ===
      p.taxes.length,
    { message: "Duplicate effective date for the same HSN", path: ["taxes"] },
  );
export type Profile = z.infer<typeof profileSchema>;
export const makeProfile = (
  shopName: string,
  ownerName: string,
  emailAddress: string,
): Profile => ({
  shopName,
  ownerName,
  email: emailAddress,
  mobile: "",
  address: "",
  gstin: "",
  logo: "",
  prefix: "INV",
  gstRegistered: false,
  taxes: [],
  roundOff: false,
  format: "A4",
  language: "en",
  setupComplete: false,
});
export const customerSchema = z.object({
  id,
  name: text(),
  phone,
  email,
  address: z.string().max(400),
  gstin,
});
export type Customer = z.infer<typeof customerSchema>;
export const makingMode = z.enum(["Fixed", "Per gram", "Percentage"]);
export const productSchema = z
  .object({
    id,
    name: text(),
    sku: text(40),
    category: text(40),
    metal: text(40),
    purity: text(30),
    gross: weight.positive(),
    stone: weight,
    deduction: weight,
    stock: z.number().int().nonnegative().max(100000),
    cost: money,
    makingMode,
    making: money,
    hsn: z.string().regex(/^(?:\d{4,8})?$/),
    huid: z.string().max(30),
  })
  .refine(
    (p) =>
      Math.round(1000 * p.gross) > Math.round(1000 * (p.stone + p.deduction)),
    { message: "Net weight must be positive", path: ["gross"] },
  );
export type Product = z.infer<typeof productSchema>;
export const rateSchema = z.object({
  id,
  metal: text(40),
  purity: text(30),
  rate: money.positive(),
  effectiveAt: z.string().datetime(),
});
export type Rate = z.infer<typeof rateSchema>;
export const lineSchema = z.object({
  productId: id,
  quantity: z.number().int().min(1).max(10000),
  makingMode,
  making: money,
  wastagePct: z.number().min(0).max(100).multipleOf(0.01),
  stoneValue: money,
  otherCharges: money,
  discount: money,
});
export type LineInput = z.infer<typeof lineSchema>;
export const invoiceSchema = z.object({
  id,
  customerId: z.union([id, z.literal("")]),
  type: z.enum(["Non-GST bill", "GST invoice", "Estimate"]),
  items: z.array(lineSchema).min(1, "Add at least one item").max(40),
  paid: money,
  mode: z.enum(["Cash", "UPI", "Card", "Bank", "Other"]),
  sourceEstimate: id.optional(),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type BillLine = LineInput & {
  name: string;
  sku: string;
  metal: string;
  purity: string;
  hsn: string;
  gross: number;
  stone: number;
  deduction: number;
  net: number;
  rate: number;
  costPaise: number;
  metalPaise: number;
  wastagePaise: number;
  makingPaise: number;
  stonePaise: number;
  otherPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPercent: number;
  taxPaise: number;
  totalPaise: number;
};
export type Invoice = {
  id: string;
  number: string;
  issuedAt: string;
  type: InvoiceInput["type"];
  customer: Customer | null;
  shop: Profile;
  lines: BillLine[];
  subtotalPaise: number;
  taxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  mode: InvoiceInput["mode"];
  input: InvoiceInput;
  voidedAt?: string;
  convertedTo?: string;
};
export type Draft = InvoiceInput & { updatedAt: string };
export type Workspace = {
  profile: Profile;
  products: Product[];
  customers: Customer[];
  rates: Rate[];
  invoices: Invoice[];
  drafts: Draft[];
};
export type LicenseInfo = {
  id: string;
  plan: string;
  deviceLimit: number;
  expiresAt: number | null;
  platform: string;
  deviceId: string;
};
export const emptyWorkspace = (profile: Profile): Workspace => ({
  profile,
  products: [],
  customers: [],
  rates: [],
  invoices: [],
  drafts: [],
});
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + stableJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export type Action =
  | "workspace"
  | "activate"
  | "profile"
  | "customer"
  | "product"
  | "rate"
  | "invoice"
  | "draft"
  | "void"
  | "adjust";
export const adjustment = z.object({
  id,
  productId: id,
  delta: z
    .number()
    .int()
    .min(-100000)
    .max(100000)
    .refine((x) => x !== 0, "Quantity must change"),
  reason: text(200),
});
