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
    // Bank details for payment by transfer — optional, printed on
    // bills only when filled. Optional (not defaulted) so backups
    // made before these fields existed still validate and restore.
    bankName: z.string().trim().max(100).optional(),
    accountName: z.string().trim().max(100).optional(),
    accountNumber: z.string().trim().max(40).optional(),
    ifsc: z.string().trim().max(20).optional(),
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
    invoiceFooter: z.string().trim().max(240).optional(),
    invoiceTerms: z.string().trim().max(1000).optional(),
    exchangePolicy: z.string().trim().max(600).optional(),
    showOwner: z.boolean().optional(),
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
  bankName: "",
  accountName: "",
  accountNumber: "",
  ifsc: "",
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
export const tenderModes = ["Cash", "UPI", "Bank", "Card", "Other"] as const;
export type TenderMode = (typeof tenderModes)[number];

/** One payment against a girvi / EMI record. A payment first settles
 * accrued interest, then reduces the principal — see
 * functions/src/core/loans.ts. Amounts are paise. */
export const loanPaymentSchema = z.object({
  id,
  at: z.string().datetime(),
  amountPaise: z.number().int().positive().max(100_000_000_00),
  mode: z.enum(tenderModes),
  note: z.string().trim().max(200).optional(),
  /** Extra above the total due at payment time (manual overpayment) —
   * recorded when a payment closes the record, never negative. */
  extraPaise: z.number().int().nonnegative().default(0),
});
export type LoanPayment = z.infer<typeof loanPaymentSchema>;
/** A girvi (pawn) loan or an EMI (instalment) sale. The interest rate
 * is MANUAL per record — the shopkeeper enters it, % per month, and
 * it never changes after the record is created. Girvi: the customer
 * leaves jewellery as collateral and takes cash; if it is not fully
 * repaid by dueAt the shopkeeper may forfeit it and the item moves
 * into stock. EMI: the customer takes a gold item, pays some upfront,
 * and pays the rest in flexible instalments — any amount, any time,
 * no fixed instalment. For EMI, principal + upfront = total price;
 * for girvi, total = principal and upfront is 0. Compound (chakravarti
 * byaj) is OFF by default — when ON, unpaid interest is added to the
 * principal at each month boundary. A record can close three ways:
 * fully repaid (balance 0), forfeited (girvi only), or settled
 * (mamla khatam — closed at a smaller amount, the rest waived). */
export const loanSchema = z
  .object({
    id,
    kind: z.enum(["girvi", "emi"]),
    customerId: id,
    itemName: text(120),
    itemMetal: text(40),
    itemPurity: text(30),
    /** Grams. Required for girvi — the collateral goes to stock on
     * forfeit, and stock needs a weight. */
    itemWeight: weight,
    principalPaise: z.number().int().positive(),
    totalPaise: z.number().int().positive(),
    upfrontPaise: z.number().int().nonnegative(),
    /** Manual monthly interest rate, % per month. */
    interestRatePct: z.number().min(0).max(100).multipleOf(0.01),
    /** Chakravarti byaj — when ON, unpaid interest capitalises at
     * each month boundary, so later months charge interest on
     * principal + unpaid interest. Default OFF (simple interest). */
    compound: z.boolean().default(false),
    /** Calendar dates (YYYY-MM-DD). */
    startAt: z.string().date(),
    /** Validity / due date: repay in full by this date. */
    dueAt: z.string().date(),
    payments: z.array(loanPaymentSchema).max(500),
    status: z.enum(["active", "forfeited", "settled"]),
    forfeitedAt: z.string().datetime().optional(),
    forfeitNote: z.string().trim().max(200).optional(),
    /** Settlement (mamla khatam): amount actually received, and the
     * part of the balance waived to close the record. */
    settledAt: z.string().datetime().optional(),
    settlementAmountPaise: z.number().int().nonnegative().optional(),
    waivedPaise: z.number().int().nonnegative().optional(),
    createdAt: z.string().datetime(),
  })
  .refine((l) => l.kind !== "girvi" || l.itemWeight > 0, {
    message: "Girvi needs the item weight — the collateral goes to stock if it is forfeited.",
    path: ["itemWeight"],
  })
  .refine((l) => l.kind !== "girvi" || l.upfrontPaise === 0, {
    message: "Girvi has no upfront — the total is the cash given.",
    path: ["upfrontPaise"],
  })
  .refine((l) => l.kind !== "girvi" || l.totalPaise === l.principalPaise, {
    message: "Girvi total is the cash given.",
    path: ["totalPaise"],
  })
  .refine(
    (l) =>
      l.kind !== "emi" ||
      l.totalPaise === l.principalPaise + l.upfrontPaise,
    {
      message: "EMI principal + upfront must equal the item price.",
      path: ["principalPaise"],
    },
  )
  .refine((l) => l.startAt <= l.dueAt, {
    message: "Due date must be on or after the start date.",
    path: ["dueAt"],
  });
export type Loan = z.infer<typeof loanSchema>;
export const loanPaymentInputSchema = z.object({
  loanId: id,
  payment: loanPaymentSchema,
});
export const loanForfeitInputSchema = z.object({
  loanId: id,
  note: z.string().trim().max(200).optional(),
});
/** Mamla khatam (settlement): close the record with a payment smaller
 * than the balance due — the rest is waived. The payment is recorded
 * like any other payment, with the settlement amounts on the record. */
export const loanSettleInputSchema = z.object({
  loanId: id,
  payment: loanPaymentSchema,
});
/** Flip the chakravarti byaj (compound) toggle on an active record.
 * The whole record is recalculated from the start with the new rule. */
export const loanCompoundInputSchema = z.object({
  loanId: id,
  compound: z.boolean(),
});
export const invoiceSchema = z.object({
  id,
  customerId: z.union([id, z.literal("")]),
  type: z.enum(["Non-GST bill", "GST invoice", "Estimate", "Advance receipt"]),
  items: z.array(lineSchema).max(40),
  paid: money,
  // Older stored drafts/invoice snapshots have an amount and mode, but no selection.
  settlement: z.enum(["part", "full"]).optional(),
  mode: z.enum([...tenderModes, "Split"]),
  tenders: z
    .array(z.object({ mode: z.enum(tenderModes), amount: money.positive() }))
    .min(2)
    .max(5)
    .optional(),
  placeOfSupply: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  // Manual GST % chosen on the Billing screen (5/10/15/20). When set, it
  // drives the whole bill's tax and no per-HSN tax rule is needed.
  gstPercent: z.number().min(0).max(100).multipleOf(0.01).optional(),
  advanceFor: z.string().trim().min(1).max(240).optional(),
  sourceEstimate: id.optional(),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;
// New writes require an explicit intent. Never default a missing or zero payment to full.
export const draftSchema = invoiceSchema
  .required({ settlement: true })
  .refine(
    (i) =>
      i.type === "Advance receipt"
        ? i.items.length === 0 &&
          !!i.customerId &&
          !!i.advanceFor &&
          i.paid > 0 &&
          !i.sourceEstimate
        : i.items.length > 0,
    {
      message:
        "A sale needs items; an advance needs a customer, purpose and positive deposit, without stock.",
    },
  )
  .refine((i) => i.settlement !== "full" || i.paid > 0, {
    path: ["paid"],
    message: "Full payment requires a positive received amount.",
  })
  .refine((i) => i.type !== "Estimate" || i.paid === 0, {
    path: ["paid"],
    message: "Estimates cannot record a payment.",
  });
const nonnegativePaise = z.number().int().nonnegative();
export const confirmationSchema = z.object({
  totalPaise: nonnegativePaise,
  balancePaise: nonnegativePaise,
});
export const finalizeSchema = draftSchema
  .safeExtend({
    confirmation: confirmationSchema,
  })
  .refine((i) => i.type !== "GST invoice" || !!i.placeOfSupply, {
    path: ["placeOfSupply"],
    message: "Select the actual place of supply for GST.",
  });
export type FinalizeInput = z.infer<typeof finalizeSchema>;
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
  components?: Partial<Record<"CGST" | "SGST" | "UTGST" | "IGST", number>>;
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
  authorizedMark?: { artwork: string; reference: string };
  previousBalancePaise?: number;
  creditNote?: {
    number: string;
    issuedAt: string;
    reason: string;
    shop: Profile;
  };
};
export type Draft = InvoiceInput & { updatedAt: string };
export type Workspace = {
  profile: Profile;
  products: Product[];
  customers: Customer[];
  rates: Rate[];
  invoices: Invoice[];
  drafts: Draft[];
  loans: Loan[];
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
  loans: [],
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
  | "deleteDraft"
  | "deleteInvoice"
  | "clearWorkspace"
  | "adjust"
  | "loan"
  | "loanPayment"
  | "loanForfeit"
  | "loanSettle"
  | "loanCompound"
  | "restore";

/** A full workspace snapshot as stored in a backup file. Invoices are
 * computed snapshots, so only their identifying + money fields are
 * re-checked here — the rest passes through untouched (loose objects),
 * and the backup checksum (validateBackup) is what guarantees the
 * snapshot is exactly what was backed up. */
const invoiceSnapshotSchema = z.looseObject({
  id,
  number: z.string().min(1).max(80),
  issuedAt: z.string(),
  type: z.enum(["Non-GST bill", "GST invoice", "Estimate", "Advance receipt"]),
  customer: customerSchema.nullable(),
  shop: profileSchema,
  lines: z.array(
    z.looseObject({
      productId: id,
      quantity: z.number().int().min(1).max(10000),
      totalPaise: z.number().int(),
    }),
  ),
  subtotalPaise: z.number().int().nonnegative(),
  taxPaise: z.number().int().nonnegative(),
  roundOffPaise: z.number().int(),
  totalPaise: z.number().int().nonnegative(),
  paidPaise: z.number().int().nonnegative(),
  balancePaise: z.number().int().nonnegative(),
  mode: z.enum([...tenderModes, "Split"]),
  input: invoiceSchema,
});
const draftSnapshotSchema = z
  .looseObject({
    ...invoiceSchema.shape,
    settlement: z.enum(["part", "full"]),
    updatedAt: z.string(),
  })
  .refine(
    (i) =>
      i.type === "Advance receipt"
        ? i.items.length === 0 &&
          !!i.customerId &&
          !!i.advanceFor &&
          i.paid > 0 &&
          !i.sourceEstimate
        : i.items.length > 0,
    {
      message:
        "A sale needs items; an advance needs a customer, purpose and positive deposit, without stock.",
    },
  );
/** Validates a whole-workspace payload before a restore applies it.
 * Used by both the demo mutation and the server handler, so a bad
 * payload can never silently wipe the workspace. */
export const workspaceSchema = z.object({
  profile: profileSchema,
  products: z.array(productSchema).max(2000),
  customers: z.array(customerSchema).max(2000),
  rates: z.array(rateSchema).max(2000),
  invoices: z.array(invoiceSnapshotSchema).max(2000),
  drafts: z.array(draftSnapshotSchema).max(2000),
  // Default [] so backups made before the Girvi & EMI module still restore.
  loans: z.array(loanSchema).max(2000).default([]),
});
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
