import { z } from "zod";
import type { InvoiceInput } from "./model";
// Provider-only metadata, outside the owner-writable profile. The provider must
// verify the right to reproduce THIS artwork on the specified documents. A
// product HUID, owner checkbox, logo or GST registration is not authorization.
const approval = z.object({
  status: z.literal("verified"),
  reference: z.string().trim().min(1).max(100),
  verifiedBy: z.string().trim().min(1).max(120),
  verifiedAt: z.string().datetime(),
  validUntil: z.string().datetime(),
  types: z.array(z.enum(["GST invoice", "Non-GST bill"])).min(1),
  artwork: z
    .string()
    .max(50000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
});
export function approvedMark(
  raw: unknown,
  type: InvoiceInput["type"],
  at: number,
) {
  const a = approval.safeParse(raw);
  if (
    !a.success ||
    !a.data.types.some((t) => t === type) ||
    at < Date.parse(a.data.verifiedAt) ||
    at >= Date.parse(a.data.validUntil)
  )
    return null;
  return { artwork: a.data.artwork, reference: a.data.reference };
}
