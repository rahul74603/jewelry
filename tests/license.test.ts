import { it, expect, describe } from "vitest";
import {
  assertActivation,
  assertDevice,
  assertLicense,
  type License,
  type Device,
  type Token,
} from "../functions/src/core/license";
const l: License = {
  id: "license",
  tenantId: "tenant-a",
  ownerUid: "owner-a",
  plan: "Basic",
  deviceLimit: 1,
  activeCount: 0,
  status: "Active",
  expiresAt: 2000,
  createdAt: 0,
};
const token: Token = {
  licenseId: l.id,
  tenantId: l.tenantId,
  expiresAt: 1900,
  usedAt: null,
};
const d: Device = {
  id: "public-fingerprint",
  licenseId: l.id,
  uid: l.ownerUid,
  tenantId: l.tenantId,
  status: "Active",
  platform: "Android",
  publicKey: "public",
  createdAt: 0,
  lastVerified: 0,
};
describe("Server-side license policy", () => {
  it("allows a pending license only during activation", () => {
    expect(() =>
      assertLicense(
        { ...l, status: "Pending" },
        l.tenantId,
        l.ownerUid,
        1000,
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertLicense({ ...l, status: "Pending" }, l.tenantId, l.ownerUid, 1000),
    ).toThrow();
  });
  it.each(["Blocked", "Suspended", "Revoked"] as const)(
    "denies %s licenses",
    (status) => {
      expect(() =>
        assertLicense({ ...l, status }, l.tenantId, l.ownerUid, 1000, true),
      ).toThrow();
    },
  );
  it("denies expiry, foreign tenant and mismatched account", () => {
    expect(() => assertLicense(l, l.tenantId, l.ownerUid, 2000)).toThrow(
      "expired",
    );
    expect(() => assertLicense(l, "tenant-b", l.ownerUid, 100)).toThrow();
    expect(() => assertLicense(l, l.tenantId, "owner-b", 100)).toThrow();
  });
  it("requires a valid unused one-time token and available slot", () => {
    expect(() => assertActivation(token, l, 1000, false)).not.toThrow();
    expect(() =>
      assertActivation({ ...token, usedAt: 0 }, l, 1000, false),
    ).toThrow("used");
    expect(() => assertActivation(token, l, 1900, false)).toThrow("expired");
    expect(() =>
      assertActivation(token, { ...l, activeCount: 1 }, 1000, false),
    ).toThrow("limit");
    expect(() => assertActivation(undefined, l, 1000, false)).toThrow(
      "Invalid",
    );
    expect(() => assertActivation(token, l, 1000, true)).toThrow(
      "already registered",
    );
  });
  it("rejects a token for another shop or another license", () => {
    for (const t of [
      { ...token, tenantId: "tenant-b" },
      { ...token, licenseId: "license-b" },
    ])
      expect(() => assertActivation(t, l, 1000, false)).toThrow("Invalid");
  });
  it("requires current active device, license, tenant and account together", () => {
    expect(() => assertDevice(d, l, l.ownerUid)).not.toThrow();
    for (const dev of [
      undefined,
      { ...d, status: "Revoked" } as Device,
      { ...d, tenantId: "tenant-b" },
      { ...d, licenseId: "license-b" },
      { ...d, uid: "owner-b" },
    ])
      expect(() => assertDevice(dev, l, l.ownerUid)).toThrow("not authorized");
  });
});
