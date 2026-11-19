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
  await db.doc("tenants/" + tid).set({
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
  await db.doc("licenses/" + lid).set({
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
  return { uid, tid, lid, idToken, email, password };
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
    settlement: "part",
    confirmation: { totalPaise: 13500, balancePaise: 3500 },
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

// A ₹5,000 bill in an isolated emulator tenant; all draft and invoice operations
// go through the same authenticated/signed callables as the licensed client.
async function seedPaymentDesk(a) {
  const t = db.doc(`tenants/${a.tid}`);
  const batch = db.batch();
  batch.create(t.collection("products").doc("ring"), {
    id: "ring",
    sku: "R",
    name: "Payment test ring",
    category: "Ring",
    metal: "Gold",
    purity: "22K",
    gross: 1,
    stone: 0,
    deduction: 0,
    cost: 4000,
    stock: 8,
    makingMode: "Fixed",
    making: 0,
    hsn: "",
    huid: "",
  });
  batch.create(t.collection("metalRates").doc("rate"), {
    id: "rate",
    metal: "Gold",
    purity: "22K",
    rate: 5000,
    effectiveAt: "2025-01-01T00:00:00.000Z",
  });
  batch.create(t.collection("customers").doc("buyer"), {
    id: "buyer",
    name: "Credit buyer",
    email: "",
    phone: "",
    address: "",
    gstin: "",
  });
  await batch.commit();
  return t;
}
async function paymentDesk() {
  const a = await actor(),
    k = keys();
  await activate(a, k, await issue(a));
  return {
    t: await seedPaymentDesk(a),
    send: (action, data) => act(a, k, action, data),
  };
}
const paymentDraft = (paid) => ({
  id: "billing-test",
  customerId: "buyer",
  type: "Non-GST bill",
  mode: "Bank",
  settlement: paid === 5000 ? "full" : "part",
  paid,
  items: [
    {
      productId: "ring",
      quantity: 1,
      makingMode: "Fixed",
      making: 0,
      wastagePct: 0,
      stoneValue: 0,
      otherCharges: 0,
      discount: 0,
    },
  ],
});
const confirmPayment = (draft) => ({
  ...draft,
  confirmation: { totalPaise: 500000, balancePaise: 500000 - draft.paid * 100 },
});
for (const paid of [0, 2000, 5000]) {
  test(`Live callable: ₹${paid} received survives draft round trips on a ₹5,000 bill`, async () => {
    const { t, send } = await paymentDesk(),
      draft = paymentDraft(paid);
    let saved = draft;
    for (let i = 0; i < 3; i++) {
      await send("draft", saved);
      [saved] = (await send("workspace")).workspace.drafts;
      assert.equal(saved.paid, paid);
      assert.equal(saved.mode, "Bank");
      assert.equal(saved.settlement, draft.settlement);
    }
    assert.equal((await t.collection("payments").get()).size, 0);
    await send("invoice", confirmPayment(saved));
    const { workspace } = await send("workspace");
    assert.equal(workspace.drafts.length, 0);
    assert.equal(workspace.invoices.length, 1);
    const [bill] = workspace.invoices;
    assert.deepEqual(
      [bill.totalPaise, bill.paidPaise, bill.balancePaise, bill.mode],
      [500000, paid * 100, (5000 - paid) * 100, "Bank"],
    );
    const payments = await t.collection("payments").get();
    assert.deepEqual(
      payments.docs.map((d) => d.get("amountPaise")),
      paid ? [paid * 100] : [],
    );
    const ledger = await t.collection("customerLedger").get();
    assert.deepEqual(
      ledger.docs.map((d) => d.get("deltaPaise")),
      [(5000 - paid) * 100],
    );
  });
}
test("Live callable rejects inconsistent, missing, or changed payment before any posting", async () => {
  const { t, send } = await paymentDesk(),
    draft = paymentDraft(0),
    bill = confirmPayment(draft);
  await send("draft", draft);
  const invalid = [
    [{ ...bill, paid: -1 }, /paid/],
    [{ ...bill, paid: 0.001 }, /paid/],
    [{ ...bill, paid: 5000.01 }, /exceeds/],
    [{ ...bill, settlement: "full" }, /Full payment/],
    [{ ...bill, paid: 2000 }, /balance changed/],
    [
      { ...bill, confirmation: { totalPaise: 500001, balancePaise: 500000 } },
      /total or outstanding/,
    ],
    [
      { ...bill, confirmation: { totalPaise: 500000, balancePaise: 0 } },
      /balance changed/,
    ],
    [draft, /confirmation/],
    // Even a mathematically consistent ₹0 -> fully paid rewrite (or a mode swap)
    // cannot override the independently stored draft during finalization.
    [confirmPayment(paymentDraft(5000)), /differs from the saved draft/],
    [{ ...bill, mode: "Cash" }, /differs from the saved draft/],
  ];
  for (const [request, message] of invalid)
    await assert.rejects(send("invoice", request), message);
  for (const name of [
    "invoices",
    "payments",
    "customerLedger",
    "stockMovements",
    "counters",
  ])
    assert.equal((await t.collection(name).get()).size, 0, name);
  assert.equal(
    (await t.collection("drafts").doc(draft.id).get()).get("paid"),
    0,
  );
});
test("Live callable: concurrent submissions of the same ₹2,000 payment create exactly one payment entry", async () => {
  const { t, send } = await paymentDesk(),
    draft = paymentDraft(2000),
    bill = confirmPayment(draft);
  await send("draft", draft);
  const a = await Promise.all([send("invoice", bill), send("invoice", bill)]);
  assert.deepEqual(a[0], a[1]);
  await assert.rejects(
    send("invoice", confirmPayment({ ...draft, paid: 1000 })),
    /already used/,
  );
  const payments = await t.collection("payments").get();
  assert.deepEqual(
    payments.docs.map((d) => [
      d.get("invoiceId"),
      d.get("amountPaise"),
      d.get("mode"),
    ]),
    [[draft.id, 200000, "Bank"]],
  );
  assert.equal((await t.collection("invoices").get()).size, 1);
  assert.deepEqual(
    (await t.collection("customerLedger").get()).docs.map((d) =>
      d.get("deltaPaise"),
    ),
    [300000],
  );
});

test("Live browser: an existing zero-received draft stays credit through save, reopen and posting", async () => {
  const a = await actor(),
    t = await seedPaymentDesk(a);
  const { settlement: _, ...legacy } = paymentDraft(0);
  await t
    .collection("drafts")
    .doc(legacy.id)
    .create({ ...legacy, updatedAt: new Date().toISOString() });
  await require("./live-payment-browser.cjs")(a, await issue(a));
  const posted = (await t.collection("invoices").doc(legacy.id).get()).data();
  assert.deepEqual(
    [
      posted.input.settlement,
      posted.mode,
      posted.paidPaise,
      posted.balancePaise,
    ],
    ["part", "Bank", 0, 500000],
  );
  assert.equal((await t.collection("payments").get()).size, 0);
  assert.deepEqual(
    (await t.collection("customerLedger").get()).docs.map((d) =>
      d.get("deltaPaise"),
    ),
    [500000],
  );
});

test("Split receipt, advance and credit note use the original tenant transaction exactly once", async () => {
  const { t, send } = await paymentDesk();
  const deposit = {
    ...paymentDraft(300),
    id: "deposit",
    type: "Advance receipt",
    advanceFor: "Ring order",
    items: [],
    confirmation: { totalPaise: 30000, balancePaise: 0 },
  };
  await send("invoice", deposit);
  const bill = {
    ...confirmPayment(paymentDraft(2000)),
    mode: "Split",
    tenders: [
      { mode: "Cash", amount: 500 },
      { mode: "UPI", amount: 1500 },
    ],
  };
  await send("draft", bill);
  await assert.rejects(
    send("invoice", {
      ...bill,
      tenders: [
        { mode: "Cash", amount: 1500 },
        { mode: "UPI", amount: 500 },
      ],
    }),
    /saved draft/,
  );
  await Promise.all([send("invoice", bill), send("invoice", bill)]);
  const [b] = (await send("workspace")).workspace.invoices.filter(
    (b) => b.id === bill.id,
  );
  assert.equal(b.previousBalancePaise, -30000);
  assert.equal(b.balancePaise, 300000);
  assert.equal(
    (await t.collection("products").doc("ring").get()).get("stock"),
    7,
  );
  const payment = (
    await t
      .collection("payments")
      .doc("sale_" + b.id)
      .get()
  ).data();
  assert.deepEqual(payment.allocations, [
    { mode: "Cash", amountPaise: 50000 },
    { mode: "UPI", amountPaise: 150000 },
  ]);
  assert.equal(payment.amountPaise, 200000);
  await Promise.all([
    send("void", { id: b.id, reason: "Complete return" }),
    send("void", { id: b.id, reason: "Complete return" }),
  ]);
  const note = (await send("workspace")).workspace.invoices.find(
    (x) => x.id === b.id,
  ).creditNote;
  assert.equal(note.reason, "Complete return");
  assert.equal(
    (await t.collection("counters").doc("credits").get()).get("value"),
    1,
  );
  const payments = (await t.collection("payments").get()).docs;
  assert.equal(payments.length, 3);
  assert.equal(
    payments.reduce((s, d) => s + d.get("amountPaise"), 0),
    30000,
  );
  assert.equal(
    (await t.collection("customerLedger").get()).docs.reduce(
      (s, d) => s + d.get("deltaPaise"),
      0,
    ),
    -30000,
  );
  assert.equal(
    (await t.collection("products").doc("ring").get()).get("stock"),
    8,
  );
});
