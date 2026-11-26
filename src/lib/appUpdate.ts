import { Capacitor, registerPlugin } from "@capacitor/core";
import {
  getLicenseServerUrl,
  LICENSE_REQUEST_TIMEOUT_MS,
} from "./licenseServer";

/**
 * One-tap in-app update ("Ek click update", v1.0.45).
 *
 * STAGED rollout (Ajay, 2026-11-26): there is no single global
 * latest version. The license server holds one update record PER
 * DEVICE — GET {serverUrl}/latest?deviceId=<wire12hex>&mode=
 * customer|master&abi=... returns THAT device's {version, apkUrl,
 * allowed, mandatory} (or {allowed:false} when nothing is
 * recorded). A new version first goes ONLY to Ajay's own test
 * phone (the server shows staged versions to the test device);
 * when he is satisfied he taps "Sabko update bhejo" once in the
 * Master app and the server flips allowed=1 for every device.
 * Until then no shop sees or gets the update. The server picks
 * the APK URL by mode+abi, so the app stays simple.
 *
 * PER-DEVICE signing keys (same decision): every shop's app is
 * signed with that shop's own key — an update for shop A cannot
 * install on shop B's phone (Android signature mismatch). The
 * aurum-release.p12 made 2026-11-26 is AJAY'S OWN phone key
 * (test Customer + Master). An update is IN PLACE — same package
 * name, same (per-device) signing key — so shop data, settings
 * and the device activation all survive it. No uninstall, no
 * re-activation, no new key.
 *
 * When a newer version is allowed, the app offers a one-tap
 * update: download the APK, then open the system installer.
 *
 * Fail-open everywhere: an unconfigured server, no network, a
 * timeout, a bad response, allowed=false, or an equal/older
 * version all mean "no update" and the app works exactly as
 * before, fully offline. The check runs at most once a day (not
 * every 5 minutes like the license heartbeat) — an update is not
 * urgent enough to hammer the server, and a shopkeeper opens the
 * app many times a day.
 *
 * The FIRST release-signed build (1.0.45) still needs ONE
 * uninstall per phone: today's installs use a disposable debug
 * key, so the signature changes. From 1.0.45 onward each phone's
 * own release key signs every build and this updater takes over.
 */

export const UPDATE_CHECK_KEY = "aurum:update-last-check-v1";
/** One day between update checks. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_APK_FILENAME = "aurum-update.apk";

/** Numeric per segment; "1.0.45" > "1.0.44"; equal → 0. Malformed
 * segments count as 0. Never throws. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    try {
      return String(v ?? "")
        .split(".")
        .map((s) => {
          const n = Number(s.trim());
          return Number.isFinite(n) ? Math.floor(n) : 0;
        });
    } catch {
      return [0];
    }
  };
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export type AppMode = "demo" | "live" | "master";

/** Per-device update record from the server: this device's
 * latest version, its APK URL (picked by the server from
 * mode+abi), whether Ajay has allowed the rollout for this
 * device, and whether the update is mandatory. */
export type LatestRelease = {
  version?: string | null;
  apkUrl?: string;
  allowed?: boolean;
  mandatory?: boolean;
};

/** This phone's Device ID on the wire: 12 lowercase hex, no
 * dashes — EXACTLY the value the license heartbeat sends
 * (licenseServer.ts wireDeviceId). "" when the id is not a valid
 * 12-hex Device ID. */
export function wireDeviceId(deviceId: string): string {
  try {
    const hex = String(deviceId ?? "")
      .replace(/[^0-9A-Fa-f]/g, "")
      .toLowerCase();
    return /^[0-9a-f]{12}$/.test(hex) ? hex : "";
  } catch {
    return "";
  }
}

export type UpdateAvailable = {
  available: true;
  version: string;
  mandatory: boolean;
  apkUrl: string;
};

export type UpdateCheckResult =
  | { available: false; skipped?: boolean }
  | UpdateAvailable;

/**
 * GET {serverUrl}/latest?deviceId=<wire12hex>&mode=customer|
 * master&abi=arm64-v8a|armeabi-v7a → THAT device's {version,
 * apkUrl, allowed, mandatory} or {allowed:false} when nothing
 * is recorded. The server picks the APK URL by mode+abi.
 *
 * Returns {available:true, mandatory, apkUrl} ONLY when allowed
 * is true AND version > currentVersion. If allowed is false, or
 * version is null/missing, or version <= current, or there is no
 * APK URL → {available:false}.
 *
 * NOTE: `mandatory` is passed through from the server (default
 * 0) but the UI deliberately ignores it — every pushed update is
 * a normal optional update with [Baad me] (staged rollout,
 * 2026-11-26). There is no mandatory blocking screen.
 *
 * FAIL-OPEN on ANY error (not configured, bad deviceId, timeout,
 * network error, non-2xx, bad JSON): returns {available:false}
 * and never throws, never blocks — the app works normally offline.
 */
export async function checkLatest(
  serverUrl: string,
  deviceId: string,
  currentVersion: string,
  mode: AppMode,
  abi: string,
): Promise<UpdateCheckResult> {
  try {
    const base = String(serverUrl ?? "").trim().replace(/\/+$/, "");
    if (!base) return { available: false };
    const wire = wireDeviceId(deviceId);
    if (!wire) return { available: false };
    const serverMode = mode === "master" ? "master" : "customer";
    const serverAbi = abi === "armeabi-v7a" ? "armeabi-v7a" : "arm64-v8a";
    const query = new URLSearchParams({
      deviceId: wire,
      mode: serverMode,
      abi: serverAbi,
    });
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      LICENSE_REQUEST_TIMEOUT_MS,
    );
    let data: unknown;
    try {
      const res = await fetch(`${base}/latest?${query}`, {
        method: "GET",
        signal: controller.signal,
      });
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) return { available: false };
    } finally {
      clearTimeout(timer);
    }
    const latest = (data as LatestRelease | null) ?? null;
    if (!latest) return { available: false };
    // Ajay's rollout control: no update until he pushes the
    // staged version to all shops ("Sabko update bhejo"). Default
    // allowed=false for every new version — a missing flag means
    // NOT allowed.
    if (latest.allowed !== true) return { available: false };
    const version =
      typeof latest.version === "string" ? latest.version.trim() : "";
    if (!version) return { available: false };
    if (compareVersions(version, currentVersion) <= 0)
      return { available: false };
    const apkUrl =
      typeof latest.apkUrl === "string" ? latest.apkUrl.trim() : "";
    if (!apkUrl) return { available: false };
    return {
      available: true,
      version,
      mandatory: latest.mandatory === true,
      apkUrl,
    };
  } catch {
    // Offline, timeout, server down — never block the app.
    return { available: false };
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** True when a day has passed since the last update check. */
export function shouldCheckUpdate(now = Date.now()): boolean {
  const at = Number(storage()?.getItem(UPDATE_CHECK_KEY) ?? 0);
  return (
    !Number.isFinite(at) || at <= 0 || now - at >= UPDATE_CHECK_INTERVAL_MS
  );
}

export function markUpdateChecked(now = Date.now()): void {
  storage()?.setItem(UPDATE_CHECK_KEY, String(now));
}

export type MaybeCheckLatestArgs = {
  deviceId: string;
  currentVersion: string;
  mode: AppMode;
  abi: string;
};

/**
 * The once-a-day check: skips the network call when a check
 * already ran in the last 24 hours (the timestamp is marked on
 * every attempt, success or fail, so a down server is not
 * retried on every app open). Returns {available:false,
 * skipped:true} when skipped — the caller shows nothing.
 */
export async function maybeCheckLatest(
  args: MaybeCheckLatestArgs,
): Promise<UpdateCheckResult> {
  if (!shouldCheckUpdate()) return { available: false, skipped: true };
  try {
    return await checkLatest(
      getLicenseServerUrl(),
      args.deviceId,
      args.currentVersion,
      args.mode,
      args.abi,
    );
  } finally {
    markUpdateChecked();
  }
}

// ---------------------------------------------------------------------------
// Native bridge (Android only) — same pattern as src/lib/device.ts:
// registerPlugin("AppUpdate"), guarded by platform, web fallbacks
// that never throw. The native side is
// android/.../com/aurum/jewellery/AppUpdatePlugin.java.
// ---------------------------------------------------------------------------

const native = Capacitor.getPlatform() === "android";

const appUpdatePlugin = registerPlugin<{
  getPrimaryAbi: () => Promise<{ abi: string }>;
  canInstallPackages: () => Promise<{ canInstall: boolean }>;
  openInstallSettings: () => Promise<void>;
  installApk: (v: { fileName: string }) => Promise<{ started: boolean }>;
}>("AppUpdate");

/** This phone's primary ABI, e.g. "arm64-v8a" — "" on the web. */
export async function getPrimaryAbi(): Promise<string> {
  try {
    if (!native) return "";
    const out = await appUpdatePlugin.getPrimaryAbi();
    return typeof out?.abi === "string" ? out.abi.trim() : "";
  } catch {
    return "";
  }
}

/**
 * True when Android will let this app install an APK (the
 * "Install unknown apps" permission, API 26+). False on the web
 * and below API 26 — never throws.
 */
export async function canInstallPackages(): Promise<boolean> {
  try {
    if (!native) return false;
    const out = await appUpdatePlugin.canInstallPackages();
    return out?.canInstall === true;
  } catch {
    return false;
  }
}

/** Opens this app's "Install unknown apps" settings page. */
export async function openInstallSettings(): Promise<void> {
  try {
    if (native) await appUpdatePlugin.openInstallSettings();
  } catch {
    // Best effort — the shopkeeper can open Settings by hand.
  }
}

/**
 * Opens the system installer for the APK already saved in the
 * app cache dir. Returns true when the installer opened — the
 * shopkeeper then taps Install once; the app updates in place.
 * Never throws.
 */
export async function installApk(
  fileName = UPDATE_APK_FILENAME,
): Promise<boolean> {
  try {
    if (!native) return false;
    const out = await appUpdatePlugin.installApk({ fileName });
    return out?.started === true;
  } catch {
    return false;
  }
}

export function isAndroidApp(): boolean {
  return native;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Download the update APK and save it as aurum-update.apk in
 * the app cache dir (Directory.Cache — the FileProvider already
 * serves cache-path, so the installer can read it). Reports
 * 0–100 progress when the server sends a content-length, else
 * calls onProgress(-1) while downloading. On the web build
 * there is no cache dir the installer can read, so it falls
 * back to a plain browser download. Throws on download/write
 * failure — the caller shows a plain Hindi retry message.
 */
export async function downloadApk(
  apkUrl: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const res = await fetch(apkUrl);
  if (!res.ok)
    throw Error(`Update download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length") || 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    return writeApkBytes(buf);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress?.(total > 0 ? Math.round((received / total) * 100) : -1);
    }
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  await writeApkBytes(merged.buffer);
}

async function writeApkBytes(buf: ArrayBuffer): Promise<void> {
  if (!native) {
    // Web build: plain browser download — there is no installer
    // to hand the file to here.
    const blob = new Blob([buf], {
      type: "application/vnd.android.package-archive",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = UPDATE_APK_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  await Filesystem.writeFile({
    path: UPDATE_APK_FILENAME,
    data: arrayBufferToBase64(buf),
    directory: Directory.Cache,
  });
}
