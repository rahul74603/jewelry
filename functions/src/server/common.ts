import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  onCall,
  HttpsError,
  type CallableRequest,
} from "firebase-functions/v2/https";
import { createHash } from "node:crypto";
import { z } from "zod";
import { id, stableJson } from "../core/model";
import { assertLicense, type License } from "../core/license";
if (!getApps().length) initializeApp();
export const db = getFirestore();
export const sha = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const digest = (v: unknown) => sha(stableJson(v));
export function callable(fn: (r: CallableRequest) => Promise<unknown>) {
  return onCall(
    {
      region: "asia-south1",
      enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
      maxInstances: 20,
      timeoutSeconds: 60,
    },
    async (r) => {
      if (!r.auth)
        throw new HttpsError("unauthenticated", "Sign in to continue.");
      try {
        return await fn(r);
      } catch (e) {
        return mapCallableError(e);
      }
    },
  );
}
/**
 * Unauthenticated callable: same App Check enforcement and error
 * mapping as `callable()`, but NO sign-in requirement. For the
 * offline-license heartbeat only — the offline activation has no
 * login, so the device cannot authenticate. Rate limiting and strict
 * zod validation inside the handler are what keep it abuse-resistant;
 * it never returns another device's data.
 */
export function publicCallable(fn: (r: CallableRequest) => Promise<unknown>) {
  return onCall(
    {
      region: "asia-south1",
      enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true",
      maxInstances: 20,
      timeoutSeconds: 60,
    },
    async (r) => {
      try {
        return await fn(r);
      } catch (e) {
        return mapCallableError(e);
      }
    },
  );
}
function mapCallableError(e: unknown): never {
  if (e instanceof HttpsError) throw e;
  if (e instanceof z.ZodError)
    throw new HttpsError(
      "invalid-argument",
      e.issues
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; ")
        .slice(0, 400),
    );
  // Do not leak provider errors, database keys or user records.
  if (e instanceof Error && e.constructor === Error && !("code" in e))
    throw new HttpsError("failed-precondition", e.message);
  console.error("Trusted operation failed", {
    code: (e as { code?: unknown })?.code ?? "internal",
  });
  throw new HttpsError(
    "internal",
    "Operation unavailable. No partial financial posting was saved.",
  );
}
export function owner(r: CallableRequest) {
  const a = r.auth!;
  if (a.token.role !== "owner" || !id.safeParse(a.token.tenantId).success)
    throw new HttpsError(
      "permission-denied",
      "A provisioned shop account is required.",
    );
  return { uid: a.uid, tid: a.token.tenantId as string };
}
export async function tenantLicense(
  tx: FirebaseFirestore.Transaction,
  tid: string,
  uid: string,
  now: number,
  activate = false,
) {
  const t = db.doc(`tenants/${tid}`),
    meta = (await tx.get(t)).data();
  if (!meta || meta.ownerUid !== uid || meta.status !== "Active")
    throw new HttpsError("permission-denied", "Shop access unavailable.");
  const ref = db.doc(`licenses/${meta.licenseId}`),
    l = (await tx.get(ref)).data() as License | undefined;
  assertLicense(l, tid, uid, now, activate);
  return { t, ref, l: l! };
}
export async function requireAdmin(r: CallableRequest) {
  const a = r.auth!;
  if (
    a.token.role !== "company_admin" ||
    !a.token.firebase?.sign_in_second_factor ||
    !(await db.doc(`superAdmins/${a.uid}`).get()).get("enabled")
  )
    throw new HttpsError(
      "permission-denied",
      "A company administrator with a verified second factor is required.",
    );
  return a.uid;
}
export const audit = (
  tx: FirebaseFirestore.Transaction,
  uid: string,
  action: string,
  fields: Record<string, unknown>,
) =>
  tx.create(db.collection("adminAuditLogs").doc(), {
    uid,
    action,
    at: Date.now(),
    ...fields,
  });
