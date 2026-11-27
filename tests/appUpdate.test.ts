import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Capacitor } from "@capacitor/core";
import {
  compareVersions,
  checkLatest,
  maybeCheckLatest,
  wireDeviceId,
  downloadApk,
  UPDATE_APK_FILENAME,
} from "../src/lib/appUpdate";

// The native download path goes through the Capacitor Filesystem
// plugin — mock it so the tests never touch native code.
const fsMocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/filesystem", () => ({
  Filesystem: {
    downloadFile: fsMocks.downloadFile,
    addListener: fsMocks.addListener,
  },
  Directory: { Cache: "CACHE" },
}));

const BASE = "https://aurum-license-server.test.workers.dev";
const DEVICE_ID = "ABCD-1234-EF01";
const WIRE_ID = "abcd1234ef01";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const LATEST = {
  version: "1.0.45",
  apkUrl: "https://cdn.test/customer-arm64.apk",
  allowed: true,
  mandatory: false,
};

describe("compareVersions", () => {
  it("1.0.45 is newer than 1.0.44", () => {
    expect(compareVersions("1.0.45", "1.0.44")).toBe(1);
    expect(compareVersions("1.0.44", "1.0.45")).toBe(-1);
  });

  it("equal versions compare to 0, including different lengths", () => {
    expect(compareVersions("1.0.45", "1.0.45")).toBe(0);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0", "2.0.0.0")).toBe(0);
  });

  it("older versions compare negative", () => {
    expect(compareVersions("1.0.43", "1.0.44")).toBe(-1);
    expect(compareVersions("1.9.9", "2.0")).toBe(-1);
  });

  it("malformed segments count as 0 and never throw", () => {
    expect(compareVersions("1.0.x", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.x", "1.0.3")).toBe(-1);
    expect(compareVersions("", "1.0.0")).toBe(-1);
    expect(compareVersions("garbage", "garbage")).toBe(0);
    expect(() => compareVersions("1.0.45", "1.0.44")).not.toThrow();
  });
});

describe("wireDeviceId", () => {
  it("normalises to 12 lowercase hex, no dashes — the heartbeat's wire form", () => {
    expect(wireDeviceId("ABCD-1234-EF01")).toBe(WIRE_ID);
    expect(wireDeviceId("abcd1234ef01")).toBe(WIRE_ID);
    expect(wireDeviceId("AB CD-1234 ef01")).toBe(WIRE_ID);
  });

  it("rejects anything that is not 12 hex characters", () => {
    expect(wireDeviceId("")).toBe("");
    expect(wireDeviceId("ABCD-1234")).toBe("");
    expect(wireDeviceId("ABCD-1234-EF0G")).toBe("");
    expect(wireDeviceId("not a device id")).toBe("");
  });
});

describe("checkLatest (per-device contract)", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    fetchFn = vi.fn(async () => jsonResponse(LATEST));
    vi.stubGlobal("fetch", fetchFn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks the server for THIS device, mode and ABI, and uses the returned URL as-is", async () => {
    const r = await checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a");
    expect(r).toEqual({
      available: true,
      version: "1.0.45",
      mandatory: false,
      apkUrl: LATEST.apkUrl,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${BASE}/latest?deviceId=${WIRE_ID}&mode=customer&abi=arm64-v8a`,
    );
    expect(init.method).toBe("GET");
  });

  it("sends mode=master for the master app and mode=customer for demo/live", async () => {
    await checkLatest(BASE, DEVICE_ID, "1.0.44", "master", "arm64-v8a");
    expect(String(fetchFn.mock.calls[0][0])).toContain("mode=master");
    await checkLatest(BASE, DEVICE_ID, "1.0.44", "live", "arm64-v8a");
    expect(String(fetchFn.mock.calls[1][0])).toContain("mode=customer");
  });

  it("sends armeabi-v7a through, and falls back to arm64-v8a for an unknown ABI", async () => {
    await checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "armeabi-v7a");
    expect(String(fetchFn.mock.calls[0][0])).toContain("abi=armeabi-v7a");
    await checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "x86_64");
    expect(String(fetchFn.mock.calls[1][0])).toContain("abi=arm64-v8a");
  });

  it("passes the mandatory flag through", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ ...LATEST, mandatory: true }));
    const r = await checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a");
    expect(r).toEqual({
      available: true,
      version: "1.0.45",
      mandatory: true,
      apkUrl: LATEST.apkUrl,
    });
  });

  it("allowed:false means no update, even for a newer version — and the answer is definitive (checked)", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ ...LATEST, allowed: false }));
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false, checked: true });
  });

  it("a missing allowed flag means NOT allowed (default false)", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ version: "1.0.45", apkUrl: LATEST.apkUrl }),
    );
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false, checked: true });
  });

  it("{allowed:false} with no version at all means no update", async () => {
    fetchFn.mockResolvedValueOnce(jsonResponse({ allowed: false }));
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false, checked: true });
  });

  it("fail-open: version null, or equal/older than installed", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ ...LATEST, version: null }),
    );
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false, checked: true });
    expect(
      await checkLatest(BASE, DEVICE_ID, "1.0.45", "demo", "arm64-v8a"),
    ).toEqual({ available: false, checked: true });
    expect(
      await checkLatest(BASE, DEVICE_ID, "1.0.46", "demo", "arm64-v8a"),
    ).toEqual({ available: false, checked: true });
  });

  it("fail-open: allowed but no APK URL", async () => {
    fetchFn.mockResolvedValueOnce(
      jsonResponse({ version: "1.0.45", allowed: true }),
    );
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false, checked: true });
  });

  it("fail-open: invalid deviceId never touches the network", async () => {
    await expect(
      checkLatest(BASE, "not-a-device", "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fail-open: network error, non-2xx and bad JSON", async () => {
    fetchFn.mockRejectedValueOnce(Error("network down"));
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false });
    fetchFn.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false });
    fetchFn.mockResolvedValueOnce(
      new Response("not json {{", { status: 200 }),
    );
    await expect(
      checkLatest(BASE, DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false });
  });

  it("fail-open: unconfigured server never touches the network", async () => {
    await expect(
      checkLatest("", DEVICE_ID, "1.0.44", "demo", "arm64-v8a"),
    ).resolves.toEqual({ available: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("update check runs on every open (v1.0.54 — no once-a-day cache)", () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv("VITE_LICENSE_SERVER_URL", BASE);
    fetchFn = vi.fn(async () => jsonResponse(LATEST));
    vi.stubGlobal("fetch", fetchFn);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a second check right after the first still hits the server — never skipped", async () => {
    const first = await maybeCheckLatest({
      deviceId: DEVICE_ID,
      currentVersion: "1.0.44",
      mode: "demo",
      abi: "arm64-v8a",
    });
    expect(first.available).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // The banner was dismissed with [Baad me] and the app re-opened:
    // the check runs again and the banner comes straight back.
    const second = await maybeCheckLatest({
      deviceId: DEVICE_ID,
      currentVersion: "1.0.44",
      mode: "demo",
      abi: "arm64-v8a",
    });
    expect(second.available).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a failed check does not block the next check — a down server is retried on the next open", async () => {
    fetchFn.mockRejectedValueOnce(Error("network down"));
    const r = await maybeCheckLatest({
      deviceId: DEVICE_ID,
      currentVersion: "1.0.44",
      mode: "demo",
      abi: "arm64-v8a",
    });
    expect(r).toEqual({ available: false });
    expect(r).not.toHaveProperty("checked");
    const again = await maybeCheckLatest({
      deviceId: DEVICE_ID,
      currentVersion: "1.0.44",
      mode: "demo",
      abi: "arm64-v8a",
    });
    expect(again.available).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a definitive no-update answer carries checked:true so the caller may clear the notice", async () => {
    const r = await maybeCheckLatest({
      deviceId: DEVICE_ID,
      currentVersion: "1.0.45",
      mode: "demo",
      abi: "arm64-v8a",
    });
    expect(r).toEqual({ available: false, checked: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("downloadApk (v1.0.52: no WebView fetch — GitHub sends no CORS headers)", () => {
  const APK_URL =
    "https://github.com/rahul74603/jewelry/releases/download/phone-46022154647-1/Aurum-Customer-arm64.apk";

  let fetchFn: ReturnType<typeof vi.fn>;
  let platformSpy: ReturnType<typeof vi.spyOn>;
  let progressListener:
    | ((s: { url: string; bytes: number; contentLength: number }) => void)
    | null;

  beforeEach(() => {
    vi.clearAllMocks();
    progressListener = null;
    fetchFn = vi.fn(async () => {
      throw Error("fetch must not be called for the APK download");
    });
    vi.stubGlobal("fetch", fetchFn);
    platformSpy = vi.spyOn(Capacitor, "getPlatform");
    fsMocks.downloadFile.mockResolvedValue({ path: UPDATE_APK_FILENAME });
    fsMocks.addListener.mockImplementation(async (_event, cb) => {
      progressListener = cb as typeof progressListener;
      return { remove: fsMocks.remove };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("on Android downloads natively to the cache file and never fetches", async () => {
    platformSpy.mockReturnValue("android");
    const seen: number[] = [];
    await downloadApk(APK_URL, (p) => void seen.push(p));
    expect(fsMocks.addListener).toHaveBeenCalledWith(
      "progress",
      expect.any(Function),
    );
    expect(fsMocks.downloadFile).toHaveBeenCalledWith({
      url: APK_URL,
      path: UPDATE_APK_FILENAME,
      directory: "CACHE",
      progress: true,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fsMocks.remove).toHaveBeenCalledTimes(1);
  });

  it("on Android reports 0–100 progress from native events, -1 when the size is unknown", async () => {
    platformSpy.mockReturnValue("android");
    fsMocks.downloadFile.mockImplementation(async () => {
      progressListener?.({ url: APK_URL, bytes: 512, contentLength: 1024 });
      progressListener?.({ url: APK_URL, bytes: 1024, contentLength: 1024 });
      progressListener?.({ url: APK_URL, bytes: 2048, contentLength: 0 });
      return { path: UPDATE_APK_FILENAME };
    });
    const seen: number[] = [];
    await downloadApk(APK_URL, (p) => void seen.push(p));
    expect(seen).toEqual([50, 100, -1]);
  });

  it("on Android a failed download rejects cleanly and still removes the listener", async () => {
    platformSpy.mockReturnValue("android");
    fsMocks.downloadFile.mockRejectedValueOnce(Error("network down"));
    await expect(downloadApk(APK_URL)).rejects.toThrow("network down");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fsMocks.remove).toHaveBeenCalledTimes(1);
  });

  it("on the web triggers a plain anchor download to the APK URL and never fetches bytes", async () => {
    platformSpy.mockReturnValue("web");
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const createElement = vi.fn(() => anchor);
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild },
    });
    await downloadApk(APK_URL);
    expect(createElement).toHaveBeenCalledWith("a");
    expect(anchor.href).toBe(APK_URL);
    expect(anchor.download).toBe(UPDATE_APK_FILENAME);
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fsMocks.downloadFile).not.toHaveBeenCalled();
  });
});
