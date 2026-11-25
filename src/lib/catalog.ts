/**
 * Shop catalogue lists used by the Metal rates and Add Product forms.
 *
 * These are suggestion lists, not a closed enum: every dropdown has an
 * "Other" option that lets the shopkeeper type a custom value, and the
 * schemas in functions/src/core/model.ts accept any short text for
 * metal / purity / category. A bill only needs a recorded rate whose
 * metal + purity exactly match the product's metal + purity.
 */

/** Metals a jewellery shop trades in. */
export const METALS = ["Gold", "Silver", "Diamond", "Platinum"] as const;
export type MetalName = (typeof METALS)[number];

/** Purity / grade options for each metal. */
export const PURITY_BY_METAL: Record<string, string[]> = {
  Gold: ["24K", "22K", "18K", "14K"],
  Silver: ["999", "925", "800"],
  Diamond: ["Natural", "Lab-grown"],
  Platinum: ["950", "900"],
};

/** Purity options for a metal; empty when the metal is custom/unknown. */
export function puritiesFor(metal: string): string[] {
  return PURITY_BY_METAL[metal] ?? [];
}

/** Jewellery item categories shown in the Add Product dropdown. */
export const PRODUCT_CATEGORIES = [
  "Rings",
  "Necklaces",
  "Earrings",
  "Bangles",
  "Chains",
  "Pendants",
  "Anklets",
  "Coins",
  "Bracelets",
  "Nose Rings",
  "Kardhani",
  "Toe Rings",
  "Brooches",
  "Sets",
] as const;

/** Value used by the "type it yourself" option in the dropdowns. */
export const OTHER_OPTION = "Other";
