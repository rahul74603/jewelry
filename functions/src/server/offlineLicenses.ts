import { db, publicCallable, sha } from "./common";
import {
  applyHeartbeat,
  checkHeartbeatRateLimit,
  parseHeartbeatInput,
  type OfflineLicenseDoc,
} from "../core/offlineLicense";

/**
 * Offline-license heartbeat — the kill-switch half of the anti-fraud
 * work. Unauthenticated (the offline activation has no login), App
 * Check enforced outside the emulator, per-device rate limited.
 *
 * SCOPE (Ajay, 2026-11-24 19:02 IST): online ONLY for block/unlock
 * + presence (Device ID, shop name, model, last seen). The payload
 * below is the entire online surface — no billing, no data sync, no
 * server workspace. Firestore collection `offlineLicenses`, keyed by
 * the normalized 12-hex Device ID. Never returns another device's
 * data: the response is only this device's own status.
 */
export const licenseHeartbeat = publicCallable(async (r) => {
  const input = parseHeartbeatInput(r.data);
  const now = Date.now();
  const status = await db.runTransaction(async (tx) => {
    const limitRef = db.doc(`requestLimits/hb_${sha(input.deviceId)}`);
    const bucket = (await tx.get(limitRef)).data() as
      | { count: number; until: number }
      | undefined;
    tx.set(limitRef, checkHeartbeatRateLimit(bucket, now));
    const ref = db.doc(`offlineLicenses/${input.deviceId}`);
    const existing = (await tx.get(ref)).data() as
      | OfflineLicenseDoc
      | undefined;
    const next = applyHeartbeat(existing, input, now);
    tx.set(ref, next);
    return next.status;
  });
  return { status };
});
