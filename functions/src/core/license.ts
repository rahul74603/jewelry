export type LicenseStatus =
  "Pending" | "Active" | "Suspended" | "Blocked" | "Revoked";
export type License = {
  id: string;
  tenantId: string;
  ownerUid: string;
  plan: string;
  deviceLimit: number;
  activeCount: number;
  status: LicenseStatus;
  expiresAt: number | null;
  createdAt: number;
};
export type Device = {
  id: string;
  licenseId: string;
  tenantId: string;
  uid: string;
  publicKey: string;
  platform: string;
  status: "Active" | "Revoked";
  createdAt: number;
  lastVerified: number;
};
export type Token = {
  tenantId: string;
  licenseId: string;
  expiresAt: number;
  usedAt: number | null;
};
export function assertLicense(
  l: License | undefined,
  tenantId: string,
  uid: string,
  now: number,
  activating = false,
) {
  if (!l || l.tenantId !== tenantId || l.ownerUid !== uid)
    throw Error("License does not belong to this account.");
  if (l.status !== "Active" && !(activating && l.status === "Pending"))
    throw Error(`License ${l.status.toLowerCase()}.`);
  if (l.expiresAt !== null && l.expiresAt <= now)
    throw Error("License expired.");
}
export function assertActivation(
  t: Token | undefined,
  l: License,
  now: number,
  alreadyRegistered: boolean,
) {
  if (!t || t.tenantId !== l.tenantId || t.licenseId !== l.id)
    throw Error("Invalid activation code.");
  if (t.usedAt !== null) throw Error("Activation code already used.");
  if (t.expiresAt <= now) throw Error("Activation code expired.");
  if (alreadyRegistered)
    throw Error(
      "Device key already registered. Generate a new key for a replacement.",
    );
  if (l.activeCount >= l.deviceLimit) throw Error("Device limit reached.");
}
export function assertDevice(d: Device | undefined, l: License, uid: string) {
  if (
    !d ||
    d.status !== "Active" ||
    d.licenseId !== l.id ||
    d.tenantId !== l.tenantId ||
    d.uid !== uid
  )
    throw Error("Device is not authorized for this license.");
}
