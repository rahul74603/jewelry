import { it, expect, describe, vi, beforeEach, afterEach } from "vitest";
import {
  createBackup,
  localDay,
  type BackupFile,
} from "../src/lib/backup";
import {
  SERVER_BACKUP_MAX_BYTES,
  fetchLatestServerBackup,
  getServerBackupStatus,
  isServerBackupUploadPending,
  loadLastServerBackupUploadAt,
  loadServerBackupReason,
  markServerBackupFailed,
  markServerBackupPending,
  markServerBackupUploaded,
  memoryServerBackupStore,
  serverBackupKey,
  syncServerBackupOnOpen,
  transferServerBackup,
  uploadBackupToServer,
  type PrefsStore,
} from "../src/lib/serverBackup";
import {
  emptyWorkspace,
  makeProfile,
  type Workspace,
} from "../functions/src/core/model";

const BASE = "https://aurum-license-server.test.workers.dev";
const TOKEN = "test-admin-token-123";
const DEVICE = "aabbccddeeff";
const OTHER_DEVICE = "112233445566";

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

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

type FetchCall = [string, RequestInit | undefined];

function recordingFetch(
  impl: (url: string, init?: RequestInit) => Response | Error,
): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const out = impl(url, init);
    if (out instanceof Error) throw out;
    return out;
  }) as typeof fetch;
  return { fetchFn, calls };
}

function pendingStore(): { store: PrefsStore; map: Map<string, string> } {
  const { store, map } = memoryServerBackupStore();
  markServerBackupPending(store);
  return { store, map };
}

describe("serverBackupKey", () => {
  it("builds the per-device yearly key", () => {
    expect(serverBackupKey(DEVICE, 2026)).toBe(
      "backups/aabbccddeeff/aurum-backup-2026.json",
    );
  });
  it("normalises dashes and uppercase to 12 lowercase hex", () => {
    expect(serverBackupKey("AABB-CCDD-EEFF", 2027)).toBe(
      "backups/aabbccddeeff/aurum-backup-2027.json",
    );
  });
  it("is under the 5 MB Worker limit constant", () => {
    expect(SERVER_BACKUP_MAX_BYTES).toBe(5 * 1024 * 1024);
  });
});

describe("server backup pending / last-upload state", () => {
  it("starts as never with nothing stored", () => {
    const { store } = memoryServerBackupStore();
    expect(getServerBackupStatus(store)).toEqual({
      status: "never",
      lastUploadAt: null,
      pending: false,
      reason: null,
    });
  });
  it("markServerBackupPending + markServerBackupFailed keeps pending and records the reason", () => {
    const { store } = memoryServerBackupStore();
    markServerBackupPending(store);
    markServerBackupFailed("offline", store);
    expect(isServerBackupUploadPending(store)).toBe(true);
    expect(loadServerBackupReason(store)).toBe("offline");
    expect(getServerBackupStatus(store).status).toBe("pending");
    expect(getServerBackupStatus(store).reason).toBe("offline");
  });
  it("markServerBackupUploaded records the date and clears pending + reason", () => {
    const { store } = memoryServerBackupStore();
    markServerBackupPending(store);
    markServerBackupFailed("offline", store);
    markServerBackupUploaded("2026-11-20T10:00:00.000Z", store);
    expect(isServerBackupUploadPending(store)).toBe(false);
    expect(loadLastServerBackupUploadAt(store)).toBe("2026-11-20T10:00:00.000Z");
    expect(loadServerBackupReason(store)).toBeNull();
    expect(store.get("aurum:serverbackup:pending")).toBeNull();
    expect(getServerBackupStatus(store).status).toBe("ok");
  });
});

describe("uploadBackupToServer", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uploads on success and records last-upload + clears pending", async () => {
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() =>
      jsonResponse({ ok: true, key: `backups/${DEVICE}/aurum-backup-2026.json`, size: 1234 }),
    );
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({
      uploaded: true,
      key: `backups/${DEVICE}/aurum-backup-2026.json`,
      size: 1234,
    });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`${BASE}/backup/upload?deviceId=${DEVICE}`);
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("aurum-backup");
    expect(loadLastServerBackupUploadAt(store)).toBe("2026-11-20T10:00:00.000Z");
    expect(isServerBackupUploadPending(store)).toBe(false);
    expect(getServerBackupStatus(store).status).toBe("ok");
  });

  it("maps 403 to blocked and keeps pending", async () => {
    const { store } = pendingStore();
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "blocked" }, 403),
    );
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "blocked" });
    expect(isServerBackupUploadPending(store)).toBe(true);
    expect(loadServerBackupReason(store)).toBe("blocked");
  });

  it("maps 404 to unknown-device", async () => {
    const { store } = pendingStore();
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "unknown device" }, 404),
    );
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "unknown-device" });
    expect(loadServerBackupReason(store)).toBe("unknown-device");
  });

  it("maps 413 to too-large", async () => {
    const { store } = pendingStore();
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "oversize" }, 413),
    );
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "too-large" });
  });

  it("maps other non-2xx to failed", async () => {
    const { store } = pendingStore();
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "boom" }, 500),
    );
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "failed" });
    expect(loadServerBackupReason(store)).toBe("failed");
  });

  it("maps a network throw to offline and records the attempt date", async () => {
    const { store } = pendingStore();
    const { fetchFn } = recordingFetch(() => Error("network down"));
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "offline" });
    expect(store.get("aurum:serverbackup:attempt")).toBe(localDay());
    expect(isServerBackupUploadPending(store)).toBe(true);
  });

  it("returns not-configured without touching the network when no server URL", async () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", "");
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    const result = await uploadBackupToServer(await sampleBackup(), DEVICE, store, fetchFn);
    expect(result).toEqual({ uploaded: false, reason: "not-configured" });
    expect(calls).toHaveLength(0);
    expect(isServerBackupUploadPending(store)).toBe(true);
  });
});

describe("syncServerBackupOnOpen (once-per-day retry)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does nothing when nothing is pending", async () => {
    const { store } = memoryServerBackupStore();
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    const result = await syncServerBackupOnOpen(sampleWorkspace(), DEVICE, store, fetchFn);
    expect(result).toEqual({ attempted: false });
    expect(calls).toHaveLength(0);
  });

  it("attempts once and succeeds when pending", async () => {
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() =>
      jsonResponse({ ok: true, key: `backups/${DEVICE}/aurum-backup-2026.json`, size: 99 }),
    );
    const result = await syncServerBackupOnOpen(sampleWorkspace(), DEVICE, store, fetchFn);
    expect(result).toEqual({ attempted: true, uploaded: true });
    expect(calls).toHaveLength(1);
    expect(isServerBackupUploadPending(store)).toBe(false);
    expect(loadLastServerBackupUploadAt(store)).not.toBeNull();
  });

  it("does NOT attempt twice the same day after a failure", async () => {
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() =>
      jsonResponse({ error: "boom" }, 500),
    );
    const first = await syncServerBackupOnOpen(sampleWorkspace(), DEVICE, store, fetchFn);
    expect(first).toEqual({ attempted: true, uploaded: false, reason: "failed" });
    expect(calls).toHaveLength(1);
    const second = await syncServerBackupOnOpen(sampleWorkspace(), DEVICE, store, fetchFn);
    expect(second).toEqual({ attempted: false, reason: "already-tried-today" });
    expect(calls).toHaveLength(1);
  });

  it("returns attempted:false for an empty deviceId", async () => {
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    const result = await syncServerBackupOnOpen(sampleWorkspace(), "", store, fetchFn);
    expect(result).toEqual({ attempted: false });
    expect(calls).toHaveLength(0);
  });

  it("returns attempted:false for a malformed deviceId", async () => {
    const { store } = pendingStore();
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    const result = await syncServerBackupOnOpen(sampleWorkspace(), "not-a-device", store, fetchFn);
    expect(result).toEqual({ attempted: false });
    expect(calls).toHaveLength(0);
  });
});

describe("fetchLatestServerBackup", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the backup text with headers parsed on 200", async () => {
    const { fetchFn, calls } = recordingFetch(
      () =>
        new Response('{"format":"aurum-backup"}', {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Aurum-Backup-Key": `backups/${DEVICE}/aurum-backup-2026.json`,
            "X-Aurum-Backup-Uploaded": "2026-11-20T10:00:00.000Z",
            "X-Aurum-Backup-Size": "1234",
          },
        }),
    );
    const result = await fetchLatestServerBackup(DEVICE, fetchFn);
    expect(result).toEqual({
      found: true,
      text: '{"format":"aurum-backup"}',
      key: `backups/${DEVICE}/aurum-backup-2026.json`,
      uploadedAt: "2026-11-20T10:00:00.000Z",
      size: 1234,
    });
    expect(calls[0][0]).toBe(`${BASE}/backup/latest?deviceId=${DEVICE}`);
    expect(calls[0][1]?.method).toBe("GET");
  });

  it("maps 404 to not-found", async () => {
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "no backup" }, 404),
    );
    expect(await fetchLatestServerBackup(DEVICE, fetchFn)).toEqual({
      found: false,
      reason: "not-found",
    });
  });

  it("maps 403 to blocked", async () => {
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "blocked" }, 403),
    );
    expect(await fetchLatestServerBackup(DEVICE, fetchFn)).toEqual({
      found: false,
      reason: "blocked",
    });
  });

  it("maps a network throw to offline", async () => {
    const { fetchFn } = recordingFetch(() => Error("network down"));
    expect(await fetchLatestServerBackup(DEVICE, fetchFn)).toEqual({
      found: false,
      reason: "offline",
    });
  });

  it("returns not-configured without touching the network when no server URL", async () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", "");
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({}));
    expect(await fetchLatestServerBackup(DEVICE, fetchFn)).toEqual({
      found: false,
      reason: "not-configured",
    });
    expect(calls).toHaveLength(0);
  });
});

describe("transferServerBackup (admin)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the admin Bearer header and the JSON body", async () => {
    const { fetchFn, calls } = recordingFetch(() =>
      jsonResponse({
        ok: true,
        copied: [`backups/${OTHER_DEVICE}/aurum-backup-2026.json`],
        fromDeviceId: DEVICE,
        toDeviceId: OTHER_DEVICE,
      }),
    );
    const result = await transferServerBackup(DEVICE, OTHER_DEVICE, fetchFn);
    expect(result).toEqual({
      copied: [`backups/${OTHER_DEVICE}/aurum-backup-2026.json`],
      fromDeviceId: DEVICE,
      toDeviceId: OTHER_DEVICE,
    });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe(`${BASE}/admin/backup/transfer`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      fromDeviceId: DEVICE,
      toDeviceId: OTHER_DEVICE,
    });
  });

  it("throws on 401", async () => {
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "unauthorized" }, 401),
    );
    await expect(transferServerBackup(DEVICE, OTHER_DEVICE, fetchFn)).rejects.toThrow();
  });

  it("throws on 404 (no backup)", async () => {
    const { fetchFn } = recordingFetch(() =>
      jsonResponse({ error: "no backup" }, 404),
    );
    await expect(transferServerBackup(DEVICE, OTHER_DEVICE, fetchFn)).rejects.toThrow(
      /koi cloud backup nahi mila/,
    );
  });

  it("throws before fetch on bad ids", async () => {
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    await expect(transferServerBackup("bad", OTHER_DEVICE, fetchFn)).rejects.toThrow(
      /Device ID galat hai/,
    );
    await expect(transferServerBackup(DEVICE, "xyz", fetchFn)).rejects.toThrow(
      /Device ID galat hai/,
    );
    expect(calls).toHaveLength(0);
  });

  it("throws before fetch when both ids are the same device", async () => {
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    await expect(transferServerBackup(DEVICE, DEVICE, fetchFn)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("throws when the server URL is not configured", async () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", "");
    const { fetchFn, calls } = recordingFetch(() => jsonResponse({ ok: true }));
    await expect(transferServerBackup(DEVICE, OTHER_DEVICE, fetchFn)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
