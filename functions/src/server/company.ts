import { randomBytes, randomUUID } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { id, makeProfile } from "../core/model";
import { type License, type Device } from "../core/license";
import {
  parseStatusChange,
  type OfflineLicenseDoc,
} from "../core/offlineLicense";
import { db, callable, requireAdmin, sha, audit } from "./common";
const planSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  price: z.number().min(0).max(10000000),
  days: z.number().int().min(0).max(3650),
  deviceLimit: z.number().int().min(1).max(100),
  features: z.array(z.string().max(60)).max(30),
  enabled: z.boolean(),
});
export const companyConsole = callable(async (r) => {
  const uid = await requireAdmin(r),
    op = r.data?.op,
    now = Date.now();
  const data = r.data?.data;
  const account = await getAuth().getUser(uid);
  if (
    account.disabled ||
    r.auth!.token.auth_time * 1000 <
      Date.parse(account.tokensValidAfterTime ?? "1970-01-01")
  )
    throw Error("Administrator session expired.");
  if (op === "list") {
    const [shops, licenses, devices, plans, events] = await Promise.all(
      ["tenants", "licenses", "licenseDevices", "plans", "adminAuditLogs"].map(
        (n) =>
          (n === "adminAuditLogs"
            ? db.collection(n).orderBy("at", "desc").limit(80)
            : db.collection(n).limit(501)
          ).get(),
      ),
    );
    if ([shops, licenses, devices, plans].some((s) => s.size > 500))
      throw Error(
        "Company pilot capacity reached: enable server pagination before adding more shops.",
      );
    return {
      shops: shops.docs.map((d) => d.data()),
      licenses: licenses.docs.map((d) => d.data()),
      devices: devices.docs.map((d) => {
        const { publicKey: _, ...rest } = d.data();
        return rest;
      }),
      plans: plans.docs.map((d) => d.data()),
      events: events.docs.map((d) => d.data()),
    };
  }
  if (op === "offlineLicenses") {
    // Kill-switch dashboard: every offline-activated device that has
    // ever phoned home, newest heartbeat first. Presence only —
    // Device ID, shop name, model, app version, last seen, status.
    const snap = await db
      .collection("offlineLicenses")
      .orderBy("lastSeen", "desc")
      .limit(500)
      .get();
    return {
      devices: snap.docs.map((d) => d.data() as OfflineLicenseDoc),
    };
  }
  if (op === "offlineLicenseStatus") {
    // Kill switch: block or unblock one offline device by Device ID.
    const v = parseStatusChange(data);
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`offlineLicenses/${v.deviceId}`);
      const cur = (await tx.get(ref)).data() as
        | OfflineLicenseDoc
        | undefined;
      if (!cur) throw Error("Device not found.");
      tx.update(ref, { status: v.status });
      audit(
        tx,
        uid,
        v.status === "blocked"
          ? "Offline device blocked"
          : "Offline device unblocked",
        { deviceId: v.deviceId },
      );
    });
    return { ok: true };
  }
  if (op === "plan") {
    const p = planSchema.parse(data);
    await db.runTransaction(async (tx) => {
      tx.set(db.doc(`plans/${p.id}`), p);
      audit(tx, uid, "Plan updated", { planId: p.id });
    });
    return { ok: true };
  }
  if (op === "createShop") {
    const v = z
      .object({
        shopName: z.string().trim().min(1).max(100),
        ownerName: z.string().trim().min(1).max(100),
        email: z.string().email(),
        planId: id,
      })
      .parse(data);
    const tid = randomUUID(),
      lid = randomUUID();
    const plan = planSchema.parse(
      (await db.doc(`plans/${v.planId}`).get()).data(),
    );
    if (!plan.enabled) throw Error("Plan is disabled.");
    const auth = getAuth(),
      u = await auth.createUser({
        email: v.email,
        disabled: true,
        displayName: v.ownerName,
      });
    const license: License = {
      id: lid,
      tenantId: tid,
      ownerUid: u.uid,
      plan: plan.name,
      deviceLimit: plan.deviceLimit,
      activeCount: 0,
      status: "Pending",
      expiresAt: plan.days ? now + plan.days * 86400000 : null,
      createdAt: now,
    };
    try {
      await auth.setCustomUserClaims(u.uid, { role: "owner", tenantId: tid });
      await db.runTransaction(async (tx) => {
        tx.create(db.doc(`tenants/${tid}`), {
          id: tid,
          ownerUid: u.uid,
          licenseId: lid,
          shopName: v.shopName,
          email: v.email,
          status: "Active",
          createdAt: now,
        });
        tx.create(
          db.doc(`tenants/${tid}/settings/profile`),
          makeProfile(v.shopName, v.ownerName, v.email),
        );
        tx.create(db.doc(`licenses/${lid}`), license);
        audit(tx, uid, "Shop and license created", {
          tenantId: tid,
          licenseId: lid,
          plan: plan.id,
        });
      });
    } catch (e) {
      await auth.deleteUser(u.uid);
      throw e;
    }
    await auth.updateUser(u.uid, { disabled: false });
    return { tenantId: tid, licenseId: lid, email: v.email };
  }
  const validOps = [
    "token",
    "renew",
    "block",
    "suspend",
    "revoke",
    "resume",
    "revokeDevice",
    "transfer",
  ];
  if (!validOps.includes(op)) throw Error("Unknown company operation.");
  const v = z
    .object({
      licenseId: id,
      deviceId: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      days: z.number().int().min(1).max(3650).optional(),
    })
    .parse(data);
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`licenses/${v.licenseId}`),
      l = (await tx.get(ref)).data() as License | undefined;
    if (!l) throw Error("License not found.");
    if (l.status === "Revoked")
      throw Error("A revoked license cannot be reused.");
    if (op === "transfer" || op === "revokeDevice") {
      if (!v.deviceId) throw Error("Select a registered device.");
      const deviceRef = db.doc(`licenseDevices/${v.deviceId}`),
        d = (await tx.get(deviceRef)).data() as Device | undefined;
      if (
        !d ||
        d.licenseId !== l.id ||
        d.tenantId !== l.tenantId ||
        d.status !== "Active"
      )
        throw Error("Active device does not belong to this license.");
      tx.update(deviceRef, { status: "Revoked", revokedAt: now });
      tx.update(ref, { activeCount: l.activeCount - 1 });
      audit(
        tx,
        uid,
        op === "transfer" ? "Device transfer started" : "Device revoked",
        { licenseId: l.id, tenantId: l.tenantId, deviceId: d.id },
      );
    }
    if (op === "token" || op === "transfer") {
      if (
        !["Pending", "Active"].includes(l.status) ||
        (l.expiresAt !== null && l.expiresAt <= now)
      )
        throw Error("License must be valid to issue a token.");
      if (op === "token" && l.activeCount >= l.deviceLimit)
        throw Error(
          "Device limit reached. Transfer or revoke an existing device.",
        );
      const token = randomBytes(16).toString("hex"),
        expiresAt = now + 10 * 60000;
      tx.create(db.doc(`activationTokens/${sha(token)}`), {
        tenantId: l.tenantId,
        licenseId: l.id,
        usedAt: null,
        expiresAt,
        deleteAfter: Timestamp.fromMillis(expiresAt + 86400000),
      });
      audit(tx, uid, "One-time token issued", {
        tenantId: l.tenantId,
        licenseId: l.id,
        expiresAt,
      });
      return { code: token.match(/.{4}/g)!.join("-"), expiresAt };
    }
    if (op === "renew") {
      if (!v.days) throw Error("Renewal duration required.");
      if (l.expiresAt === null)
        throw Error("A lifetime license needs no renewal.");
      const expiresAt = Math.max(now, l.expiresAt) + v.days * 86400000;
      tx.update(ref, { expiresAt });
      audit(tx, uid, "License renewed", {
        licenseId: l.id,
        previousExpiry: l.expiresAt,
        expiresAt,
      });
    }
    if (["block", "suspend", "revoke", "resume"].includes(op)) {
      const status =
        op === "block"
          ? "Blocked"
          : op === "suspend"
            ? "Suspended"
            : op === "revoke"
              ? "Revoked"
              : l.activeCount
                ? "Active"
                : "Pending";
      tx.update(ref, { status });
      audit(tx, uid, `License ${status.toLowerCase()}`, { licenseId: l.id });
    }
    return { ok: true };
  });
});
