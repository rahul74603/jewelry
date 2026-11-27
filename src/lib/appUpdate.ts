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
 * before, fully offline.
 *
 * v1.0.54 (Ajay, 2026-11-27): NO once-a-day cache any more. The
 * check runs on EVERY app open and on the license heartbeat's
 * 5-minute tick while the app stays open — the update notice
 * must appear as soon as the app registers and stay until the
 * app is on the latest version. The old "check at most once a
 * day" rule is what hid the notice after a reinstall, so it is
 * gone: a failed check still fails open (no banner, no crash),
 * but a successful check is never skipped.
 *
 * The FIRST release-signed build (1.0.45) still needs ONE
 * uninstall per phone: today's installs use a disposable debug
 * key, so the signature changes. From 1.0.45 onward each phone's
 * own release key signs every build and this updater takes over.
 */

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
  | { available: false; skipped?: boolean; checked?: boolean }
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
 * APK URL → {available:false, checked:true}: the server answered,
 * so the caller knows the phone is DEFINITELY on the latest
 * version (or has no update offered) and may clear any standing
 * update notice. A network error, timeout, non-2xx or bad JSON →
 * {available:false} with NO `checked` flag: the check failed, so
 * the caller must leave any standing notice alone (fail-open).
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
    // NOT allowed. The server answered, so `checked` is set: the
    // caller may clear a standing update notice.
    if (latest.allowed !== true) return { available: false, checked: true };
    const version =
      typeof latest.version === "string" ? latest.version.trim() : "";
    if (!version) return { available: false, checked: true };
    if (compareVersions(version, currentVersion) <= 0)
      return { available: false, checked: true };
    const apkUrl =
      typeof latest.apkUrl === "string" ? latest.apkUrl.trim() : "";
    if (!apkUrl) return { available: false, checked: true };
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

export type MaybeCheckLatestArgs = {
  deviceId: string;
  currentVersion: string;
  mode: AppMode;
  abi: string;
};

/**
 * The update check (v1.0.54): EVERY call hits the server — there
 * is no once-a-day cache any more. Ajay's rule: the notice must
 * appear as soon as the app registers and stay until the app is
 * on the latest version, so a check is never skipped. Callers run
 * this on every app open and on the license heartbeat's 5-minute
 * tick. A failed check fails open ({available:false}, no `checked`
 * flag) and never throws.
 */
export async function maybeCheckLatest(
  args: MaybeCheckLatestArgs,
): Promise<UpdateCheckResult> {
  return checkLatest(
    getLicenseServerUrl(),
    args.deviceId,
    args.currentVersion,
    args.mode,
    args.abi,
  );
}

// ---------------------------------------------------------------------------
// Native bridge (Android only) — same pattern as src/lib/device.ts:
// registerPlugin("AppUpdate"), guarded by platform, web fallbacks
// that never throw. The native side is
// android/.../com/aurum/jewellery/AppUpdatePlugin.java.
// ---------------------------------------------------------------------------

/**
 * True on the Android app. Read live on every call (not cached at
 * import) — Capacitor.getPlatform() is stable at runtime, and a
 * live read lets tests drive both branches by stubbing it.
 */
function isNative(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

const appUpdatePlugin = registerPlugin<{
  getPrimaryAbi: () => Promise<{ abi: string }>;
  canInstallPackages: () => Promise<{ canInstall: boolean }>;
  openInstallSettings: () => Promise<void>;
  installApk: (v: { fileName: string }) => Promise<{ started: boolean }>;
}>("AppUpdate");

/** This phone's primary ABI, e.g. "arm64-v8a" — "" on the web. */
export async function getPrimaryAbi(): Promise<string> {
  try {
    if (!isNative()) return "";
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
    if (!isNative()) return false;
    const out = await appUpdatePlugin.canInstallPackages();
    return out?.canInstall === true;
  } catch {
    return false;
  }
}

/** Opens this app's "Install unknown apps" settings page. */
export async function openInstallSettings(): Promise<void> {
  try {
    if (isNative()) await appUpdatePlugin.openInstallSettings();
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
    if (!isNative()) return false;
    const out = await appUpdatePlugin.installApk({ fileName });
    return out?.started === true;
  } catch {
    return false;
  }
}

export function isAndroidApp(): boolean {
  return isNative();
}

/**
 * Download the update APK and save it as aurum-update.apk in
 * the app cache dir (Directory.Cache — the FileProvider already
 * serves cache-path, so the installer can read it).
 *
 * Native (Android): Capacitor Filesystem.downloadFile — a NATIVE
 * HttpURLConnection download, NOT a WebView fetch(). GitHub
 * release downloads send no Access-Control-Allow-Origin header,
 * so a WebView fetch() of the APK is blocked by CORS (the 1.0.51
 * failure: banner up, download dead, "internet check karo" on a
 * phone with working 5G). The native download is not subject to
 * CORS and follows the github.com 302 to the release asset. It
 * streams straight to the cache file, so a 4 MB APK never sits in
 * JS memory as base64.
 *
 * Web build: a plain anchor download straight to apkUrl — no
 * fetch of the bytes (same CORS problem). The browser saves the
 * APK; there is no installer to open here.
 *
 * Reports 0–100 progress when the total size is known, else -1
 * while downloading. Throws on download failure — the caller
 * shows a plain Hindi retry message.
 *
 * NOTE: Filesystem.downloadFile is deprecated in @capacitor/
 * filesystem 7.1 (it points at @capacitor/file-transfer as the
 * successor) but is present and working in the installed 7.1.9;
 * moving to file-transfer is a later, separate change.
 */
export async function downloadApk(
  apkUrl: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (isNative()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    let progressHandle: { remove: () => Promise<void> } | undefined;
    try {
      progressHandle = await Filesystem.addListener("progress", (status) => {
        const total = Number(status?.contentLength ?? 0);
        onProgress?.(
          total > 0
            ? Math.round((Number(status?.bytes ?? 0) / total) * 100)
            : -1,
        );
      });
    } catch {
      // Progress is best-effort; the download still runs without it.
    }
    try {
      await Filesystem.downloadFile({
        url: apkUrl,
        path: UPDATE_APK_FILENAME,
        directory: Directory.Cache,
        progress: true,
      });
    } finally {
      try {
        await progressHandle?.remove();
      } catch {
        // Listener already gone — nothing to clean up.
      }
    }
    return;
  }
  // Web build: plain browser download of the APK URL itself.
  const a = document.createElement("a");
  a.href = apkUrl;
  a.download = UPDATE_APK_FILENAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
