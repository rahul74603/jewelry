import { it, expect, describe } from "vitest";
import {
  createBackup,
  backupFilename,
  type BackupFile,
} from "../src/lib/backup";
import {
  deriveCloudStatus,
  loadCloudFolder,
  saveCloudFolder,
  getCloudStatus,
  pickCloudFolder,
  uploadBackupToCloud,
  downloadBackupFromCloud,
  verifyCloudFolder,
  disconnectCloudFolder,
  memoryCloudStore,
  type CloudFolder,
  type CloudStore,
  type DriveFolderNative,
} from "../src/lib/cloudBackup";
import {
  emptyWorkspace,
  makeProfile,
  type Workspace,
} from "../functions/src/core/model";

function sampleWorkspace(): Workspace {
  const w = emptyWorkspace(
    makeProfile("Test Jewellers", "Test Owner", "test@example.com"),
  );
  w.products.push({
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
  });
  return w;
}

async function sampleBackup(): Promise<BackupFile> {
  return createBackup(sampleWorkspace(), "2026-11-20T10:00:00.000Z");
}

function fakeNative(impl: Partial<DriveFolderNative> = {}): DriveFolderNative {
  return {
    pickFolder: async () => ({ picked: false }),
    writeFile: async () => ({ written: true }),
    readFile: async () => ({ found: false }),
    checkAccess: async () => ({ ok: true }),
    releaseFolder: async () => {},
    ...impl,
  };
}

function connectedStore(): {
  store: CloudStore;
  map: Map<string, string>;
  folder: CloudFolder;
} {
  const { store, map } = memoryCloudStore();
  const folder: CloudFolder = {
    uri: "content://com.android.externalstorage.documents/tree/primary%3AAurum",
    name: "Aurum",
    connectedAt: "2026-11-20T09:00:00.000Z",
  };
  saveCloudFolder(folder, store);
  return { store, map, folder };
}

describe("cloud status derivation", () => {
  it("is not-connected with no folder", () => {
    expect(deriveCloudStatus(null, false, false)).toBe("not-connected");
  });
  it("is connected with a folder and no problems", () => {
    const { folder } = connectedStore();
    expect(deriveCloudStatus(folder, false, false)).toBe("connected");
  });
  it("is pending when an upload failed and will retry", () => {
    const { folder } = connectedStore();
    expect(deriveCloudStatus(folder, true, false)).toBe("pending");
  });
  it("permission-lost wins over pending", () => {
    const { folder } = connectedStore();
    expect(deriveCloudStatus(folder, true, true)).toBe("permission-lost");
  });
});

describe("cloud folder storage", () => {
  it("loads nothing when nothing was saved", () => {
    const { store } = memoryCloudStore();
    expect(loadCloudFolder(store)).toBeNull();
    expect(getCloudStatus(store).status).toBe("not-connected");
  });
  it("rejects a stored folder with a non-content URI or no name", () => {
    const { store } = memoryCloudStore();
    store.set(
      "aurum:cloud:folder",
      JSON.stringify({ uri: "/sdcard/Aurum", name: "Aurum" }),
    );
    expect(loadCloudFolder(store)).toBeNull();
    store.set(
      "aurum:cloud:folder",
      JSON.stringify({ uri: "content://x/tree/y", name: "" }),
    );
    expect(loadCloudFolder(store)).toBeNull();
  });
  it("round-trips a valid folder and reports its status", () => {
    const { store, folder } = connectedStore();
    expect(loadCloudFolder(store)).toEqual(folder);
    const status = getCloudStatus(store);
    expect(status.status).toBe("connected");
    expect(status.folder?.name).toBe("Aurum");
    expect(status.lastCloudAt).toBeNull();
  });
});

describe("picking the Drive folder", () => {
  it("saves the picked folder and returns it", async () => {
    const { store } = memoryCloudStore();
    const native = fakeNative({
      pickFolder: async () => ({
        picked: true,
        uri: "content://com.android.externalstorage.documents/tree/primary%3ADrive",
        name: "Drive",
      }),
    });
    const folder = await pickCloudFolder(native, store);
    expect(folder?.name).toBe("Drive");
    expect(loadCloudFolder(store)?.uri).toContain("content://");
    expect(getCloudStatus(store).status).toBe("connected");
  });
  it("returns null when the user cancels the picker", async () => {
    const { store } = memoryCloudStore();
    const folder = await pickCloudFolder(fakeNative(), store);
    expect(folder).toBeNull();
    expect(loadCloudFolder(store)).toBeNull();
  });
  it("fails clearly when the Drive app is missing on the phone", async () => {
    const { store } = memoryCloudStore();
    const native = fakeNative({
      pickFolder: async () => {
        throw new Error("drive-app-missing");
      },
    });
    await expect(pickCloudFolder(native, store)).rejects.toThrow(
      "drive-app-missing",
    );
    expect(loadCloudFolder(store)).toBeNull();
  });
});

describe("uploading the yearly file to Drive", () => {
  it("skips the upload when no folder is connected and sets no pending flag", async () => {
    const { store } = memoryCloudStore();
    const file = await sampleBackup();
    const result = await uploadBackupToCloud(file, fakeNative(), store);
    expect(result).toEqual({
      uploaded: false,
      reason: "not-connected",
    });
    expect(store.get("aurum:cloud:pending")).toBeNull();
  });
  it("writes the yearly filename and records the cloud backup time", async () => {
    const { store, folder } = connectedStore();
    const seen: string[] = [];
    const native = fakeNative({
      writeFile: async (options) => {
        seen.push(`${options.uri} :: ${options.filename}`);
        expect(options.content).toContain("aurum-backup");
        return { written: true };
      },
    });
    const file = await sampleBackup();
    const result = await uploadBackupToCloud(file, native, store);
    expect(result).toEqual({ uploaded: true });
    expect(seen[0]).toContain(folder.uri);
    expect(seen[0]).toContain(
      backupFilename("Test Jewellers", new Date("2026-11-20T10:00:00.000Z")),
    );
    expect(store.get("aurum:cloud:last")).toBe("2026-11-20T10:00:00.000Z");
    expect(store.get("aurum:cloud:pending")).toBeNull();
    expect(getCloudStatus(store).status).toBe("connected");
  });
  it("marks the upload pending and the folder lost when permission is revoked", async () => {
    const { store } = connectedStore();
    const native = fakeNative({
      writeFile: async () => {
        throw new Error("permission-revoked");
      },
    });
    const result = await uploadBackupToCloud(await sampleBackup(), native, store);
    expect(result).toEqual({ uploaded: false, reason: "permission-lost" });
    expect(getCloudStatus(store).status).toBe("permission-lost");
    expect(store.get("aurum:cloud:pending")).toBe("1");
  });
  it("marks the upload pending (but not lost) on a plain failure", async () => {
    const { store } = connectedStore();
    const native = fakeNative({
      writeFile: async () => {
        throw new Error("write-failed");
      },
    });
    const result = await uploadBackupToCloud(await sampleBackup(), native, store);
    expect(result).toEqual({ uploaded: false, reason: "failed" });
    expect(getCloudStatus(store).status).toBe("pending");
  });
  it("a later success clears the pending flag", async () => {
    const { store } = connectedStore();
    const failing = fakeNative({
      writeFile: async () => {
        throw new Error("write-failed");
      },
    });
    await uploadBackupToCloud(await sampleBackup(), failing, store);
    expect(getCloudStatus(store).status).toBe("pending");
    const result = await uploadBackupToCloud(
      await sampleBackup(),
      fakeNative(),
      store,
    );
    expect(result).toEqual({ uploaded: true });
    expect(getCloudStatus(store).status).toBe("connected");
  });
});

describe("downloading the backup from Drive", () => {
  it("returns not-connected with no folder", async () => {
    const { store } = memoryCloudStore();
    const result = await downloadBackupFromCloud("x.json", fakeNative(), store);
    expect(result).toEqual({ found: false, reason: "not-connected" });
  });
  it("returns the file text when it is in the Drive folder", async () => {
    const { store } = connectedStore();
    const native = fakeNative({
      readFile: async (options) => {
        expect(options.filename).toBe("aurum-backup-test-jewellers-2026.json");
        return { found: true, content: '{"format":"aurum-backup"}' };
      },
    });
    const result = await downloadBackupFromCloud(
      "aurum-backup-test-jewellers-2026.json",
      native,
      store,
    );
    expect(result).toEqual({
      found: true,
      text: '{"format":"aurum-backup"}',
    });
  });
  it("reports not-found when the Drive folder has no backup yet", async () => {
    const { store } = connectedStore();
    const result = await downloadBackupFromCloud(
      "aurum-backup-test-jewellers-2026.json",
      fakeNative(),
      store,
    );
    expect(result).toEqual({ found: false, reason: "not-found" });
    expect(getCloudStatus(store).status).toBe("connected");
  });
  it("reports permission-lost and records it when access is revoked", async () => {
    const { store } = connectedStore();
    const native = fakeNative({
      readFile: async () => {
        throw new Error("permission-revoked");
      },
    });
    const result = await downloadBackupFromCloud("x.json", native, store);
    expect(result).toEqual({ found: false, reason: "permission-lost" });
    expect(getCloudStatus(store).status).toBe("permission-lost");
  });
});

describe("verifying and disconnecting the folder", () => {
  it("verify returns false with no folder", async () => {
    const { store } = memoryCloudStore();
    expect(await verifyCloudFolder(fakeNative(), store)).toBe(false);
  });
  it("verify clears the lost flag when access is fine again", async () => {
    const { store } = connectedStore();
    store.set("aurum:cloud:access-lost", "1");
    expect(getCloudStatus(store).status).toBe("permission-lost");
    expect(await verifyCloudFolder(fakeNative(), store)).toBe(true);
    expect(getCloudStatus(store).status).toBe("connected");
  });
  it("verify records the loss when the folder is gone", async () => {
    const { store } = connectedStore();
    const native = fakeNative({
      checkAccess: async () => ({ ok: false, reason: "folder-missing" }),
    });
    expect(await verifyCloudFolder(native, store)).toBe(false);
    expect(getCloudStatus(store).status).toBe("permission-lost");
  });
  it("disconnect releases the folder and forgets all cloud state", async () => {
    const { store, folder } = connectedStore();
    store.set("aurum:cloud:last", "2026-11-20T10:00:00.000Z");
    store.set("aurum:cloud:pending", "1");
    let released = "";
    const native = fakeNative({
      releaseFolder: async (options) => {
        released = options.uri;
      },
    });
    await disconnectCloudFolder(native, store);
    expect(released).toBe(folder.uri);
    expect(getCloudStatus(store).status).toBe("not-connected");
    expect(loadCloudFolder(store)).toBeNull();
    expect(store.get("aurum:cloud:last")).toBeNull();
    expect(store.get("aurum:cloud:pending")).toBeNull();
  });
});
