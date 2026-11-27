import { Capacitor } from "@capacitor/core";
import type { UpdateAvailable } from "./appUpdate";

/**
 * Persistent Android system notification for a pending app update
 * ("notification bar", v1.0.54 — Ajay, 2026-11-27).
 *
 * Ajay's rule: "agar app purani hai to registered hote hi uski
 * notification bar me update your app likha ana chahiye jab tak
 * wo latest version par nahi aa jaye" — the notice must appear as
 * soon as the app registers and STAY in the notification shade
 * until the app is on the latest version. The in-app banner alone
 * was not enough: a phone that had already checked that day never
 * re-checked, so the banner never came back.
 *
 * How it works: when an update is available, the app posts one
 * ONGOING local notification (it cannot be swiped away) with a
 * fixed id — re-posting with the same id refreshes it, and the
 * app cancels it the moment a check confirms the phone is on the
 * latest version. Tapping it opens the app (the plugin's default
 * tap action), where the banner offers the one-tap update.
 *
 * Android 13+ needs the POST_NOTIFICATIONS runtime permission:
 * the app asks for it ONLY at the moment an update is found, and
 * only after a one-line plain-Hindi explanation in the banner
 * itself (the [Notification on karo] button). If the shopkeeper
 * denies, the in-app banner is still the fallback — never a
 * crash, never a block.
 *
 * ALL calls are guarded to no-op on the web (isNativeAndroid) so
 * the GitHub Pages web demo keeps working — and the plugin itself
 * is loaded with a dynamic import, so the web bundle never even
 * loads the native plugin code. Every function never throws.
 */

/** Stable id for the one update notice — re-posting refreshes it. */
export const UPDATE_NOTIFICATION_ID = 9101;

export type UpdateNotifyState =
  | "posted"
  | "needs-permission"
  | "denied"
  | "web"
  | "unavailable";

/**
 * True on the Android app. Read live on every call (not cached at
 * import) — Capacitor.getPlatform() is stable at runtime, and a
 * live read lets tests drive both branches by stubbing it.
 */
function isNativeAndroid(): boolean {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

/** Load the plugin lazily so the web build never touches native code. */
async function loadNotifications() {
  const mod = await import("@capacitor/local-notifications");
  return mod.LocalNotifications;
}

/**
 * Current display permission: "granted" | "denied" | "prompt"
 * ("prompt" also covers "prompt-with-rationale" — either way the
 * app may still ask). "denied" on the web / on any error.
 */
export async function getUpdateNotificationPermission(): Promise<
  "granted" | "denied" | "prompt"
> {
  if (!isNativeAndroid()) return "denied";
  try {
    const ln = await loadNotifications();
    const r = await ln.checkPermissions();
    if (r.display === "granted") return "granted";
    if (r.display === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
  }
}

/**
 * Ask the system for the notification permission (Android 13+).
 * Call ONLY from the in-app explanation button — never on app
 * launch, never without the one-line Hindi explanation first.
 * True when granted afterwards. Never throws.
 */
export async function requestUpdateNotificationPermission(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const ln = await loadNotifications();
    const r = await ln.requestPermissions();
    return r.display === "granted";
  } catch {
    return false;
  }
}

/**
 * Post (or refresh) the persistent update notice. Returns true
 * when the notification is up. False when not on Android, when
 * the permission is not granted, or on any error — never throws.
 */
export async function showUpdateNotification(
  version: string,
): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const ln = await loadNotifications();
    const perm = await ln.checkPermissions();
    if (perm.display !== "granted") return false;
    return await postNotification(ln, version);
  } catch {
    return false;
  }
}

/** Schedule the ongoing notice with the loaded plugin. Never throws. */
async function postNotification(
  ln: Awaited<ReturnType<typeof loadNotifications>>,
  version: string,
): Promise<boolean> {
  try {
    await ln.schedule({
      notifications: [
        {
          id: UPDATE_NOTIFICATION_ID,
          title: `Aurum ${version} aaya hai — Update karo`,
          body: `Naya version ${version} aaya hai. App kholo aur Update karo — aapka data safe rahega.`,
          // Ongoing: the shopkeeper cannot swipe it away — it stays
          // in the shade until the app is on the latest version and
          // cancelUpdateNotification() removes it. Tapping it opens
          // the app (default tap action); autoCancel is false so the
          // tap does not dismiss it either — only an update does.
          ongoing: true,
          autoCancel: false,
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove the update notice — called the moment a check confirms
 * the phone is on the latest version. Best-effort, never throws,
 * no-op on the web.
 */
export async function cancelUpdateNotification(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    const ln = await loadNotifications();
    await ln.cancel({ notifications: [{ id: UPDATE_NOTIFICATION_ID }] });
  } catch {
    // Already gone — the phone is on the latest version either way.
  }
}

/**
 * Sync the notification shade with the latest update-check
 * result. Call on every check where the result is known:
 *
 * - update available + permission granted → post/refresh the
 *   notice, return "posted".
 * - update available + permission not asked yet → return
 *   "needs-permission" (the caller shows the one-line Hindi
 *   explanation + [Notification on karo] in the banner; the
 *   notice is posted when the shopkeeper taps it).
 * - update available + permission denied → "denied" (the in-app
 *   banner is the fallback; never nag).
 * - no update (null) → cancel any standing notice, "unavailable".
 * - not on Android → "web" (nothing to do).
 *
 * Never throws.
 */
export async function syncUpdateNotification(
  update: UpdateAvailable | null,
): Promise<UpdateNotifyState> {
  if (!isNativeAndroid()) return "web";
  if (!update) {
    await cancelUpdateNotification();
    return "unavailable";
  }
  try {
    const ln = await loadNotifications();
    const perm = await ln.checkPermissions();
    if (perm.display === "granted") {
      const posted = await postNotification(ln, update.version);
      return posted ? "posted" : "unavailable";
    }
    if (perm.display === "denied") return "denied";
    return "needs-permission";
  } catch {
    return "unavailable";
  }
}
