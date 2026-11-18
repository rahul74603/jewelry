// Trusted operator only. Uses Application Default Credentials, never a web credential.
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
(async () => {
  const [projectId, email] = process.argv.slice(2);
  if (!projectId || !email)
    throw Error(
      "Usage: node scripts/bootstrap.cjs YOUR_PROJECT EXISTING_VERIFIED_ADMIN_EMAIL",
    );
  initializeApp({ projectId, credential: applicationDefault() });
  const auth = getAuth(),
    db = getFirestore(),
    u = await auth.getUserByEmail(email);
  if (!u.emailVerified || u.customClaims?.tenantId)
    throw Error("Use a dedicated, email-verified company account.");
  await auth.setCustomUserClaims(u.uid, { role: "company_admin" });
  await db.doc("superAdmins/" + u.uid).set({ enabled: true });
  for (const [name, deviceLimit] of [
    ["Basic", 1],
    ["Standard", 2],
    ["Premium", 5],
  ]) {
    const ref = db.doc("plans/" + name.toLowerCase());
    if (!(await ref.get()).exists)
      await ref.create({
        id: ref.id,
        name,
        deviceLimit,
        price: 0,
        days: 365,
        features: ["Billing", "Inventory", "Customers"],
        enabled: true,
      });
  }
  await db
    .collection("adminAuditLogs")
    .add({ uid: u.uid, action: "Company bootstrap", at: Date.now() });
  console.log(
    "Admin provisioned. Configure prices, enroll TOTP, then sign in again.",
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
