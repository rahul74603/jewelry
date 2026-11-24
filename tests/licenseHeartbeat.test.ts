import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  configured: false,
  status: "active" as "active" | "blocked",
  fail: false,
}));

vi.mock("../src/lib/firebaseClient", () => ({
  isFirebaseConfigured: () => state.configured,
  getFunctionsApi: async () => ({ fake: true }),
}));

const callableFn = vi.hoisted(() =>
  vi.fn(async () => {
    if (state.fail) throw Error("network down");
    return { data: { status: state.status } };
  }),
);
vi.mock("firebase/functions", () => ({
  httpsCallable: () => callableFn,
}));

import {
  checkLicenseHeartbeat,
  maybeCheckLicenseHeartbeat,
  isLicenseBlocked,
  setLicenseBlocked,
  shouldCheckLicense,
  getDeviceModel,
  LICENSE_BLOCKED_KEY,
  LICENSE_CHECK_AT_KEY,
  LICENSE_CHECK_INTERVAL_MS,
} from "../src/lib/licenseCheck";
import {
  listOfflineLicenses,
  setOfflineLicenseStatus,
  NOT_CONFIGURED_MESSAGE,
} from "../src/lib/licenseAdmin";

vi.mock("../src/lib/cloud", () => ({
  company: vi.fn(async (op: string) => {
    if (op === "offlineLicenses")
      return {
        devices: [
          {
            deviceId: "bbbb2222cccc",
            shopName: "Second Shop",
            model: "Pixel 8",
            appVersion: "1.0.35",
            status: "active",
            firstSeen: 1000,
            lastSeen: 2000,
            heartbeatCount: 3,
          },
          {
            deviceId: "aaaa-1111-2222",
            shopName: "First Shop",
            model: "",
            appVersion: "dev",
            status: "blocked",
            firstSeen: 500,
            lastSeen: 9000,
            heartbeatCount: 1,
          },
        ],
      };
    return { ok: true };
  }),
}));

// vitest runs in node by default: provide a minimal localStorage.
function installStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
    configurable: true,
  });
}
installStorage();

const args = {
  deviceId: "ABCD-1234-EF01",
  shopName: "Test Shop",
  model: "Infinix X6815D",
  appVersion: "1.0.35",
};

describe("license heartbeat: no-op when unconfigured", () => {
  beforeEach(() => {
    state.configured = false;
    state.fail = false;
    localStorage.clear();
    callableFn.mockClear();
  });

  it("never touches Firebase and never throws", async () => {
    const r = await checkLicenseHeartbeat(args);
    expect(r).toEqual({ skipped: true, status: "active" });
    expect(callableFn).not.toHaveBeenCalled();
    expect(isLicenseBlocked()).toBe(false);
  });
});

describe("license heartbeat: blocked flag", () => {
  beforeEach(() => {
    state.configured = true;
    state.fail = false;
    localStorage.clear();
    callableFn.mockClear();
  });

  it("sets the blocked flag when the server says blocked", async () => {
    state.status = "blocked";
    const r = await checkLicenseHeartbeat(args);
    expect(r.status).toBe("blocked");
    expect(isLicenseBlocked()).toBe(true);
    expect(localStorage.getItem(LICENSE_BLOCKED_KEY)).toBe("1");
  });

  it("clears the blocked flag when the server says active", async () => {
    setLicenseBlocked(true);
    state.status = "active";
    const r = await checkLicenseHeartbeat(args);
    expect(r.status).toBe("active");
    expect(isLicenseBlocked()).toBe(false);
  });

  it("a network error reports active and never blocks the app", async () => {
    state.fail = true;
    setLicenseBlocked(true);
    const r = await checkLicenseHeartbeat(args);
    expect(r).toEqual({ status: "active", error: true });
    // A failed check leaves the previous flag alone.
    expect(isLicenseBlocked()).toBe(true);
  });

  it("an invalid device id is a no-op, not a crash", async () => {
    const r = await checkLicenseHeartbeat({ ...args, deviceId: "not-a-device" });
    expect(r).toEqual({ skipped: true, status: "active" });
    expect(callableFn).not.toHaveBeenCalled();
  });
});

describe("license heartbeat: once-a-day throttle", () => {
  beforeEach(() => {
    state.configured = true;
    state.fail = false;
    state.status = "active";
    localStorage.clear();
    callableFn.mockClear();
  });

  it("skips the call when a check ran within the last day", async () => {
    localStorage.setItem(LICENSE_CHECK_AT_KEY, String(Date.now()));
    expect(shouldCheckLicense()).toBe(false);
    const r = await maybeCheckLicenseHeartbeat(args);
    expect(r.skipped).toBe(true);
    expect(callableFn).not.toHaveBeenCalled();
  });

  it("calls again after 24 hours have passed", async () => {
    localStorage.setItem(
      LICENSE_CHECK_AT_KEY,
      String(Date.now() - LICENSE_CHECK_INTERVAL_MS - 1000),
    );
    expect(shouldCheckLicense()).toBe(true);
    const r = await maybeCheckLicenseHeartbeat(args);
    expect(r.skipped).toBeUndefined();
    expect(callableFn).toHaveBeenCalledTimes(1);
  });
});

describe("getDeviceModel", () => {
  it("returns a string and never throws", async () => {
    const m = await getDeviceModel();
    expect(typeof m).toBe("string");
  });
});

describe("license admin (Master dashboard client)", () => {
  beforeEach(() => {
    callableFn.mockClear();
  });

  it("refuses to call the server when Firebase is not configured", async () => {
    state.configured = false;
    await expect(listOfflineLicenses()).rejects.toThrow(
      NOT_CONFIGURED_MESSAGE,
    );
    await expect(
      setOfflineLicenseStatus("ABCD-1234-EF01", "blocked"),
    ).rejects.toThrow(NOT_CONFIGURED_MESSAGE);
  });

  it("maps server rows: normalises ids, newest lastSeen first", async () => {
    state.configured = true;
    const rows = await listOfflineLicenses();
    expect(rows.map((r) => r.deviceId)).toEqual([
      "AAAA11112222",
      "BBBB2222CCCC",
    ]);
    expect(rows[0].status).toBe("blocked");
    expect(rows[0].shopName).toBe("First Shop");
    expect(rows[1].heartbeatCount).toBe(3);
  });
});
