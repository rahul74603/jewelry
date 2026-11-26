import { describe, it, expect } from "vitest";
import {
  METALS,
  OTHER_OPTION,
  PRODUCT_CATEGORIES,
  PURITY_BY_METAL,
  puritiesFor,
  CATEGORY_TYPES,
  typesFor,
} from "../src/lib/catalog";
import { demoSampleRecords } from "../src/lib/demo";
import {
  productSchema,
  rateSchema,
  customerSchema,
} from "../functions/src/core/model";

describe("Catalogue dropdown lists", () => {
  it("offers every metal a jewellery shop trades in", () => {
    expect(METALS).toEqual(["Gold", "Silver", "Diamond", "Platinum"]);
  });

  it("offers the standard purity for each metal", () => {
    expect(PURITY_BY_METAL.Gold).toEqual(["24K", "22K", "18K", "14K"]);
    expect(PURITY_BY_METAL.Silver).toEqual(["999", "925", "800"]);
    expect(PURITY_BY_METAL.Diamond).toEqual(["Natural", "Lab-grown"]);
    expect(PURITY_BY_METAL.Platinum).toEqual(["950", "900"]);
    expect(puritiesFor("Gold")).toContain("22K");
    expect(puritiesFor("Silver")).toContain("925");
    expect(puritiesFor("Copper")).toEqual([]);
  });

  it("offers every common jewellery category, including Kardhani", () => {
    for (const c of [
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
    ])
      expect(PRODUCT_CATEGORIES).toContain(c);
  });

  it("keeps a manual option for anything not listed", () => {
    expect(OTHER_OPTION).toBe("Other");
  });

  it("offers a sub-type list for every category (bill screen, step 02)", () => {
    for (const c of PRODUCT_CATEGORIES) {
      expect(CATEGORY_TYPES[c], c).toBeDefined();
      expect(CATEGORY_TYPES[c].length, c).toBeGreaterThan(0);
      expect(typesFor(c)).toEqual(CATEGORY_TYPES[c]);
    }
    expect(typesFor("Rings")).toContain("Band");
    expect(typesFor("Necklaces")).toContain("Mangalsutra");
    expect(typesFor("Earrings")).toContain("Jhumka");
    expect(typesFor("Kardhani")).toContain("Kamarbandh");
    expect(typesFor("Sets")).toContain("Bridal set");
    expect(typesFor("Copper")).toEqual([]);
  });
});

describe("Demo sample data (one-tap)", () => {
  it("seeds a Gold 22K rate, a Silver 925 rate, one ring and one customer — all schema-valid", () => {
    const s = demoSampleRecords(new Date("2026-11-25T12:00:00.000Z"));
    expect(s.rates.map((r) => r.metal + " " + r.purity)).toEqual([
      "Gold 22K",
      "Silver 925",
    ]);
    expect(s.products).toHaveLength(1);
    expect(s.products[0].metal).toBe("Gold");
    expect(s.products[0].purity).toBe("22K");
    expect(s.products[0].stock).toBeGreaterThan(0);
    expect(s.customers).toHaveLength(1);
    for (const r of s.rates) expect(rateSchema.safeParse(r).success).toBe(true);
    for (const p of s.products)
      expect(productSchema.safeParse(p).success).toBe(true);
    for (const c of s.customers)
      expect(customerSchema.safeParse(c).success).toBe(true);
  });

  it("uses stable ids so a second tap can skip what is already there", () => {
    const a = demoSampleRecords();
    const b = demoSampleRecords();
    expect(a.rates.map((r) => r.id)).toEqual(b.rates.map((r) => r.id));
    expect(a.products.map((p) => p.id)).toEqual(b.products.map((p) => p.id));
    expect(a.customers.map((c) => c.id)).toEqual(
      b.customers.map((c) => c.id),
    );
  });
});
