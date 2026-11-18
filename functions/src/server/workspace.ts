import { z } from "zod";
import {
  type Action,
  type Profile,
  type Product,
  type Customer,
  type Rate,
  type Invoice,
  type Draft,
  id,
  profileSchema,
  productSchema,
  customerSchema,
  rateSchema,
  adjustment,
  invoiceSchema,
  draftSchema,
  finalizeSchema,
} from "../core/model";
import {
  assertDraftPayment,
  assertReviewedPayment,
  calculateInvoice,
  postings,
} from "../core/billing";
import { digest } from "./common";
const amountCap = 2000;
async function rows<T>(
  tx: FirebaseFirestore.Transaction,
  t: FirebaseFirestore.DocumentReference,
  name: string,
) {
  const s = await tx.get(t.collection(name).limit(amountCap + 1));
  if (s.size > amountCap)
    throw Error(
      `Pilot workspace limit reached for ${name}; contact support for a paginated deployment.`,
    );
  return s.docs.map((d) => d.data() as T);
}
export async function shopAction(
  tx: FirebaseFirestore.Transaction,
  t: FirebaseFirestore.DocumentReference,
  uid: string,
  action: Action,
  raw: unknown,
  at: number,
) {
  const date = new Date(at).toISOString();
  const profileRef = t.collection("settings").doc("profile");
  const record = (bucket: string, key: string) => t.collection(bucket).doc(key);
  const log = (kind: string, ref: string) =>
    tx.create(t.collection("auditLogs").doc(), {
      tenantId: t.id,
      uid,
      action: kind,
      ref,
      at,
    });
  if (action === "workspace") {
    const [
      profile,
      products,
      customers,
      rates,
      invoices,
      drafts,
      voids,
      conversions,
    ] = await Promise.all([
      tx.get(profileRef),
      rows<Product>(tx, t, "products"),
      rows<Customer>(tx, t, "customers"),
      rows<Rate>(tx, t, "metalRates"),
      rows<Invoice>(tx, t, "invoices"),
      rows<Draft>(tx, t, "drafts"),
      rows<{ id: string; at: string }>(tx, t, "reversals"),
      rows<{ id: string; invoiceId: string }>(tx, t, "conversions"),
    ]);
    const v = new Map(voids.map((x) => [x.id, x.at])),
      c = new Map(conversions.map((x) => [x.id, x.invoiceId]));
    return {
      profile: profile.data(),
      products,
      customers,
      rates,
      drafts,
      invoices: invoices.map((b) => ({
        ...b,
        ...(v.has(b.id) ? { voidedAt: v.get(b.id) } : {}),
        ...(c.has(b.id) ? { convertedTo: c.get(b.id) } : {}),
      })),
    };
  }
  if (action === "profile") {
    const p = profileSchema.parse(raw);
    tx.set(profileRef, p);
    log("Settings updated", "profile");
    return { ok: true };
  }
  if (action === "customer") {
    const c = customerSchema.parse(raw);
    tx.create(record("customers", c.id), c);
    log("Customer created", c.id);
    return { ok: true };
  }
  if (action === "product") {
    const p = productSchema.parse(raw);
    tx.create(record("products", p.id), p);
    tx.create(record("stockMovements", `open_${p.id}`), {
      productId: p.id,
      delta: p.stock,
      kind: "Opening",
      at,
    });
    log("Product created", p.id);
    return { ok: true };
  }
  if (action === "rate") {
    const r = rateSchema.parse(raw);
    tx.create(record("metalRates", r.id), r);
    log("Rate recorded", r.id);
    return { ok: true };
  }
  if (action === "adjust") {
    const a = adjustment.parse(raw);
    const p = await tx.get(record("products", a.productId));
    if (!p.exists || p.get("stock") + a.delta < 0)
      throw Error("Adjustment would create negative stock.");
    tx.create(record("stockMovements", `adj_${a.id}`), {
      ...a,
      kind: "Adjustment",
      at,
    });
    tx.update(p.ref, { stock: p.get("stock") + a.delta });
    log("Stock adjusted", a.id);
    return { ok: true };
  }
  if (action === "draft") {
    const d = draftSchema.parse(raw);
    if ((await tx.get(record("invoices", d.id))).exists)
      throw Error("This invoice has already been finalized.");
    tx.set(record("drafts", d.id), { ...d, updatedAt: date });
    log("Draft saved", d.id);
    return { id: d.id };
  }
  if (action === "invoice" || action === "void") {
    const input = action === "invoice" ? invoiceSchema.parse(raw) : null;
    const key =
      input?.id ??
      z.object({ id, reason: z.string().trim().min(3).max(200) }).parse(raw).id;
    const ref = record("invoices", key),
      old = await tx.get(ref);
    let b: Invoice;
    let products: Product[];
    if (input) {
      if (old.exists) {
        const previous = old.data() as Invoice;
        if (digest(previous.input) !== digest(input))
          throw Error("Transaction ID already used for a different invoice.");
        // Preserve read-only retries of legacy invoices without rewriting their snapshots.
        if (previous.input.settlement !== undefined)
          assertReviewedPayment(
            previous,
            finalizeSchema.parse(raw).confirmation,
          );
        return { id: key, number: previous.number };
      }
      const { confirmation } = finalizeSchema.parse(raw);
      const countRef = record(
        "counters",
        input.type === "Estimate" ? "estimates" : "invoices",
      );
      const [draft, profile, counter, contact, rates, stock] =
        await Promise.all([
          tx.get(record("drafts", key)),
          tx.get(profileRef),
          tx.get(countRef),
          input.customerId
            ? tx.get(record("customers", input.customerId))
            : null,
          rows<Rate>(tx, t, "metalRates"),
          Promise.all(
            input.items.map((i) => tx.get(record("products", i.productId))),
          ),
        ]);
      if (input.sourceEstimate) {
        const est = await tx.get(record("invoices", input.sourceEstimate));
        if (
          est.get("type") !== "Estimate" ||
          input.type === "Estimate" ||
          (await tx.get(record("reversals", input.sourceEstimate))).exists
        )
          throw Error("Invalid source estimate.");
        if ((await tx.get(record("conversions", input.sourceEstimate))).exists)
          throw Error("Estimate was already converted.");
      }
      products = stock.filter((s) => s.exists).map((s) => s.data() as Product);
      const p = profile.data() as Profile;
      const seq = (counter.get("value") ?? 0) + 1;
      const number = `${input.type === "Estimate" ? "EST" : p.prefix}-${String(seq).padStart(5, "0")}`;
      b = calculateInvoice(
        {
          products,
          profile: p,
          rates,
          customers: contact?.exists ? [contact.data() as Customer] : [],
        },
        input,
        date,
        number,
      );
      assertReviewedPayment(b, confirmation);
      assertDraftPayment(input, draft.data() as Draft | undefined);
      if (input.sourceEstimate)
        tx.create(record("conversions", input.sourceEstimate), {
          id: input.sourceEstimate,
          invoiceId: key,
          at,
        });
      tx.create(ref, b);
      tx.set(countRef, { value: seq });
      tx.delete(record("drafts", key));
    } else {
      if (!old.exists) throw Error("Invoice not found.");
      b = old.data() as Invoice;
      if ((await tx.get(record("reversals", key))).exists) return { id: key };
      if ((await tx.get(record("conversions", key))).exists)
        throw Error("Cannot void a converted estimate.");
      products = (
        await Promise.all(
          b.lines.map((i) => tx.get(record("products", i.productId))),
        )
      ).map((d) => d.data() as Product);
      tx.create(record("reversals", key), {
        id: key,
        at: date,
        reason: (raw as { reason: string }).reason,
        uid,
      });
    }
    const entry = postings(b, !input),
      prefix = `${input ? "sale" : "void"}_${key}`;
    entry.movements.forEach((m, i) => {
      const p = products.find((x) => x.id === m.productId)!;
      tx.update(record("products", p.id), { stock: p.stock + m.delta });
      tx.create(record("stockMovements", `${prefix}_${i}`), {
        ...m,
        at,
        invoiceId: key,
      });
    });
    if (entry.received)
      tx.create(record("payments", prefix), {
        at,
        invoiceId: key,
        amountPaise: entry.received,
        mode: b.mode,
        customerId: b.customer?.id ?? "",
      });
    if (b.customer && b.type !== "Estimate")
      tx.create(record("customerLedger", prefix), {
        at,
        invoiceId: key,
        customerId: b.customer.id,
        deltaPaise: entry.receivable,
      });
    log(input ? "Document finalized" : "Document reversed", key);
    return { id: key, number: b.number };
  }
  throw Error("Unknown shop operation.");
}
