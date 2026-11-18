import { Capacitor, registerPlugin } from "@capacitor/core";
const native = Capacitor.getPlatform() === "android";
const vault = registerPlugin<{
  publicKey: (v: { slot: string }) => Promise<{ publicKey: string }>;
  sign: (v: {
    slot: string;
    message: string;
  }) => Promise<{ signature: string }>;
  printInvoice: () => Promise<void>;
  shareText: (v: { text: string }) => Promise<void>;
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
export async function printDocument() {
  if (native) await vault.printInvoice();
  else window.print();
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
