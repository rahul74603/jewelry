import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listUpdates, pushRelease as pushReleaseTransport } from "../src/lib/licenseServer";
import {
  deriveReleaseStatus,
  listUpdateRecords,
  pushRelease,
  type UpdateRow,
} from "../src/lib/licenseAdmin";

const BASE = "https://aurum-license-server.test.workers.dev";
const TOKEN = "test-admin-token-123";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const RECORD = {
  deviceId: "aabbccddeeff",
  version: "1.0.45",
  customerArm64Url: "https://cdn.test/customer-arm64.apk",
  customerArmeabiUrl: "https://cdn.test/customer-armeabi.apk",
  masterArm64Url: "https://cdn.test/master-arm64.apk",
  allowed: false,
  mandatory: false,
  updatedAt: 1795000000000,
};

function row(over: Partial<UpdateRow> = {}): UpdateRow {
  return {
    deviceId: "AABBCCDDEEFF",
    version: "1.0.45",
    customerArm64Url: "https://cdn.test/customer-arm64.apk",
    customerArmeabiUrl: "https://cdn.test/customer-armeabi.apk",
    masterArm64Url: "https://cdn.test/master-arm64.apk",
    allowed: false,
    mandatory: false,
    updatedAt: 1795000000000,
    ...over,
  };
}

describe("licenseServer update admin transport", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
    fetchFn = vi.fn(async () => jsonResponse({ updates: [RECORD] }));
    vi.stubGlobal("fetch", fetchFn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("listUpdates GETs /admin/updates with the Bearer token", async () => {
    const out = await listUpdates();
    expect(out).toEqual([RECORD]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin/updates`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("listUpdates throws the server message on a 401", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, 401),
    );
    await expect(listUpdates()).rejects.toThrow("unauthorized");
  });

  it("pushRelease POSTs to /admin/releases/:version/push and returns {version, pushedTo}", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ version: "1.0.45", pushedTo: 3 }),
    );
    const out = await pushReleaseTransport("1.0.45");
    expect(out).toEqual({ version: "1.0.45", pushedTo: 3 });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin/releases/1.0.45/push`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("pushRelease throws the server message on a 404", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
    await expect(pushReleaseTransport("9.9.9")).rejects.toThrow("not found");
  });

  it("admin update calls refuse without a token, without touching the network", async () => {
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", "");
    await expect(listUpdates()).rejects.toThrow("admin token");
    await expect(pushReleaseTransport("1.0.45")).rejects.toThrow(
      "admin token",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("licenseAdmin staged rollout", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
    fetchFn = vi.fn(async () => jsonResponse({ updates: [RECORD] }));
    vi.stubGlobal("fetch", fetchFn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("listUpdateRecords normalises the Device ID and sorts newest first", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({
        updates: [
          { ...RECORD, deviceId: "aabbccddeeff", updatedAt: 100 },
          {
            ...RECORD,
            deviceId: "112233445566",
            version: "1.0.44",
            updatedAt: 200,
          },
        ],
      }),
    );
    const rows = await listUpdateRecords();
    expect(rows.map((r) => r.deviceId)).toEqual([
      "112233445566",
      "AABBCCDDEEFF",
    ]);
    expect(rows[0].version).toBe("1.0.44");
    expect(rows[0].allowed).toBe(false);
  });

  it("pushRelease posts to the push endpoint and returns the server result", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ version: "1.0.45", pushedTo: 2 }),
    );
    const out = await pushRelease("1.0.45");
    expect(out).toEqual({ version: "1.0.45", pushedTo: 2 });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/admin/releases/1.0.45/push`);
    expect(init.method).toBe("POST");
  });

  it("pushRelease refuses when the server is not configured", async () => {
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", "");
    await expect(pushRelease("1.0.45")).rejects.toThrow("not connected");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("pushRelease refuses an empty version", async () => {
    await expect(pushRelease("   ")).rejects.toThrow("khaali");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("deriveReleaseStatus (staged vs pushed)", () => {
  it("returns null with no records", () => {
    expect(deriveReleaseStatus([])).toBeNull();
  });

  it("newest version across records is the staged version", () => {
    const s = deriveReleaseStatus([
      row({ deviceId: "AABBCCDDEEFF", version: "1.0.44", allowed: true }),
      row({ deviceId: "112233445566", version: "1.0.45", allowed: false }),
    ]);
    expect(s).toEqual({
      version: "1.0.45",
      status: "testing",
      pushedAt: 0,
    });
  });

  it("testing while ANY record for the staged version is not allowed", () => {
    const s = deriveReleaseStatus([
      row({ deviceId: "AABBCCDDEEFF", allowed: true }),
      row({ deviceId: "112233445566", allowed: false }),
    ]);
    expect(s?.status).toBe("testing");
  });

  it("pushed when EVERY record for the staged version is allowed, with the newest updatedAt", () => {
    const s = deriveReleaseStatus([
      row({ deviceId: "AABBCCDDEEFF", allowed: true, updatedAt: 1000 }),
      row({ deviceId: "112233445566", allowed: true, updatedAt: 2500 }),
      // An older version, fully allowed, must not change the result.
      row({
        deviceId: "AABBCCDDEEFF",
        version: "1.0.44",
        allowed: true,
        updatedAt: 9999,
      }),
    ]);
    expect(s).toEqual({
      version: "1.0.45",
      status: "pushed",
      pushedAt: 2500,
    });
  });

  it("an older allowed version does not mark a newer testing version as pushed", () => {
    const s = deriveReleaseStatus([
      row({ deviceId: "AABBCCDDEEFF", version: "1.0.44", allowed: true }),
      row({ deviceId: "AABBCCDDEEFF", version: "1.0.45", allowed: false }),
    ]);
    expect(s).toEqual({
      version: "1.0.45",
      status: "testing",
      pushedAt: 0,
    });
  });
});
