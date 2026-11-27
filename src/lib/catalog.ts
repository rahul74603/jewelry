/**
 * Shop catalogue lists used by the billing screen and Add Product form.
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
  Gold: ["24K", "22K", "20K", "18K", "14K"],
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

/**
 * Sub-types shown UNDER a category on the bill screen — e.g. picking
 * Rings offers Band / Solitaire / Cocktail / Eternity. Suggestion
 * lists, not a closed enum: each dropdown also offers "Other" for a
 * free-text type, and a category with no list yet shows the free-text
 * field directly.
 */
export const CATEGORY_TYPES: Record<string, string[]> = {
  Rings: ["Band", "Solitaire", "Cocktail", "Eternity"],
  Necklaces: ["Chain", "Choker", "Mangalsutra", "Pendant set", "Rani haar"],
  Earrings: ["Studs", "Jhumka", "Bali", "Chandbali"],
  Bangles: ["Kada", "Chudi set"],
  Chains: ["Rope", "Curb", "Figaro"],
  Pendants: ["Locket", "Solitaire pendant"],
  Anklets: ["Payal"],
  Coins: ["Lakshmi", "Ganesha"],
  Bracelets: ["Tennis", "Kada"],
  "Nose Rings": ["Nath", "Stud"],
  Kardhani: ["Kamarbandh"],
  "Toe Rings": ["Bichhiya"],
  Brooches: ["Brooch pin"],
  Sets: ["Bridal set", "Necklace set"],
};

/** Sub-type options for a category; empty when the category is custom. */
export function typesFor(category: string): string[] {
  return CATEGORY_TYPES[category] ?? [];
}

/** Singular form of a category, for the auto-generated name of a
 * piece added straight from the bill screen ("Gold 22K Band Ring"). */
export const CATEGORY_SINGULAR: Record<string, string> = {
  Rings: "Ring",
  Necklaces: "Necklace",
  Earrings: "Earring",
  Bangles: "Bangle",
  Chains: "Chain",
  Pendants: "Pendant",
  Anklets: "Anklet",
  Coins: "Coin",
  Bracelets: "Bracelet",
  "Nose Rings": "Nose Ring",
  Kardhani: "Kardhani",
  "Toe Rings": "Toe Ring",
  Brooches: "Brooch",
  Sets: "Set",
};
