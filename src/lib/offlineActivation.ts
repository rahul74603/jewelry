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

/** Unlock key the developer generates from a device code. */
export async function keyForCode(code: string, secret: string): Promise<string> {
  const digest = await sha256Hex(`${code.toUpperCase().trim()}|${secret}|KEY`);
  return digest.slice(0, 8).toUpperCase();
}

/** Master tool: generate the unlock key for a shopkeeper's device code. */
export async function generateUnlockKey(
  deviceCode: string,
  secret: string,
): Promise<string> {
  const code = deviceCode.toUpperCase().trim();
  if (!/^[0-9A-F]{8}$/.test(code))
    throw Error("Enter the 8-character device code from the shopkeeper.");
  return keyForCode(code, secret);
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

/** wa.me link that opens WhatsApp to the developer with the code prefilled. */
export function developerWhatsAppLink(deviceCode: string): string {
  const text = `Namaste, Aurum activation code: ${deviceCode}. Please send the unlock key.`;
  return `https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent(text)}`;
}
