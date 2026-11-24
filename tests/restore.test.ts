import { it, expect, describe } from "vitest";
import { demoMutation, seedDemo } from "../src/lib/demo";
import {
  createBackup,
  parseBackup,
  countsFor,
  type Workspace,
} from "../src/lib/backup";
import {
  emptyWorkspace,
  makeProfile,
  type Product,
} from "../functions/src/core/model";

function sampleWorkspace(): Workspace {
  const w = emptyWorkspace(
    makeProfile("Test Jewellers", "Test Owner", "test@example.com"),
  );
  const product: Product = {
    id: "prod-1",
    name: "Gold Ring",
    sku: "GR-001",
    category: "Rings",
    metal: "Gold",
    purity: "22K",
    gross: 5,
    stone: 0,
    deduction: 0,
    stock: 2,
    cost: 10000,
    makingMode: "Fixed",
    making: 500,
    hsn: "7113",
    huid: "HUID-1",
  };
  w.products.push(product);
  w.customers.push({
    id: "cust-1",
    name: "Rani",
    phone: "9876543210",
    email: "",
    address: "",
    gstin: "",
  });
  w.rates.push({
    id: "rate-1",
    metal: "Gold",
    purity: "22K",
    rate: 7850,
    effectiveAt: new Date().toISOString(),
  });
  return w;
}

describe("real restore", () => {
  it("replaces the whole workspace with the backup's data", async () => {
    const file = await createBackup(sampleWorkspace());
    const restored = demoMutation(seedDemo(), "restore", file.data);
    expect(restored.profile.shopName).toBe("Test Jewellers");
    expect(restored.products).toHaveLength(1);
    expect(restored.products[0].id).toBe("prod-1");
    expect(restored.customers).toHaveLength(1);
    expect(restored.rates).toHaveLength(1);
    expect(countsFor(restored)).toEqual(file.counts);
  });

  it("only applies after validation — a valid backup round-trips, a bad payload throws", async () => {
    const file = await createBackup(sampleWorkspace());
    // The UI path: parseBackup (format, version, checksum, counts) must
    // pass before perform("restore") is ever called.
    const parsed = await parseBackup(JSON.stringify(file));
    expect(parsed.valid).toBe(true);
    if (!parsed.valid) return;
    const restored = demoMutation(seedDemo(), "restore", parsed.file.data);
    expect(restored).toEqual(file.data);

    // The hook itself re-validates: a missing collection throws.
    const missing = { ...file.data, drafts: undefined };
    expect(() => demoMutation(seedDemo(), "restore", missing)).toThrow();
    // A record that breaks the model throws instead of wiping the shop.
    const bad = structuredClone(file.data);
    bad.products[0].stock = -1;
    expect(() => demoMutation(seedDemo(), "restore", bad)).toThrow();
    // A tampered file never reaches the hook — its checksum fails first.
    const tampered = { ...file, data: { ...file.data, products: [] } };
    expect((await parseBackup(JSON.stringify(tampered))).valid).toBe(false);
  });

  it("keeps voided flags and credit notes from the backup", async () => {
    const demo = seedDemo();
    const target = demo.invoices[0];
    const voided = demoMutation(demo, "void", {
      id: target.id,
      reason: "test void",
    });
    expect(voided.invoices[0].voidedAt).toBeTruthy();
    const file = await createBackup(voided);
    const restored = demoMutation(seedDemo(), "restore", file.data);
    const again = restored.invoices.find((b) => b.id === target.id)!;
    expect(again.voidedAt).toBe(voided.invoices[0].voidedAt);
    expect(again.creditNote?.number).toBe(
      voided.invoices[0].creditNote?.number,
    );
  });
});

describe("bank details are optional (old backups)", () => {
  it("a profile without bank fields still validates and restores", async () => {
    // A backup made before bank details existed: no bank fields
    // anywhere — neither on the profile nor on the invoice snapshots.
    const old = structuredClone(sampleWorkspace()) as Record<string, unknown>;
    const profile = old.profile as Record<string, unknown>;
    delete profile.bankName;
    delete profile.accountName;
    delete profile.accountNumber;
    delete profile.ifsc;
    const file = await createBackup(old as never);
    expect((await parseBackup(JSON.stringify(file))).valid).toBe(true);
    const restored = demoMutation(seedDemo(), "restore", file.data);
    expect(restored.profile.shopName).toBe("Test Jewellers");
    expect(restored.profile.bankName).toBeUndefined();
    expect(restored.products).toHaveLength(1);
  });

  it("a profile with bank details round-trips through backup and restore", async () => {
    const w = sampleWorkspace();
    w.profile.bankName = "State Bank";
    w.profile.accountName = "Test Jewellers";
    w.profile.accountNumber = "12345678901";
    w.profile.ifsc = "SBIN0001234";
    const file = await createBackup(w);
    expect((await parseBackup(JSON.stringify(file))).valid).toBe(true);
    const restored = demoMutation(seedDemo(), "restore", file.data);
    expect(restored.profile.bankName).toBe("State Bank");
    expect(restored.profile.accountNumber).toBe("12345678901");
    expect(restored.profile.ifsc).toBe("SBIN0001234");
  });
});
