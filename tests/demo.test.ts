import { describe, it, expect, vi } from "vitest";
import {
  DEMO_WORKSPACE_KEY,
  demoMutation,
  loadDemoWorkspace,
  saveDemoWorkspace,
  seedDemo,
} from "../src/lib/demo";
import type { PrefsStore } from "../src/lib/backup";
import type { Product, Workspace } from "../functions/src/core/model";

const product: Product = {
  id: "a",
  name: "Test item",
  category: "Rings",
  sku: "TEST-1",
  metal: "Gold",
  purity: "22K",
  stock: 3,
  gross: 5.125,
  stone: 0.321,
  deduction: 0.004,
  cost: 19000,
  makingMode: "Per gram",
  making: 200,
  hsn: "7113",
  huid: "",
};

function memoryStore(): PrefsStore & { raw(key: string): string | null } {
  const entries = new Map<string, string>();
  return {
    raw: (key) => entries.get(key) ?? null,
    get: (key) => entries.get(key) ?? null,
    set: (key, value) => {
      entries.set(key, value);
    },
  };
}

function saved(store: PrefsStore): Workspace {
  const raw = store.get(DEMO_WORKSPACE_KEY);
  if (!raw) throw Error("nothing saved");
  return JSON.parse(raw) as Workspace;
}

describe("demo workspace persistence", () => {
  it("seeds the sample workspace when nothing is saved, and saves it", () => {
    const store = memoryStore();
    const w = loadDemoWorkspace(store);
    expect(w.products.length).toBeGreaterThan(0);
    expect(w.profile.shopName).toBe("Sample Jewellery Studio");
    expect(store.raw(DEMO_WORKSPACE_KEY)).not.toBeNull();
    expect(saved(store).profile.shopName).toBe("Sample Jewellery Studio");
  });

  it("saves a mutation (add product) to the store", () => {
    const store = memoryStore();
    const w = loadDemoWorkspace(store);
    const next = demoMutation(w, "product", { ...product, id: "custom-1" });
    saveDemoWorkspace(next, store);
    expect(
      saved(store).products.some((p) => p.id === "custom-1"),
    ).toBe(true);
    expect(saved(store).products.length).toBe(w.products.length + 1);
  });

  it("re-initialising loads the saved workspace instead of re-seeding", () => {
    const store = memoryStore();
    const w = loadDemoWorkspace(store);
    const next = demoMutation(w, "product", {
      ...product,
      id: "custom-2",
      name: "Custom test ring",
    });
    saveDemoWorkspace(next, store);
    const reloaded = loadDemoWorkspace(store);
    expect(
      reloaded.products.some((p) => p.name === "Custom test ring"),
    ).toBe(true);
    expect(reloaded.products.length).toBe(w.products.length + 1);
  });

  it("clearWorkspace stays empty after re-initialising", () => {
    const store = memoryStore();
    const w = loadDemoWorkspace(store);
    expect(w.products.length).toBeGreaterThan(0);
    const cleared = demoMutation(w, "clearWorkspace", {});
    saveDemoWorkspace(cleared, store);
    expect(saved(store).products).toHaveLength(0);
    expect(saved(store).customers).toHaveLength(0);
    expect(saved(store).invoices).toHaveLength(0);
    expect(saved(store).loans).toHaveLength(0);
    // Profile is kept by Start fresh.
    expect(saved(store).profile.shopName).toBe(w.profile.shopName);
    const reloaded = loadDemoWorkspace(store);
    expect(reloaded.products).toHaveLength(0);
    expect(reloaded.customers).toHaveLength(0);
    expect(reloaded.invoices).toHaveLength(0);
    expect(reloaded.loans).toHaveLength(0);
  });

  it("corrupt or invalid saved data falls back to re-seeding", () => {
    const store = memoryStore();
    store.set(DEMO_WORKSPACE_KEY, "not json at all");
    expect(loadDemoWorkspace(store).products.length).toBeGreaterThan(0);
    expect(saved(store).products.length).toBeGreaterThan(0);
    store.set(DEMO_WORKSPACE_KEY, JSON.stringify({ nope: true }));
    expect(loadDemoWorkspace(store).products.length).toBeGreaterThan(0);
  });

  it("a failing store never breaks load or save (and warns)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const broken: PrefsStore = {
        get: () => {
          throw Error("storage unavailable");
        },
        set: () => {
          throw Error("quota exceeded");
        },
      };
      expect(loadDemoWorkspace(broken).products.length).toBeGreaterThan(0);
      expect(() => saveDemoWorkspace(seedDemo(), broken)).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
