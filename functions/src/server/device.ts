import { randomBytes, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  callable,
  db,
  owner,
  sha,
  digest,
  tenantLicense,
  audit,
} from "./common";
import {
  assertActivation,
  assertDevice,
  type Device,
  type Token,
} from "../core/license";
import { shopAction } from "./workspace";
const actions = z.enum([
  "activate",
  "workspace",
  "profile",
  "customer",
  "product",
  "rate",
  "invoice",
  "draft",
  "void",
  "adjust",
  "restore",
]);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const binding = z.object({ action: actions, digest: hash, deviceId: hash });
const proofRequest = z.object({
  challengeId: z.string().regex(/^[a-f0-9]{48}$/),
  signature: z.string().min(20).max(256),
  encoding: z.enum(["der", "ieee-p1363"]),
  payload: z.unknown(),
});
export const beginDeviceRequest = callable(async (r) => {
  const { uid, tid } = owner(r),
    v = binding.parse(r.data),
    now = Date.now(),
    nonce = randomBytes(24).toString("hex");
  const challenge = db.doc(`challenges/${nonce}`);
  const message = `aurum-v1:${nonce}:${tid}:${uid}:${v.deviceId}:${v.action}:${v.digest}`;
  await db.runTransaction(async (tx) => {
    const { l } = await tenantLicense(
      tx,
      tid,
      uid,
      now,
      v.action === "activate",
    );
    if (v.action !== "activate")
      assertDevice(
        (await tx.get(db.doc(`licenseDevices/${v.deviceId}`))).data() as
          Device | undefined,
        l,
        uid,
      );
    const limit = v.action === "activate" ? 8 : 100;
    const bucket = db.doc(
        `requestLimits/${sha(uid)}_${v.action === "activate" ? "activation" : "workspace"}`,
      ),
      s = (await tx.get(bucket)).data();
    const same = s && s.until > now,
      count = same ? s.count : 0;
    if (count >= limit)
      throw Error("Too many requests. Try again in a minute.");
    tx.set(bucket, { count: count + 1, until: same ? s.until : now + 60000 });
    tx.create(challenge, {
      ...v,
      tid,
      uid,
      message,
      expiresAt: now + 60000,
      deleteAfter: Timestamp.fromMillis(now + 300000),
    });
  });
  return { challengeId: nonce, message };
});
export const completeDeviceRequest = callable(async (r) => {
  const { uid, tid } = owner(r),
    v = proofRequest.parse(r.data);
  const cRef = db.doc(`challenges/${v.challengeId}`);
  // Burn even failed proofs. One authenticated challenge permits exactly one attempt,
  // including an invalid activation code. Firestore retries cannot resurrect it.
  const c = await db.runTransaction(async (tx) => {
    const c = (await tx.get(cRef)).data();
    if (
      !c ||
      c.uid !== uid ||
      c.tid !== tid ||
      c.expiresAt <= Date.now() ||
      digest(v.payload) !== c.digest
    )
      throw Error("Invalid or expired device challenge.");
    tx.delete(cRef);
    return c;
  });
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    if (c.expiresAt <= now) throw Error("Device challenge expired.");
    const { l, t, ref } = await tenantLicense(
      tx,
      tid,
      uid,
      now,
      c.action === "activate",
    );
    const devRef = db.doc(`licenseDevices/${c.deviceId}`);
    const device = (await tx.get(devRef)).data() as Device | undefined;
    const a =
      c.action === "activate"
        ? z
            .object({
              code: z.string().max(64),
              publicKey: z.string().max(400),
              platform: z.enum(["Android", "Browser"]),
            })
            .parse(v.payload)
        : null;
    if (!a) assertDevice(device, l, uid);
    const der = Buffer.from(a?.publicKey ?? device!.publicKey, "base64");
    if (sha(der) !== c.deviceId) throw Error("Device key mismatch.");
    let ok = false;
    try {
      const pub = createPublicKey({ key: der, type: "spki", format: "der" });
      ok =
        pub.asymmetricKeyType === "ec" &&
        pub.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
        verify(
          "sha256",
          Buffer.from(c.message),
          { key: pub, dsaEncoding: v.encoding },
          Buffer.from(v.signature, "base64"),
        );
    } catch {
      /* invalid key/signature */
    }
    if (!ok) throw Error("Device proof rejected.");
    if (a) {
      const tokenRef = db.doc(
        `activationTokens/${sha(a.code.replace(/[\s-]/g, "").toLowerCase())}`,
      );
      const tok = (await tx.get(tokenRef)).data() as Token | undefined;
      assertActivation(tok, l, now, !!device);
      tx.update(tokenRef, { usedAt: now });
      tx.update(ref, { activeCount: l.activeCount + 1, status: "Active" });
      tx.create(devRef, {
        id: c.deviceId,
        uid,
        tenantId: tid,
        licenseId: l.id,
        publicKey: a.publicKey,
        platform: a.platform,
        status: "Active",
        createdAt: now,
        lastVerified: now,
      });
      audit(tx, uid, "Device activated", {
        tenantId: tid,
        deviceId: c.deviceId,
        licenseId: l.id,
      });
      return { ok: true };
    }
    const result = await shopAction(tx, t, uid, c.action, v.payload, now);
    tx.update(devRef, { lastVerified: now });
    return c.action === "workspace"
      ? {
          workspace: result,
          license: {
            id: l.id,
            plan: l.plan,
            deviceLimit: l.deviceLimit,
            expiresAt: l.expiresAt,
            platform: device!.platform,
            deviceId: c.deviceId,
          },
        }
      : result;
  });
});
