import { it, expect, describe, beforeEach } from "vitest";
import {
  emptyWorkspace,
  makeProfile,
  type Workspace,
} from "../functions/src/core/model";
import { memoryCloudStore, type CloudStore } from "../src/lib/cloudBackup";
import {
  loadBackupHistory,
  loadBackupPreferences,
  loadLastBackupAt,
  parseBackup,
  saveBackupPreferences,
} from "../src/lib/backup";
import {
  __resetSnapshotCacheForTests,
  AUTO_BACKUP_SNAPSHOT_PATH,
  autoBackupFailureText,
  cancelAutoBackup,
  loadAutoBackupStatus,
  prepareAutoBackup,
  runAutoBackupNow,
  scheduleAutoBackup,
  syncAutoBackupRun,
  type AutoBackupStatus,
  type BackupSchedulerNative,
} from "../src/lib/autoBackup";

function data(): Workspace {
  const d = emptyWorkspace(makeProfile("Test shop", "Owner", ""));
  d.products = [
    {
      id: "a",
      name: "Test item",
      category: "Rings",
      sku: "TEST-1",
      metal: "Gold",
      purity: "22K",
      stock: 3,
      gross: 5,
      stone: 0,
      deduction: 0,
      cost: 19000,
      makingMode: "Fixed",
      making: 200,
      hsn: "7113",
      huid: "",
    },
  ];
  return d;
}

function fakeNative(
  impl: Partial<BackupSchedulerNative> = {},
): BackupSchedulerNative {
  return {
    scheduleBackup: async () => ({
      scheduled: true,
      mode: "exact",
      exactAllowed: true,
    }),
    cancelBackup: async () => ({ cancelled: true }),
    getStatus: async () => ({
      enabled: true,
      mode: "exact",
      exactAllowed: true,
      lastRunAt: "",
      lastStatus: "",
      lastFilename: "",
      lastShopName: "",
      lastCountsJson: "",
      driveOk: false,
      lastError: "",
    }),
    runNow: async () => ({ started: true }),
    openExactAlarmSettings: async () => {},
    ...impl,
  };
}

function enableAutoBackup(store: CloudStore) {
  saveBackupPreferences(
    { ...loadBackupPreferences(store), autoBackup: true },
    store,
  );
}

beforeEach(() => {
  __resetSnapshotCacheForTests();
});

describe("prepareAutoBackup", () => {
  it("returns disabled when the toggle is off", async () => {
    const store = memoryCloudStore().store;
    const result = await prepareAutoBackup(
      data(),
      fakeNative(),
      store,
      memoryCloudStore().store,
      async () => {},
    );
    expect(result).toEqual({ prepared: false, reason: "disabled" });
  });

  it("returns unsupported for the real plugin off Android", async () => {
    const store = memoryCloudStore().store;
    enableAutoBackup(store);
    const result = await prepareAutoBackup(
      data(),
      undefined,
      store,
      memoryCloudStore().store,
      async () => {},
    );
    expect(result).toEqual({ prepared: false, reason: "unsupported" });
  });

  it("writes a valid backup snapshot when enabled, and skips the rewrite when unchanged", async () => {
    const store = memoryCloudStore().store;
    enableAutoBackup(store);
    const written: [string, string][] = [];
    const writer = async (path: string, json: string) => {
      written.push([path, json]);
    };
    const first = await prepareAutoBackup(
      data(),
      fakeNative(),
      store,
      memoryCloudStore().store,
      writer,
    );
    expect(first.prepared).toBe(true);
    if (!first.prepared) throw Error("expected prepared");
    expect(first.snapshotWritten).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0][0]).toBe(AUTO_BACKUP_SNAPSHOT_PATH);
    expect((await parseBackup(written[0][1])).valid).toBe(true);
    expect(written[0][1]).toContain("Test shop");

    // Same data again — no rewrite.
    const second = await prepareAutoBackup(
      data(),
      fakeNative(),
      store,
      memoryCloudStore().store,
      writer,
    );
    expect(second.prepared).toBe(true);
    if (!second.prepared) throw Error("expected prepared");
    expect(second.snapshotWritten).toBe(false);
    expect(written).toHaveLength(1);

    // Changed data — rewritten.
    const changed = data();
    changed.products[0].stock = 2;
    const third = await prepareAutoBackup(
      changed,
      fakeNative(),
      store,
      memoryCloudStore().store,
      writer,
    );
    expect(third.prepared).toBe(true);
    if (!third.prepared) throw Error("expected prepared");
    expect(third.snapshotWritten).toBe(true);
    expect(written).toHaveLength(2);
  });

  it("syncs a successful native run into localStorage, once", async () => {
    const store = memoryCloudStore().store;
    enableAutoBackup(store);
    const native = fakeNative({
      getStatus: async () => ({
        enabled: true,
        mode: "exact",
        exactAllowed: true,
        lastRunAt: "2026-11-24T02:00:00.000Z",
        lastStatus: "success",
        lastFilename: "aurum-backup-test-shop-2026.json",
        lastShopName: "Test shop",
        lastCountsJson:
          '{"products":1,"customers":0,"rates":0,"invoices":0,"drafts":0,"loans":0}',
        driveOk: true,
        lastError: "",
      }),
    });
    const first = await prepareAutoBackup(
      data(),
      native,
      store,
      memoryCloudStore().store,
      async () => {},
    );
    expect(first.prepared).toBe(true);
    if (!first.prepared) throw Error("expected prepared");
    expect(first.synced).toBe(true);
    expect(loadLastBackupAt(store)).toBe("2026-11-24T02:00:00.000Z");
    expect(loadBackupHistory(store)).toHaveLength(1);
    expect(loadBackupHistory(store)[0].filename).toBe(
      "aurum-backup-test-shop-2026.json",
    );
    expect(loadBackupHistory(store)[0].counts.products).toBe(1);

    // Same run again — not recorded twice.
    const second = await prepareAutoBackup(
      data(),
      native,
      store,
      memoryCloudStore().store,
      async () => {},
    );
    expect(second.prepared).toBe(true);
    if (!second.prepared) throw Error("expected prepared");
    expect(second.synced).toBe(false);
    expect(loadBackupHistory(store)).toHaveLength(1);
  });

  it("does not sync a failed or skipped run", async () => {
    const store = memoryCloudStore().store;
    enableAutoBackup(store);
    for (const lastStatus of ["failed", "no-snapshot"]) {
      const native = fakeNative({
        getStatus: async () => ({
          enabled: true,
          mode: "exact",
          exactAllowed: true,
          lastRunAt: "2026-11-24T02:00:00.000Z",
          lastStatus,
          lastFilename: "",
          lastShopName: "",
          lastCountsJson: "",
          driveOk: false,
          lastError: "write-failed",
        }),
      });
      const result = await prepareAutoBackup(
        data(),
        native,
        store,
        memoryCloudStore().store,
        async () => {},
      );
      expect(result.prepared).toBe(true);
      if (!result.prepared) throw Error("expected prepared");
      expect(result.synced).toBe(false);
    }
    expect(loadLastBackupAt(store)).toBeNull();
  });

  it("re-arms the native schedule when native lost it", async () => {
    const store = memoryCloudStore().store;
    enableAutoBackup(store);
    let scheduled = 0;
    const native = fakeNative({
      getStatus: async () => ({
        enabled: false,
        mode: "",
        exactAllowed: true,
        lastRunAt: "",
        lastStatus: "",
        lastFilename: "",
        lastShopName: "",
        lastCountsJson: "",
        driveOk: false,
        lastError: "",
      }),
      scheduleBackup: async () => {
        scheduled++;
        return { scheduled: true, mode: "periodic", exactAllowed: false };
      },
    });
    const result = await prepareAutoBackup(
      data(),
      native,
      store,
      memoryCloudStore().store,
      async () => {},
    );
    expect(result.prepared).toBe(true);
    if (!result.prepared) throw Error("expected prepared");
    expect(scheduled).toBe(1);
    expect(result.mode).toBe("periodic");
    expect(result.exactAllowed).toBe(false);
  });
});

describe("syncAutoBackupRun", () => {
  const base: AutoBackupStatus = {
    enabled: true,
    mode: "exact",
    exactAllowed: true,
    lastRunAt: "2026-11-24T02:00:00.000Z",
    lastStatus: "success",
    lastFilename: "aurum-backup-test-shop-2026.json",
    lastShopName: "Test shop",
    lastCountsJson: "",
    driveOk: true,
    lastError: "",
  };

  it("counts a partial run (local file exists, Drive failed) as a backup", () => {
    const store = memoryCloudStore().store;
    const ok = syncAutoBackupRun(
      { ...base, lastStatus: "partial", driveOk: false, lastError: "write-failed" },
      store,
    );
    expect(ok).toBe(true);
    expect(loadLastBackupAt(store)).toBe("2026-11-24T02:00:00.000Z");
  });

  it("ignores a failed run and an older run", () => {
    const store = memoryCloudStore().store;
    expect(
      syncAutoBackupRun({ ...base, lastStatus: "failed" }, store),
    ).toBe(false);
    expect(loadLastBackupAt(store)).toBeNull();
    syncAutoBackupRun(base, store);
    expect(
      syncAutoBackupRun(
        { ...base, lastRunAt: "2026-11-23T02:00:00.000Z" },
        store,
      ),
    ).toBe(false);
  });
});

describe("schedule / cancel / runNow", () => {
  it("delegates to the native plugin", async () => {
    let cancelled = 0;
    let started = 0;
    const native = fakeNative({
      cancelBackup: async () => {
        cancelled++;
        return { cancelled: true };
      },
      runNow: async () => {
        started++;
        return { started: true };
      },
    });
    const scheduled = await scheduleAutoBackup(native, memoryCloudStore().store);
    expect(scheduled).toEqual({
      scheduled: true,
      mode: "exact",
      exactAllowed: true,
    });
    await cancelAutoBackup(native);
    expect(cancelled).toBe(1);
    expect(await runAutoBackupNow(native, memoryCloudStore().store)).toBe(true);
    expect(started).toBe(1);
    const status = await loadAutoBackupStatus(native);
    expect(status?.enabled).toBe(true);
    expect(status?.mode).toBe("exact");
  });
});

describe("autoBackupFailureText", () => {
  it("explains the native reason codes", () => {
    expect(autoBackupFailureText("not-connected")).toContain("Drive folder");
    expect(autoBackupFailureText("permission-revoked")).toContain(
      "Drive permission",
    );
    expect(autoBackupFailureText("no-snapshot")).toContain("open the app");
    expect(autoBackupFailureText("local-write-failed")).toContain(
      "AurumBackup folder",
    );
  });
});
