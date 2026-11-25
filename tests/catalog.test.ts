import { describe, it, expect } from "vitest";
import {
  METALS,
  OTHER_OPTION,
  PRODUCT_CATEGORIES,
  PURITY_BY_METAL,
  puritiesFor,
} from "../src/lib/catalog";

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
});
