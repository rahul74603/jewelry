/**
 * Offline activation, MediSmart v2 scheme adapted for Aurum.
 *
 * MediSmart v2 (lib/services/license_service.dart) uses a per-install
 * UUID stored in SharedPreferences — NOT a MAC address (Android MACs
 * are randomised and unreliable, and MediSmart v2 does not use one).
 * A reinstall / cleared storage means a new install id and a fresh
 * activation, exactly like MediSmart.
 *
 *   code = SHA256(installId | salt | CODE)  — first 8 chars, uppercase
 *   key  = SHA256(code      | salt | KEY)   — first 8 chars, uppercase
 *
 * Device ID lock (added 2026-11-24): the key is now bound to a short
 * human-readable Device ID as well as the code, so a key generated for
 * one phone cannot unlock another:
 *
 *   deviceId = first 12 hex of SHA-256(device public key), shown as
 *              XXXX-XXXX-XXXX — from the hardware-backed Keystore
 *              P-256 key on Android (see src/lib/device.ts
 *              `deviceIdentity`), falling back to a hash of the
 *              install id when the keystore is unavailable. The
 *              Device ID is shown on the lock screen next to the code,
 *              so the shopkeeper can screenshot both and the developer
 *              enters both in the master tool.
 *   key  = SHA256(code | deviceId | salt | KEY) — first 8 chars, upper
 *
 * Verification tries the device-bound key FIRST, then falls back to
 * the old code-only key, so keys generated before this change still
 * unlock their device. New keys are always device-bound.
 *
 * Flow: first launch on a new device shows the device code; the
 * shopkeeper taps "Send this code to developer" (WhatsApp to the
 * developer's number); the developer pastes the code into the master
 * tool (Company console → "Offline unlock" tab), generates the key
 * and sends it back; the shopkeeper enters the key and the app unlocks
 * locally (licensed flag in localStorage).
 *
 * The offline key marks THIS device licensed LOCALLY only. It does
 * NOT grant the live server workspace — live billing still needs
 * internet verification (src/Live.tsx LicensedShop).
 *
 * SECURITY: the master secret (salt) must be a long random value held
 * by the developer only (developer machine / password manager, never
 * in git). The same salt must be in both the local app build and the
 * master build, or codes and keys will not match. The placeholder
 * below MUST be replaced before distribution. MediSmart's own salt
 * was deliberately NOT copied here.
 */
import { sha256Hex } from "./backup";
import { deviceIdentity } from "./device";

/** Developer's WhatsApp number, confirmed by Ajay (+91 6263396446). */
export const DEVELOPER_WHATSAPP = "916263396446" as const;

/** Replace with the real master secret before distribution. Never commit it. */
export const MASTER_SECRET_PLACEHOLDER = "Musebhai" as const;

const INSTALL_ID_KEY = "aurum:install-id";
const LICENSED_KEY = "aurum:offline-licensed";

function randomInstallId(): string {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto &&
    typeof crypto.randomUUID === "function"
  )
    return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The per-install id. Prefers Aurum's existing device fingerprint
 * (SHA-256 of the P-256 public key — Android Keystore on device,
 * IndexedDB in the browser; see src/lib/device.ts `deviceIdentity`)
 * when a signed-in uid is available; otherwise a locally stored UUID
 * that survives app restarts but not a reinstall / data clear.
 */
export async function getInstallId(uid?: string): Promise<string> {
  if (uid) {
    try {
      const key = await deviceIdentity(uid);
      if (key.deviceId) return key.deviceId;
    } catch {
      // Fall through to the stored UUID — offline activation must
      // still work when the hardware keystore is unavailable.
    }
  }
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(INSTALL_ID_KEY);
      if (stored) return stored;
      const fresh = randomInstallId();
      localStorage.setItem(INSTALL_ID_KEY, fresh);
      return fresh;
    }
  } catch {
    // Storage unavailable: return an in-memory id for this session.
  }
  return randomInstallId();
}

/** Device code shown on the shopkeeper's screen. */
export async function codeForInstallId(
  installId: string,
  secret: string,
): Promise<string> {
  const digest = await sha256Hex(`${installId}|${secret}|CODE`);
  return digest.slice(0, 8).toUpperCase();
}

/**
 * Fixed slot for the activation device identity — no sign-in/uid is
 * needed, so the Device ID is available on the first-launch lock
 * screen. The same constant is used on every device, so each device
 * still gets its own key (the slot only names the key; the Keystore /
 * IndexedDB key itself is per device).
 */
export const ACTIVATION_SLOT_UID = "aurum-activation-v1" as const;

/** Short human-readable Device ID from a full hex hash: XXXX-XXXX-XXXX. */
export function formatDeviceId(hash: string): string {
  const hex = hash.replace(/[^0-9A-Fa-f]/g, "").slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Normalise a Device ID typed by the developer: dashes/spaces ignored,
 * case-insensitive. Returns the 12 ungrouped hex chars; throws when it
 * is not exactly 12 hex characters.
 */
export function normalizeDeviceId(input: string): string {
  const hex = input.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex))
    throw Error(
      "Enter the 12-character Device ID from the shopkeeper (XXXX-XXXX-XXXX).",
    );
  return hex;
}

/** Cached Device ID for this session — the Keystore identity is stable
 * per device, so it is computed once and reused. */
let cachedDeviceId: Promise<string> | null = null;

/**
 * This phone's Device ID, screenshot-friendly (XXXX-XXXX-XXXX).
 *
 * Prefers the hardware-backed device fingerprint (Android Keystore
 * P-256 public key — the private key never leaves the keystore, so
 * the Device ID cannot be copied to another phone). Falls back to a
 * hash of the install id when the keystore is unavailable, so
 * activation never breaks. Stable across app restarts; a reinstall
 * gets a new Device ID (the Keystore key is deleted on uninstall),
 * exactly like the install id today.
 */
export function getDeviceId(): Promise<string> {
  if (!cachedDeviceId)
    cachedDeviceId = (async () => {
      try {
        const key = await deviceIdentity(ACTIVATION_SLOT_UID);
        if (key.deviceId) return formatDeviceId(key.deviceId);
      } catch {
        // Fall through to the install-id hash — offline activation
        // must still work when the hardware keystore is unavailable.
      }
      const digest = await sha256Hex(await getInstallId());
      return formatDeviceId(digest);
    })();
  return cachedDeviceId;
}

/** Unlock key the developer generates from a device code. */
export async function keyForCode(code: string, secret: string): Promise<string> {
  const digest = await sha256Hex(`${code.toUpperCase().trim()}|${secret}|KEY`);
  return digest.slice(0, 8).toUpperCase();
}

/**
 * Device-bound unlock key: the same code on a different phone gives a
 * different key, because the Device ID is part of the derivation.
 */
export async function keyForCodeAndDevice(
  code: string,
  deviceId: string,
  secret: string,
): Promise<string> {
  const device = normalizeDeviceId(deviceId);
  const digest = await sha256Hex(
    `${code.toUpperCase().trim()}|${device}|${secret}|KEY`,
  );
  return digest.slice(0, 8).toUpperCase();
}

/**
 * Master tool: generate the unlock key for a shopkeeper's device code
 * AND Device ID. The key only unlocks the phone with that Device ID.
 */
export async function generateUnlockKey(
  deviceCode: string,
  deviceId: string,
  secret: string,
): Promise<string> {
  const code = deviceCode.toUpperCase().trim();
  if (!/^[0-9A-F]{8}$/.test(code))
    throw Error("Enter the 8-character device code from the shopkeeper.");
  return keyForCodeAndDevice(code, deviceId, secret);
}

/** Timing-safe comparison: always compares every character. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when `key` is the unlock key for `code` under `secret`. */
export async function verifyUnlockKey(
  code: string,
  key: string,
  secret: string,
): Promise<boolean> {
  const expected = await keyForCode(code, secret);
  return timingSafeEqual(expected, key.toUpperCase().trim());
}

/**
 * True when `key` unlocks the phone with this `code` and `deviceId`.
 * Tries the device-bound key first, then falls back to the old
 * code-only key — so keys generated before the Device ID lock still
 * unlock their device, while new keys only work on that one phone.
 */
export async function verifyUnlockKeyForDevice(
  code: string,
  deviceId: string,
  key: string,
  secret: string,
): Promise<boolean> {
  const entered = key.toUpperCase().trim();
  try {
    const expected = await keyForCodeAndDevice(code, deviceId, secret);
    if (timingSafeEqual(expected, entered)) return true;
  } catch {
    // Malformed Device ID: the device-bound check cannot pass; the
    // code-only fallback below still decides.
  }
  return verifyUnlockKey(code, entered, secret);
}

/** Convenience: verify a key against this device's own code. */
export async function verifyKeyForInstallId(
  installId: string,
  key: string,
  secret: string,
): Promise<boolean> {
  const code = await codeForInstallId(installId, secret);
  return verifyUnlockKey(code, key, secret);
}

export function isOfflineLicensed(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(LICENSED_KEY) === "1"
    );
  } catch {
    return false;
  }
}

export function markOfflineLicensed(): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(LICENSED_KEY, "1");
  } catch {
    // Flag cannot persist; the shopkeeper will need the key again.
  }
}

export function clearOfflineLicense(): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.removeItem(LICENSED_KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * wa.me link that opens WhatsApp to the developer with the code and
 * Device ID prefilled, so the shopkeeper can send both in one tap
 * (or screenshot the lock screen and send that instead).
 */
export function developerWhatsAppLink(
  deviceCode: string,
  deviceId?: string,
  model?: string,
): string {
  const parts = [`Namaste, Aurum activation code: ${deviceCode}.`];
  if (deviceId) parts.push(`Device ID: ${deviceId}.`);
  // Phone model is a signal only (per-model, not per-phone) — it is
  // never part of the key math. Appended only when known.
  if (model?.trim()) parts.push(`Phone model: ${model.trim()}.`);
  parts.push("Please send the unlock key.");
  return `https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent(parts.join(" "))}`;
}
