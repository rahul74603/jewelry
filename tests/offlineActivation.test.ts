import { it, expect, describe } from "vitest";
import {
  codeForInstallId,
  keyForCode,
  generateUnlockKey,
  verifyUnlockKey,
  verifyKeyForInstallId,
  timingSafeEqual,
  developerWhatsAppLink,
  DEVELOPER_WHATSAPP,
  MASTER_SECRET_PLACEHOLDER,
} from "../src/lib/offlineActivation";

const SECRET = "test-master-secret-do-not-use-in-production";
const INSTALL_ID = "install-1234-abcdef";

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

  it("generates a key from a code and verifies it", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await generateUnlockKey(code, SECRET);
    expect(key).toMatch(/^[0-9A-F]{8}$/);
    expect(key).not.toBe(code);
    expect(await verifyUnlockKey(code, key, SECRET)).toBe(true);
    expect(await verifyKeyForInstallId(INSTALL_ID, key, SECRET)).toBe(true);
  });

  it("rejects a wrong key, a wrong code, or a wrong secret", async () => {
    const code = await codeForInstallId(INSTALL_ID, SECRET);
    const key = await keyForCode(code, SECRET);
    expect(await verifyUnlockKey(code, "00000000", SECRET)).toBe(false);
    expect(await verifyUnlockKey("00000000", key, SECRET)).toBe(false);
    expect(await verifyUnlockKey(code, key, "wrong-secret")).toBe(false);
  });

  it("rejects a malformed device code when generating a key", async () => {
    await expect(generateUnlockKey("too-short", SECRET)).rejects.toThrow(
      "8-character device code",
    );
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
    // The master secret is a placeholder, never a real secret in git.
    expect(MASTER_SECRET_PLACEHOLDER).toBe("CHANGE-ME-BEFORE-DISTRIBUTION");
  });
});
