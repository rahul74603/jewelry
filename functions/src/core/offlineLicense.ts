import { z } from "zod";

/**
 * Offline-license (anti-fraud kill switch) core logic — pure, no
 * firebase-admin here, so the client can reuse the validation and
 * the functions unit tests can run without an emulator.
 *
 * SCOPE (Ajay, 2026-11-24 19:02 IST): the app goes online ONLY for
 * (1) block/unlock and (2) presence — which phone it is on (Device
 * ID, shop name, model, last seen). NOTHING else goes online: no
 * billing, no cloud data sync, no server workspace. The heartbeat
 * payload below is the entire online surface.
 *
 * This is a SEPARATE system from the live server licenses
 * (functions/src/core/license.ts — Firebase Auth tenants, 64-hex
 * deviceId). The offline activation has no login: the key is the
 * 12-hex Device ID from the lock screen (XXXX-XXXX-XXXX).
 */

export type OfflineLicenseStatus = "active" | "blocked";

export type OfflineLicenseDoc = {
  deviceId: string; // normalized 12-hex, no dashes
  shopName: string;
  model: string;
  appVersion: string;
  status: OfflineLicenseStatus;
  firstSeen: number;
  lastSeen: number;
  heartbeatCount: number;
};

export type HeartbeatInput = {
  deviceId: string; // normalized 12-hex
  shopName: string;
  model: string;
  appVersion: string;
};

/** Generous per-device heartbeat limit: 20/hour (heartbeat is 1/day). */
export const HEARTBEAT_LIMIT_PER_HOUR = 20;
export const HEARTBEAT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Normalise a Device ID typed or reported by a device: dashes and
 * spaces ignored, case-insensitive. Returns the 12 ungrouped hex
 * chars; throws when it is not exactly 12 hex characters.
 */
export function normalizeOfflineDeviceId(input: string): string {
  const hex = input.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(hex))
    throw Error("Device ID must be 12 hex characters (XXXX-XXXX-XXXX).");
  return hex;
}

/** Short human-readable Device ID: XXXX-XXXX-XXXX. */
export function formatOfflineDeviceId(deviceId: string): string {
  const hex = normalizeOfflineDeviceId(deviceId);
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

const heartbeatSchema = z.object({
  deviceId: z.string().min(1).max(20),
  shopName: z.string().trim().min(1).max(100),
  model: z.string().trim().max(100).optional().default(""),
  appVersion: z.string().trim().max(20).optional().default(""),
});

/** Validate + normalise an unauthenticated heartbeat payload. */
export function parseHeartbeatInput(input: unknown): HeartbeatInput {
  const v = heartbeatSchema.parse(input);
  return {
    deviceId: normalizeOfflineDeviceId(v.deviceId),
    shopName: v.shopName,
    model: v.model ?? "",
    appVersion: v.appVersion ?? "",
  };
}

const statusChangeSchema = z.object({
  deviceId: z.string().min(1).max(20),
  status: z.enum(["active", "blocked"]),
});

/** Validate + normalise an admin block/unblock request. */
export function parseStatusChange(input: unknown): {
  deviceId: string;
  status: OfflineLicenseStatus;
} {
  const v = statusChangeSchema.parse(input);
  return { deviceId: normalizeOfflineDeviceId(v.deviceId), status: v.status };
}

/**
 * Apply one heartbeat to the stored doc. A blocked device stays
 * blocked until an admin unblocks it — a heartbeat never clears a
 * block on its own. First heartbeat creates the doc as active.
 */
export function applyHeartbeat(
  existing: OfflineLicenseDoc | undefined,
  input: HeartbeatInput,
  now: number,
): OfflineLicenseDoc {
  return {
    deviceId: input.deviceId,
    shopName: input.shopName,
    model: input.model,
    appVersion: input.appVersion,
    status: existing?.status ?? "active",
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    heartbeatCount: (existing?.heartbeatCount ?? 0) + 1,
  };
}

/**
 * Per-device rate-limit bucket, same shape as the live device
 * requests use (`requestLimits/<key>` docs with {count, until}).
 * Returns the next bucket to store; throws when the limit is hit.
 */
export function checkHeartbeatRateLimit(
  bucket: { count: number; until: number } | undefined,
  now: number,
): { count: number; until: number } {
  const sameWindow = bucket && bucket.until > now;
  const count = sameWindow ? bucket.count : 0;
  if (count >= HEARTBEAT_LIMIT_PER_HOUR)
    throw Error("Too many requests. Try again in an hour.");
  return {
    count: count + 1,
    until: sameWindow ? bucket.until : now + HEARTBEAT_WINDOW_MS,
  };
}
