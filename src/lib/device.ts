import { rollContent } from "./roll";
import type { Profile } from "../../functions/src/core/model";
import { Capacitor, registerPlugin } from "@capacitor/core";
const native = Capacitor.getPlatform() === "android";
const vault = registerPlugin<{
  publicKey: (v: { slot: string }) => Promise<{ publicKey: string }>;
  sign: (v: {
    slot: string;
    message: string;
  }) => Promise<{ signature: string }>;
  printInvoice: (options: {
    format: Profile["format"];
    documentNumber: string;
  }) => Promise<void>;
  saveRollPdf: (
    options: ReturnType<typeof rollContent> & {
      format: string;
      documentNumber: string;
    },
  ) => Promise<{ saved: boolean }>;
  shareText: (v: { text: string }) => Promise<void>;
  model: () => Promise<{ model: string }>;
}>("DeviceVault");
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
export const hash = async (b: BufferSource) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
async function browserKey(slot: string): Promise<CryptoKeyPair> {
  const db = await new Promise<IDBDatabase>((ok, fail) => {
    const r = indexedDB.open("aurum-device-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  try {
    const get = () =>
      new Promise<CryptoKeyPair | undefined>((ok, fail) => {
        const r = db.transaction("keys").objectStore("keys").get(slot);
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      });
    const known = await get();
    if (known) return known;
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    await new Promise<void>((ok, fail) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").add(pair, slot);
      tx.oncomplete = () => ok();
      tx.onabort = () => fail(tx.error);
    }).catch(async (e) => {
      if (!(await get())) throw e;
    });
    return (await get())!;
  } finally {
    db.close();
  }
}
export async function deviceIdentity(uid: string) {
  const slot = await hash(new TextEncoder().encode(uid));
  const pair = native ? null : await browserKey(slot);
  const publicKey = native
    ? (await vault.publicKey({ slot })).publicKey
    : b64(await crypto.subtle.exportKey("spki", pair!.publicKey));
  const deviceId = await hash(
    Uint8Array.from(atob(publicKey), (x) => x.charCodeAt(0)),
  );
  return {
    publicKey,
    deviceId,
    platform: native ? "Android" : "Browser",
    encoding: native ? "der" : "ieee-p1363",
    sign: async (message: string) =>
      native
        ? (await vault.sign({ slot, message })).signature
        : b64(
            await crypto.subtle.sign(
              { name: "ECDSA", hash: "SHA-256" },
              pair!.privateKey,
              new TextEncoder().encode(message),
            ),
          ),
  };
}
export async function printDocument(
  format: Profile["format"],
  documentNumber: string,
) {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.querySelectorAll<HTMLImageElement>(".receipt img")).map(
      (img) => img.decode(),
    ),
  );
  if (native) await vault.printInvoice({ format, documentNumber });
  else window.print();
}

/**
 * Best-effort phone model name from a browser user agent, e.g.
 * "Infinix X6815D" from "... (Linux; Android 13; Infinix X6815D) ...".
 * Returns "" when no model can be read — desktop UAs have none, and
 * that is fine. Never throws. The model is per-model, NOT per-phone,
 * so it is only a signal for the issued-keys register, never part of
 * the unlock-key math.
 */
export function parseDeviceModelFromUserAgent(userAgent: string): string {
  try {
    if (!userAgent) return "";
    const android = userAgent.match(/\bAndroid\s+[^;]*;\s*([^;)]+)/i);
    if (android) {
      const model = android[1].trim();
      if (model && !/^(mobile|tablet)$/i.test(model)) return model;
      return "";
    }
    if (/\biPhone\b/i.test(userAgent)) return "iPhone";
    if (/\biPad\b/i.test(userAgent)) return "iPad";
    return "";
  } catch {
    return "";
  }
}

/**
 * This phone's model name. On Android it comes from the native
 * DeviceVault plugin (android.os.Build.MODEL); on the web it falls
 * back to parsing navigator.userAgent, which may return "". Never
 * throws — a missing model must never block the lock screen.
 */
export async function getDeviceModel(): Promise<string> {
  try {
    if (native) {
      const out = await vault.model();
      return typeof out?.model === "string" ? out.model.trim() : "";
    }
    if (typeof navigator !== "undefined")
      return parseDeviceModelFromUserAgent(navigator.userAgent || "");
    return "";
  } catch {
    return "";
  }
}

export async function shareSummary(title: string, text: string) {
  if (native) {
    await vault.shareText({ text });
    return "shared";
  }
  if (navigator.share) {
    await navigator.share({ title, text });
    return "shared";
  }
  await navigator.clipboard.writeText(text);
  return "copied";
}

export const nativeRollExport = native;
export async function saveRollPdf(
  format: Profile["format"],
  documentNumber: string,
) {
  const receipt = document.querySelector<HTMLElement>(".receipt");
  if (!receipt || !native || !format.endsWith("mm"))
    throw Error("No roll receipt selected.");
  return vault.saveRollPdf({ format, documentNumber, ...rollContent(receipt) });
}
