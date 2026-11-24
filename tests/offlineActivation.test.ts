import { it, expect, describe } from "vitest";
import {
  codeForInstallId,
  keyForCode,
  keyForCodeAndDevice,
  formatDeviceId,
  normalizeDeviceId,
  getDeviceId,
  generateUnlockKey,
  verifyUnlockKey,
  verifyUnlockKeyForDevice,
  verifyKeyForInstallId,
  isOfflineLicensed,
  markOfflineLicensed,
  clearOfflineLicense,
  timingSafeEqual,
  developerWhatsAppLink,
  DEVELOPER_WHATSAPP,
  MASTER_SECRET_PLACEHOLDER,
} from "../src/lib/offlineActivation";

const SECRET = "test-master-secret-do-not-use-in-production";
const INSTALL_ID = "install-1234-abcdef";
const DEVICE_ID = "ABCD-1234-EF01";
const OTHER_DEVICE_ID = "FFFF-0000-1111";

describe("offline activation (MediSmart v2 scheme)", () => {
  it("derives an 8-character uppercase code from the install id", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    // Deterministic: same install id + secret always gives the same code.
    expect(await codeForInstallId(INSTALL_ID, SECRET)).toBe(code);
  });

  it("derives a different code for a different install id or secret", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    expect(await codeForInstallId("another-install", SECRET)).not.toBe(code);
    expect(await codeForInstallId(INSTALL_ID, "another-secret")).not.toBe(code);
  });

  it("generates a device-bound key from a code and Device ID and verifies it", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await generateUnlockKey(code, DEVICE_ID, SECRET);
    expect(key).toMatch(/^[0-9A-F]{8}$/);
    expect(key).not.toBe(code);
    expect(await verifyUnlockKeyForDevice(code, DEVICE_ID, key, SECRET)).toBe(
      true,
    );
    // The old code-only derivation still exists for the fallback.
    const legacyKey = await keyForCode(code, SECRET);
    expect(await verifyUnlockKey(code, legacyKey, SECRET)).toBe(true);
    expect(await verifyKeyForInstallId(INSTALL_ID, legacyKey, SECRET)).toBe(
      true,
    );
  });

  it("rejects a wrong key, a wrong code, or a wrong secret", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await keyForCode(code, SECRET);
    expect(await verifyUnlockKey(code, "00000000", SECRET)).toBe(false);
    expect(await verifyUnlockKey("00000000", key, SECRET)).toBe(false);
    expect(await verifyUnlockKey(code, key, "wrong-secret")).toBe(false);
  });

  it("rejects a malformed device code or Device ID when generating a key", async () => {
    await expect(
      generateUnlockKey("too-short", DEVICE_ID, SECRET),
    ).rejects.toThrow("8-character device code");
    await expect(generateUnlockKey("A1B2C3D4", "too-short", SECRET)).rejects.toThrow(
      "12-character Device ID",
    );
    await expect(
      generateUnlockKey("A1B2C3D4", "GGGG-1234-5678", SECRET),
    ).rejects.toThrow("12-character Device ID");
  });

  it("master app key unlocks the user app (two-app flow)", async () => {
    // User app: the full-screen gate shows this device's code and Device ID.
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    // Master app: the developer pastes the code and Device ID and
    // generates the key with the exact function the Master screen uses.
    const key = await generateUnlockKey(code, DEVICE_ID, SECRET);
    // User app: the key verifies against the same code and Device ID.
    expect(await verifyUnlockKeyForDevice(code, DEVICE_ID, key, SECRET)).toBe(
      true,
    );
    // The same key does NOT unlock a different device's code.
    const otherCode = await codeForInstallId("another-install", SECRET);
    expect(
      await verifyUnlockKeyForDevice(otherCode, DEVICE_ID, key, SECRET),
    ).toBe(false);
    // …or the same code on a different phone (different Device ID).
    expect(
      await verifyUnlockKeyForDevice(code, OTHER_DEVICE_ID, key, SECRET),
    ).toBe(false);
  });

  it("licensed flag helpers are safe without browser storage", () => {
    expect(isOfflineLicensed()).toBe(false);
    expect(() => markOfflineLicensed()).not.toThrow();
    expect(() => clearOfflineLicense()).not.toThrow();
  });

  it("compares keys in a timing-safe way", () => {
    expect(timingSafeEqual("ABCDEFGH", "ABCDEFGH")).toBe(true);
    expect(timingSafeEqual("ABCDEFGH", "ABCDEFGX")).toBe(false);
    expect(timingSafeEqual("ABCDEFGH", "ABC")).toBe(false);
  });

  it("sends the code to the developer's confirmed WhatsApp number", () => {
    expect(DEVELOPER_WHATSAPP).toBe("916263396446");
    const link = developerWhatsAppLink("A1B2C3D4");
    expect(link).toBe(
      "https://wa.me/916263396446?text=" +
        encodeURIComponent(
          "Namaste, Aurum activation code: A1B2C3D4. Please send the unlock key.",
        ),
    );
    // With a Device ID the link carries both, so the shopkeeper can
    // send code + Device ID in one tap (or screenshot the lock screen).
    const withDevice = developerWhatsAppLink("A1B2C3D4", DEVICE_ID);
    expect(withDevice).toBe(
      "https://wa.me/916263396446?text=" +
        encodeURIComponent(
          "Namaste, Aurum activation code: A1B2C3D4. Device ID: ABCD-1234-EF01. Please send the unlock key.",
        ),
    );
    // The master secret is Ajay's chosen short secret ("Musebhai"),
    // kept in git by his choice — a short public secret means the
    // lock is light, not a real secret.
    expect(MASTER_SECRET_PLACEHOLDER).toBe("Musebhai");
  });
});

describe("device ID lock", () => {
  it("formats a Device ID as 12 hex chars in XXXX-XXXX-XXXX groups", () => {
    expect(formatDeviceId("0123456789ab" + "c".repeat(52))).toBe(
      "0123-4567-89AB",
    );
    expect(formatDeviceId("abcdef1234567890")).toBe("ABCD-EF12-3456");
    // Lowercase input is uppercased; only the first 12 hex chars count.
    expect(formatDeviceId("a1b2c3d4e5f6a1b2")).toBe("A1B2-C3D4-E5F6");
  });

  it("normalises a typed Device ID (dashes/spaces ignored, case-insensitive)", () => {
    expect(normalizeDeviceId("abcd-1234-ef01")).toBe("ABCD1234EF01");
    expect(normalizeDeviceId(" ABCD 1234 EF01 ")).toBe("ABCD1234EF01");
    expect(normalizeDeviceId("ABCD1234EF01")).toBe("ABCD1234EF01");
    expect(() => normalizeDeviceId("too-short")).toThrow(
      "12-character Device ID",
    );
    expect(() => normalizeDeviceId("GGGG-1234-5678")).toThrow(
      "12-character Device ID",
    );
  });

  it("derives a different key when the Device ID differs", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await keyForCodeAndDevice(code, DEVICE_ID, SECRET);
    const other = await keyForCodeAndDevice(code, OTHER_DEVICE_ID, SECRET);
    expect(other).not.toBe(key);
    // And a device-bound key differs from the old code-only key.
    expect(await keyForCode(code, SECRET)).not.toBe(key);
  });

  it("verifies a device-bound key, and fails on a wrong Device ID", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await keyForCodeAndDevice(code, DEVICE_ID, SECRET);
    expect(await verifyUnlockKeyForDevice(code, DEVICE_ID, key, SECRET)).toBe(
      true,
    );
    expect(
      await verifyUnlockKeyForDevice(code, OTHER_DEVICE_ID, key, SECRET),
    ).toBe(false);
    expect(
      await verifyUnlockKeyForDevice(code, DEVICE_ID, "00000000", SECRET),
    ).toBe(false);
    const otherCode = await codeForInstallId("another-install", SECRET);
    expect(
      await verifyUnlockKeyForDevice(otherCode, DEVICE_ID, key, SECRET),
    ).toBe(false);
  });

  it("still accepts an old code-only key via the fallback", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    // Key generated before the Device ID lock (code only).
    const legacyKey = await keyForCode(code, SECRET);
    expect(await verifyUnlockKeyForDevice(code, DEVICE_ID, legacyKey, SECRET)).toBe(
      true,
    );
    // …but a code-only key for a different code still fails.
    const otherCode = await codeForInstallId("another-install", SECRET);
    const otherLegacy = await keyForCode(otherCode, SECRET);
    expect(
      await verifyUnlockKeyForDevice(code, DEVICE_ID, otherLegacy, SECRET),
    ).toBe(false);
  });

  it("returns a stable, well-formed Device ID across calls", async () => {
    const first = await getDeviceId();
    const second = await getDeviceId();
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });
});
