import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getLicenseServerUrl,
  isLicenseServerConfigured,
  isLicenseAdminConfigured,
  heartbeat,
  listLicenses,
  setLicenseStatus,
} from "../src/lib/licenseServer";

const BASE = "https://aurum-license-server.test.workers.dev";
const TOKEN = "test-admin-token-123";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("licenseServer transport", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", TOKEN);
    fetchFn = vi.fn(async () => jsonResponse({ status: "active" }));
    vi.stubGlobal("fetch", fetchFn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads the server URL and strips trailing slashes", () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", `${BASE}///`);
    expect(getLicenseServerUrl()).toBe(BASE);
    expect(isLicenseServerConfigured()).toBe(true);
  });

  it("is unconfigured when the server URL is missing", () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", "");
    expect(isLicenseServerConfigured()).toBe(false);
    expect(isLicenseAdminConfigured()).toBe(false);
  });

  it("admin is unconfigured when the token is missing", () => {
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", "");
    expect(isLicenseServerConfigured()).toBe(true);
    expect(isLicenseAdminConfigured()).toBe(false);
  });

  it("heartbeat posts the four fields with a lowercase device id", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ status: "blocked" }));
    const r = await heartbeat({
      deviceId: "ABCD-1234-EF01",
      shopName: "Test Shop",
      model: "Infinix X6815D",
      appVersion: "1.0.35",
    });
    expect(r).toEqual({ status: "blocked" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/heartbeat`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      deviceId: "abcd1234ef01",
      shopName: "Test Shop",
      model: "Infinix X6815D",
      appVersion: "1.0.35",
    });
    // Heartbeat is public: no admin token on the wire.
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("heartbeat throws the server error message on a 400", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ error: "invalid deviceId" }, 400),
    );
    await expect(
      heartbeat({
        deviceId: "bad",
        shopName: "",
        model: "",
        appVersion: "",
      }),
    ).rejects.toThrow("invalid deviceId");
  });

  it("heartbeat throws on a 429 (caller treats it as active, not a block)", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ error: "too many requests" }, 429),
    );
    await expect(
      heartbeat({
        deviceId: "aabbccddeeff",
        shopName: "",
        model: "",
        appVersion: "",
      }),
    ).rejects.toThrow("too many requests");
  });

  it("heartbeat throws on a network failure", async () => {
    fetchFn.mockRejectedValueOnce(Error("network down"));
    await expect(
      heartbeat({
        deviceId: "aabbccddeeff",
        shopName: "",
        model: "",
        appVersion: "",
      }),
    ).rejects.toThrow("network down");
  });

  it("heartbeat throws on an unexpected response shape", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ nope: true }));
    await expect(
      heartbeat({
        deviceId: "aabbccddeeff",
        shopName: "",
        model: "",
        appVersion: "",
      }),
    ).rejects.toThrow("unexpected response");
  });

  it("heartbeat times out after 10s instead of hanging", async () => {
    vi.useFakeTimers();
    fetchFn.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const p = heartbeat({
      deviceId: "aabbccddeeff",
      shopName: "",
      model: "",
      appVersion: "",
    });
    // Attach the rejection handler BEFORE advancing the timers, or
    // the rejection lands with no handler and Vitest reports it as
    // an unhandled rejection even though the test then catches it.
    const assertion = expect(p).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });

  it("listLicenses sends the Bearer token and returns the rows", async () => {
    const rows = [
      {
        deviceId: "aabbccddeeff",
        shopName: "Shop",
        model: "M",
        appVersion: "1.0.37",
        status: "active",
        firstSeen: 1,
        lastSeen: 2,
        heartbeatCount: 1,
      },
    ];
    fetchFn.mockResolvedValueOnce(jsonResponse({ licenses: rows }));
    const out = await listLicenses();
    expect(out).toEqual(rows);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/licenses`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("listLicenses throws the server message on a 401", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, 401),
    );
    await expect(listLicenses()).rejects.toThrow("unauthorized");
  });

  it("setLicenseStatus posts block/unblock with the Bearer token", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await setLicenseStatus("ABCD-1234-EF01", "blocked");
    let [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/licenses/abcd1234ef01/block`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    fetchFn.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await setLicenseStatus("ABCD1234EF01", "active");
    [url, init] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${BASE}/licenses/abcd1234ef01/unblock`);
  });

  it("setLicenseStatus throws the server message on a 404", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404));
    await expect(
      setLicenseStatus("aabbccddeeff", "blocked"),
    ).rejects.toThrow("not found");
  });

  it("throws when the server URL is not configured", async () => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", "");
    await expect(
      heartbeat({
        deviceId: "aabbccddeeff",
        shopName: "",
        model: "",
        appVersion: "",
      }),
    ).rejects.toThrow("not configured");
    await expect(listLicenses()).rejects.toThrow("not configured");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("admin calls refuse without a token, without touching the network", async () => {
    vi.stubEnv("VITE_LICENSE_ADMIN_TOKEN", "");
    await expect(listLicenses()).rejects.toThrow("admin token");
    await expect(setLicenseStatus("aabbccddeeff", "blocked")).rejects.toThrow(
      "admin token",
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
