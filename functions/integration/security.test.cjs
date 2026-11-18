/** Integration acceptance against OUR throwaway Firebase emulator project only. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { getDoc, setDoc, doc } = require("firebase/firestore");
const projectId = "demo-aurum";
if (
  !process.env.FIRESTORE_EMULATOR_HOST?.startsWith("127.0.0.1:") ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith("127.0.0.1:")
)
  throw Error("Local emulators required. Refusing to use live resources.");
initializeApp({ projectId });
const db = getFirestore(),
  auth = getAuth();
const { makeProfile, stableJson } = require("../lib/core/model");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
let rules;
let adminUid;
before(async () => {
  rules = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: fs.readFileSync("../firestore.rules", "utf8"),
    },
  });
  const u = await auth.createUser({
    email: `company-${crypto.randomUUID()}@example.invalid`,
    emailVerified: true,
  });
  adminUid = u.uid;
  await db.doc("superAdmins/" + adminUid).set({ enabled: true });
});
after(async () => {
  await rules?.cleanup();
});
const adminOp = (op, data) =>
  require("../lib/index").companyConsole.run({
    auth: {
      uid: adminUid,
      token: {
        role: "company_admin",
        firebase: { sign_in_second_factor: "totp" },
        auth_time: Math.ceil(Date.now() / 1000),
      },
    },
    data: { op, data },
  });
async function actor() {
  const tid = crypto.randomUUID(),
    lid = crypto.randomUUID(),
    email = tid + "@example.invalid",
    password = crypto.randomBytes(24).toString("hex");
  const { uid } = await auth.createUser({
    email,
    password,
    emailVerified: true,
  });
  await auth.setCustomUserClaims(uid, { role: "owner", tenantId: tid });
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-only`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const { idToken } = await r.json();
  assert.ok(idToken);
  await db
    .doc("tenants/" + tid)
    .set({
      ownerUid: uid,
      status: "Active",
      licenseId: lid,
      id: tid,
      shopName: tid,
      email,
    });
  await db
    .doc(`tenants/${tid}/settings/profile`)
    .set({ ...makeProfile(tid, "Test owner", email), setupComplete: true });
  await db
    .doc("licenses/" + lid)
    .set({
      id: lid,
      ownerUid: uid,
      tenantId: tid,
      plan: "Basic",
      status: "Pending",
      expiresAt: Date.now() + 86400000,
      deviceLimit: 1,
      activeCount: 0,
      createdAt: Date.now(),
    });
  return { uid, tid, lid, idToken };
}
function keys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    }),
    der = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, publicKey: der.toString("base64"), deviceId: sha(der) };
}
async function call(a, fn, data) {
  const r = await fetch(
    `http://127.0.0.1:5001/${projectId}/asia-south1/${fn}`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + a.idToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = await r.json();
  if (!r.ok || body.error) throw Error(body.error?.message ?? r.statusText);
  return body.result;
}
async function proof(a, k, action, payload) {
  const ch = await call(a, "beginDeviceRequest", {
    deviceId: k.deviceId,
    action,
    digest: sha(stableJson(payload)),
  });
  return {
    challengeId: ch.challengeId,
    payload,
    signature: crypto
      .sign("sha256", Buffer.from(ch.message), k.privateKey)
      .toString("base64"),
    encoding: "der",
  };
}
async function act(a, k, action, payload = {}) {
  return call(a, "completeDeviceRequest", await proof(a, k, action, payload));
}
async function issue(a) {
  return (await adminOp("token", { licenseId: a.lid })).code;
}
const activate = (a, k, code) =>
  act(a, k, "activate", { publicKey: k.publicKey, platform: "Browser", code });
test("Direct invoice / settings reads and writes are denied, including to company admins", async () => {
  for (const claims of [
    { role: "owner", tenantId: "A" },
    { role: "company_admin" },
  ]) {
    const client = rules.authenticatedContext("test-user", claims).firestore();
    for (const path of [
      "tenants/B/invoices/i",
      "tenants/B/settings/profile",
      "tenants/A/products/p",
      "licenses/l",
      "licenseDevices/d",
    ]) {
      await assertFails(getDoc(doc(client, path)));
      await assertFails(setDoc(doc(client, path), { data: 1 }));
    }
  }
});
test("Real authenticated functions isolate two shops; device and temporary token cannot cross shops", async () => {
  const a = await actor(),
    b = await actor(),
    ka = keys(),
    kb = keys(),
    ta = await issue(a),
    tb = await issue(b);
  await assert.rejects(activate(a, ka, tb), /Invalid activation/);
  await activate(a, ka, ta);
  await activate(b, kb, tb);
  await assert.rejects(activate(a, keys(), ta), /already used/);
  await assert.rejects(act(b, ka, "workspace"), /not authorized/);
  await assert.rejects(
    call(a, "companyConsole", { op: "list" }),
    /administrator/,
  );
  const own = await act(a, ka, "workspace", { tenantId: b.tid });
  assert.equal(own.workspace.profile.shopName, a.tid);
  await act(a, ka, "profile", {
    ...own.workspace.profile,
    shopName: "Renamed A",
    tenantId: b.tid,
  });
  assert.equal(
    (await act(b, kb, "workspace")).workspace.profile.shopName,
    b.tid,
  );
  const pr = await proof(a, ka, "workspace", {});
  await call(a, "completeDeviceRequest", pr);
  await assert.rejects(call(a, "completeDeviceRequest", pr), /challenge/);
  const pending = await proof(a, ka, "workspace", {});
  const moved = await adminOp("transfer", {
    licenseId: a.lid,
    deviceId: ka.deviceId,
  });
  await assert.rejects(
    call(a, "completeDeviceRequest", pending),
    /not authorized/,
  );
  const replacement = keys();
  await activate(a, replacement, moved.code);
  await assert.rejects(act(a, ka, "workspace"), /not authorized/);
  await adminOp("block", { licenseId: a.lid });
  await assert.rejects(act(a, replacement, "workspace"), /blocked/);
  await adminOp("resume", { licenseId: a.lid });
  await db.doc("licenses/" + a.lid).update({ expiresAt: Date.now() - 1 });
  await assert.rejects(act(a, replacement, "workspace"), /expired/);
  await adminOp("renew", { licenseId: a.lid, days: 30 });
  assert.equal((await act(a, replacement, "workspace")).license.deviceLimit, 1);
});
test("Expired code is rejected; simultaneous activations cannot exceed one slot", async () => {
  const a = await actor(),
    expired = await issue(a);
  await db
    .doc("activationTokens/" + sha(expired.replaceAll("-", "")))
    .update({ expiresAt: Date.now() - 1 });
  await assert.rejects(activate(a, keys(), expired), /expired/);
  const t1 = await issue(a),
    t2 = await issue(a);
  const results = await Promise.allSettled([
    activate(a, keys(), t1),
    activate(a, keys(), t2),
  ]);
  assert.equal(results.filter((v) => v.status === "fulfilled").length, 1);
  assert.match(
    results.find((v) => v.status === "rejected").reason.message,
    /limit/,
  );
  assert.equal((await db.doc("licenses/" + a.lid).get()).get("activeCount"), 1);
});
test("Invoice posting is idempotent, atomic, tenant-scoped and reversible", async () => {
  const a = await actor(),
    b = await actor(),
    k = keys(),
    kb = keys();
  await activate(a, k, await issue(a));
  await activate(b, kb, await issue(b));
  const t = db.doc("tenants/" + a.tid);
  await act(a, k, "customer", {
    id: "c",
    name: "Buyer",
    address: "",
    gstin: "",
    email: "",
    phone: "",
  });
  await act(a, k, "product", {
    id: "p",
    sku: "001",
    name: "Silver band",
    category: "Ring",
    metal: "Silver",
    purity: "925",
    stock: 2,
    gross: 1.25,
    stone: 0,
    deduction: 0,
    cost: 70,
    makingMode: "Fixed",
    making: 10,
    huid: "",
    hsn: "",
  });
  await act(a, k, "rate", {
    id: "r",
    metal: "Silver",
    purity: "925",
    rate: 100,
    effectiveAt: "2026-01-01T00:00:00.000Z",
  });
  const bill = {
    id: "order1",
    customerId: "c",
    type: "Non-GST bill",
    paid: 100,
    mode: "Cash",
    items: [
      {
        productId: "p",
        quantity: 1,
        making: 10,
        makingMode: "Fixed",
        stoneValue: 0,
        wastagePct: 0,
        discount: 0,
        otherCharges: 0,
      },
    ],
  };
  await Promise.all([act(a, k, "invoice", bill), act(a, k, "invoice", bill)]);
  assert.equal((await t.collection("invoices").get()).size, 1);
  assert.equal((await t.collection("products").doc("p").get()).get("stock"), 1);
  assert.equal(
    (await t.collection("payments").get()).docs[0].get("amountPaise"),
    10000,
  );
  assert.equal(
    (await t.collection("customerLedger").get()).docs[0].get("deltaPaise"),
    3500,
  );
  assert.deepEqual((await act(b, kb, "workspace")).workspace.invoices, []);
  await assert.rejects(
    act(b, kb, "void", { id: "order1", reason: "Test reversal" }),
    /not found/,
  );
  await assert.rejects(
    act(a, k, "invoice", { ...bill, paid: 0 }),
    /already used/,
  );
  await assert.rejects(
    act(a, k, "invoice", {
      ...bill,
      id: "oversold",
      items: [{ ...bill.items[0], quantity: 2 }],
    }),
    /Not enough stock/,
  );
  assert.equal((await t.collection("invoices").get()).size, 1);
  await act(a, k, "void", { id: "order1", reason: "Full reversal" });
  await act(a, k, "void", { id: "order1", reason: "Retry reversal" });
  assert.equal((await t.collection("products").doc("p").get()).get("stock"), 2);
  assert.equal(
    (await t.collection("payments").get()).docs.reduce(
      (sum, x) => sum + x.get("amountPaise"),
      0,
    ),
    0,
  );
  assert.equal(
    (await t.collection("customerLedger").get()).docs.reduce(
      (sum, x) => sum + x.get("deltaPaise"),
      0,
    ),
    0,
  );
  assert.equal(
    (await t.collection("invoices").doc("order1").get()).get("totalPaise"),
    13500,
  );
});
