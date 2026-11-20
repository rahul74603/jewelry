import { it, expect, describe } from "vitest";
import {
  createBackup,
  validateBackup,
  parseBackup,
  backupToJson,
  backupFilename,
  shouldAutoBackup,
  runDailyCheck,
  recordBackupHistory,
  countsFor,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_HISTORY,
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

describe("offline backup", () => {
  it("creates a versioned backup with checksum and counts", async () => {
    const file = await createBackup(sampleWorkspace());
    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(file.counts).toEqual({
      products: 1,
      customers: 1,
      rates: 1,
      invoices: 0,
      drafts: 0,
    });
    expect(countsFor(file.data)).toEqual(file.counts);
  });

  it("validates its own backup and round-trips through JSON", async () => {
    const file = await createBackup(sampleWorkspace());
    const result = await parseBackup(backupToJson(file));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.file.shopName).toBe("Test Jewellers");
  });

  it("rejects a tampered backup whose checksum no longer matches", async () => {
    const file = await createBackup(sampleWorkspace());
    const tampered = { ...file, data: { ...file.data, products: [] } };
    const result = await validateBackup(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid)
      expect(result.errors.join(" ")).toMatch(/Checksum does not match/);
  });

  it("rejects a wrong format, wrong version, or invalid JSON", async () => {
    const file = await createBackup(sampleWorkspace());
    expect((await validateBackup({ ...file, format: "other" })).valid).toBe(false);
    expect((await validateBackup({ ...file, version: 99 })).valid).toBe(false);
    expect((await parseBackup("{not json")).valid).toBe(false);
  });

  it("names one rolling file per year (same file overwritten daily)", () => {
    expect(backupFilename("Test Jewellers", new Date("2026-11-19T10:00:00Z"))).toBe(
      "aurum-backup-test-jewellers-2026.json",
    );
    expect(backupFilename("Test Jewellers", new Date("2027-01-01T10:00:00Z"))).toBe(
      "aurum-backup-test-jewellers-2027.json",
    );
    // Same year, different days → the same file.
    expect(backupFilename("Test Jewellers", new Date("2026-01-01T10:00:00Z"))).toBe(
      backupFilename("Test Jewellers", new Date("2026-12-31T10:00:00Z")),
    );
  });

  it("is due when never backed up, or on a new day — not twice a day", () => {
    expect(shouldAutoBackup(null)).toBe(true);
    const today = new Date();
    expect(shouldAutoBackup(today.toISOString(), today)).toBe(false);
    const yesterday = new Date(today.getTime() - 86400000);
    expect(shouldAutoBackup(yesterday.toISOString(), today)).toBe(true);
    expect(runDailyCheck(null)).toBe(true);
  });

  it("keeps one history entry per yearly file — old years stay listed", () => {
    const entry = (year: number) => ({
      createdAt: `${year}-06-01T00:00:00.000Z`,
      filename: `aurum-backup-test-jewellers-${year}.json`,
      shopName: "Test Jewellers",
      counts: { products: 0, customers: 0, rates: 0, invoices: 0, drafts: 0 },
    });
    // Overwriting the same year's file just refreshes its entry.
    const refreshed = recordBackupHistory([entry(2026)], {
      ...entry(2026),
      createdAt: "2026-11-20T00:00:00.000Z",
    });
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0].createdAt).toContain("2026-11-20");
    // Eleven different years → only the newest 10 are kept.
    let history: typeof refreshed = [];
    for (let y = 2016; y <= 2026; y++)
      history = recordBackupHistory(history, entry(y));
    expect(history).toHaveLength(MAX_BACKUP_HISTORY);
    expect(history[0].filename).toContain("2026");
    expect(history[history.length - 1].filename).toContain("2017");
  });

  it("carries only the 6 real workspace collections", async () => {
    const file = await createBackup(sampleWorkspace());
    expect(Object.keys(file.data).sort()).toEqual([
      "customers",
      "drafts",
      "invoices",
      "products",
      "profile",
      "rates",
    ]);
    expect("payments" in file.data).toBe(false);
  });
});
