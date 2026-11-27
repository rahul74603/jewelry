import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Capacitor } from "@capacitor/core";
import {
  UPDATE_NOTIFICATION_ID,
  cancelUpdateNotification,
  getUpdateNotificationPermission,
  requestUpdateNotificationPermission,
  showUpdateNotification,
  syncUpdateNotification,
} from "../src/lib/updateNotify";
import type { UpdateAvailable } from "../src/lib/appUpdate";

// The notification plugin is loaded with a dynamic import in
// updateNotify.ts — mock the module so tests never touch native
// code (and never prompt a real permission dialog).
const lnMocks = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: lnMocks.checkPermissions,
    requestPermissions: lnMocks.requestPermissions,
    schedule: lnMocks.schedule,
    cancel: lnMocks.cancel,
  },
}));

const UPDATE: UpdateAvailable = {
  available: true,
  version: "1.0.54",
  mandatory: false,
  apkUrl: "https://example.com/aurum-customer-arm64.apk",
};

describe("updateNotify (v1.0.54 — persistent notification-bar notice)", () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    platformSpy = vi.spyOn(Capacitor, "getPlatform");
    lnMocks.checkPermissions.mockResolvedValue({ display: "granted" });
    lnMocks.requestPermissions.mockResolvedValue({ display: "granted" });
    lnMocks.schedule.mockResolvedValue({ notifications: [{ id: UPDATE_NOTIFICATION_ID }] });
    lnMocks.cancel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("on the web everything is a no-op — the plugin is never called", async () => {
    platformSpy.mockReturnValue("web");
    expect(await getUpdateNotificationPermission()).toBe("denied");
    expect(await requestUpdateNotificationPermission()).toBe(false);
    expect(await showUpdateNotification("1.0.54")).toBe(false);
    expect(await syncUpdateNotification(UPDATE)).toBe("web");
    await cancelUpdateNotification();
    await syncUpdateNotification(null);
    expect(lnMocks.checkPermissions).not.toHaveBeenCalled();
    expect(lnMocks.requestPermissions).not.toHaveBeenCalled();
    expect(lnMocks.schedule).not.toHaveBeenCalled();
    expect(lnMocks.cancel).not.toHaveBeenCalled();
  });

  it("on Android with permission granted, sync posts the ongoing notice with the version", async () => {
    platformSpy.mockReturnValue("android");
    const state = await syncUpdateNotification(UPDATE);
    expect(state).toBe("posted");
    expect(lnMocks.schedule).toHaveBeenCalledTimes(1);
    const [opts] = lnMocks.schedule.mock.calls[0] as [
      { notifications: Array<Record<string, unknown>> },
    ];
    const n = opts.notifications[0];
    expect(n.id).toBe(UPDATE_NOTIFICATION_ID);
    expect(n.title).toBe("Aurum update aaya hai — Update karo");
    expect(String(n.body)).toContain("1.0.54");
    expect(n.ongoing).toBe(true);
    expect(n.autoCancel).toBe(false);
  });

  it("on Android with permission not asked yet, sync asks the app to show the in-app explanation — no notice posted", async () => {
    platformSpy.mockReturnValue("android");
    lnMocks.checkPermissions.mockResolvedValue({ display: "prompt" });
    expect(await syncUpdateNotification(UPDATE)).toBe("needs-permission");
    expect(lnMocks.schedule).not.toHaveBeenCalled();
  });

  it("prompt-with-rationale also means needs-permission", async () => {
    platformSpy.mockReturnValue("android");
    lnMocks.checkPermissions.mockResolvedValue({ display: "prompt-with-rationale" });
    expect(await syncUpdateNotification(UPDATE)).toBe("needs-permission");
    expect(lnMocks.schedule).not.toHaveBeenCalled();
  });

  it("on Android with permission denied, sync returns denied and never posts — the banner is the fallback", async () => {
    platformSpy.mockReturnValue("android");
    lnMocks.checkPermissions.mockResolvedValue({ display: "denied" });
    expect(await syncUpdateNotification(UPDATE)).toBe("denied");
    expect(lnMocks.schedule).not.toHaveBeenCalled();
    expect(await getUpdateNotificationPermission()).toBe("denied");
  });

  it("requestUpdateNotificationPermission returns true only when granted", async () => {
    platformSpy.mockReturnValue("android");
    expect(await requestUpdateNotificationPermission()).toBe(true);
    lnMocks.requestPermissions.mockResolvedValue({ display: "denied" });
    expect(await requestUpdateNotificationPermission()).toBe(false);
  });

  it("showUpdateNotification posts when granted and refuses without permission", async () => {
    platformSpy.mockReturnValue("android");
    expect(await showUpdateNotification("1.0.54")).toBe(true);
    expect(lnMocks.schedule).toHaveBeenCalledTimes(1);
    lnMocks.checkPermissions.mockResolvedValue({ display: "prompt" });
    expect(await showUpdateNotification("1.0.54")).toBe(false);
    expect(lnMocks.schedule).toHaveBeenCalledTimes(1);
  });

  it("sync with no update cancels the standing notice (phone is on the latest version)", async () => {
    platformSpy.mockReturnValue("android");
    expect(await syncUpdateNotification(null)).toBe("unavailable");
    expect(lnMocks.cancel).toHaveBeenCalledTimes(1);
    expect(lnMocks.cancel).toHaveBeenCalledWith({
      notifications: [{ id: UPDATE_NOTIFICATION_ID }],
    });
    await cancelUpdateNotification();
    expect(lnMocks.cancel).toHaveBeenCalledTimes(2);
  });

  it("a plugin failure never throws — safe fallbacks everywhere", async () => {
    platformSpy.mockReturnValue("android");
    lnMocks.checkPermissions.mockRejectedValueOnce(Error("plugin down"));
    expect(await getUpdateNotificationPermission()).toBe("denied");
    lnMocks.checkPermissions.mockRejectedValueOnce(Error("plugin down"));
    expect(await syncUpdateNotification(UPDATE)).toBe("unavailable");
    lnMocks.requestPermissions.mockRejectedValueOnce(Error("plugin down"));
    expect(await requestUpdateNotificationPermission()).toBe(false);
    lnMocks.schedule.mockRejectedValueOnce(Error("plugin down"));
    expect(await showUpdateNotification("1.0.54")).toBe(false);
    lnMocks.cancel.mockRejectedValueOnce(Error("plugin down"));
    await expect(cancelUpdateNotification()).resolves.toBeUndefined();
  });
});
