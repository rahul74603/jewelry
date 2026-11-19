# Operator guide

## Trust boundaries

The public preview and the licensed product are distinct build modes. The public build contains only disposable fixtures, no customer service endpoint. With `VITE_APP_MODE=live` the sample module is eliminated, missing configuration makes the build fail, and a failed online check never opens a demo or a cached tenant. Company provisioning creates an Auth identity and a server-owned mapping; entering an arbitrary shop ID is not an access mechanism.

Client Firestore/Storage reads **and** writes are denied, including to shop owners and company admins. `beginDeviceRequest` and `completeDeviceRequest` are authenticated callable functions; derive the tenant from verified claims and re-check the account against the tenant and license records. `companyConsole` requires a separate company claim, enabled allowlist record and Firebase-verified second factor. It accesses registration/license metadata, not shop collections. There is no support impersonation endpoint. Admin SDK IAM remains powerful: restrict project operators; the web application does not neutralize a compromised cloud administrator.

| Location                                                                                               | Purpose                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `tenants/{tenantId}`                                                                                   | Company registration metadata, owner UID, license reference, status |
| `tenants/{tenantId}/settings/profile`                                                                  | Private shop branding, GST/HSN configuration and invoice settings   |
| `tenants/{tenantId}/{customers,products,metalRates,invoices,drafts}`                                   | Tenant-owned workspace records                                      |
| `tenants/{tenantId}/{stockMovements,payments,customerLedger,reversals,conversions,counters,auditLogs}` | Linked, atomic financial changes and sequence allocation            |
| `licenses`, `licenseDevices`, `activationTokens`, `challenges`, `requestLimits`                        | Trusted license, device proof, token digest and rate-limit state    |
| `plans`, `superAdmins`, `adminAuditLogs`                                                               | Company control plane                                               |

An activation code contains 128 random bits and no password. Only its digest is stored. Expiry is checked in code (not delegated to TTL). Within one transaction the server checks tenant/license/slot/token/key, consumes the token, binds the public key and increments the count. A transfer revokes the previous key and issues a fresh token in one transaction. A revoked key stays in history. A block or renewal does not silently reinstate revoked devices. Plan edits affect new registrations, not existing contracts.

Every workspace operation requires a fresh signature over a domain-separated challenge bound to the UID, tenant, device fingerprint, action and canonical payload digest. Single-use challenges expire in 60 seconds and are consumed even if a checked proof fails. Per-UID issuance is rate-limited (8 activation challenges/minute, 100 workspace challenges/minute). The action transaction rechecks live license/device state, preventing a challenge obtained before revocation from granting later access. Startup, foregrounding, reconnect and periodic two-minute checks validate the workspace. Already displayed pixels cannot be recalled.

Android signs in Android Keystore (P-256, SHA-256/ECDSA). Only the public key and signatures cross the bridge. Hardware backing depends on the device; this is not attestation or an unbreakable physical device ID. The browser stores a non-extractable Web Crypto private `CryptoKey` in IndexedDB. Clearing browser data or reinstalling can require an owner-verified transfer to a fresh key. Origin compromise/XSS remains a risk. No private key is exported to plain storage. No offline lease is issued by this pilot; immediate offline revocation is not promised.

## Configure a real deployment (operator action; not automatic)

1. Use a **dedicated staging Firebase project** with Firestore, Functions billing enabled, Auth/Identity Platform Email/Password, verified email delivery and TOTP MFA enabled. Configure authorized web domains and the real app origin. Do not enter cloud service-account credentials in the frontend or in chat.
2. Register the web app and App Check reCAPTCHA Enterprise provider for its actual origin. Configure quotas/rate alerts and IAM. The Android debug demo does not need any Firebase project; production native App Check/attestation and physical-device compatibility need a separate staging signoff. Do not turn off production enforcement to make a preview pass.
3. Install both locked dependency trees. Deploy the restrictive database/storage rules **before** enabling customer access. Using a trusted machine with Firebase CLI and operator login:
   ```sh
   npm ci && npm --prefix functions ci
   firebase deploy --only firestore:rules,storage,functions --project YOUR_STAGING_PROJECT
   ```
   Configure Firestore TTL for `challenges.deleteAfter` and `activationTokens.deleteAfter` for cleanup. Review retention, backups and monitoring before storing real transactions. No backup/restore guarantee is implemented.
4. Create a separate, email-verified company Auth user. Use **Application Default Credentials** with the minimum required provisioning permissions on a trusted operator machine:
   ```sh
   node functions/scripts/bootstrap.cjs YOUR_STAGING_PROJECT VERIFIED_COMPANY_EMAIL
   ```
   This seeds a company allowlist/claim and initial plan records; never use a shop owner as the company admin. Set contractual prices/durations in the console. No password, admin token or signing secret is added to client code. Existing plans are not overwritten on bootstrap.
5. Copy `.env.example` to `.env.local`. Set `VITE_APP_MODE=live` and all five public Firebase/App Check configuration values. These are project identifiers/site keys, not Admin SDK credentials. `npm run build`, then deploy hosting to the matching project. Do not deploy the default demo as a live tenant app.
6. Sign in as company admin, enroll an authenticator if necessary, then sign in again with the second factor. Register a shop with an available plan. The owner sets a password by email. Issue a one-time QR/token and transmit privately to the verified owner; never log or publish it. The owner signs in, enters the code or reads a QR image, completes setup, and adds customers/products/effective rates. Fewer permissions are intentional: a company admin cannot browse the shop ledger.

## Financial policy

Unit weights have up to three decimals; rupee inputs have two. Decimal arithmetic is converted to integer paise, rounded half up per component before summation. Net = (gross − stone − deduction) × quantity. Percentage making and wastage use metal value; fixed making/stone/other charges are per piece; discount is per line. Tax uses a shop-configured HSN rate effective for the IST business date. There is no default GST percentage. Have a qualified adviser validate the classification and statutory invoice format. Dashboard metal rates are shop-entered effective prices, not a live commodity feed.

Finalization uses the current transaction's product/rate/branding snapshots. Invoice, counter, stock deltas, linked payment, receivable posting, draft removal and audit entry commit together. Retrying the same ID and content returns the original document number. Changed content with the same ID is rejected. Estimates do not post; authorized conversion is marked once. Full reversal retains the document and creates offsetting records. Pending/offline financial writes are not supported. Profit excludes tax and uses recorded unit purchase costs; never label revenue as profit.

Drafts preserve the selected settlement, amount actually received (including ₹0) and payment mode. New sales start at ₹0; selecting **Paid in full** explicitly or entering the exact positive total is required to mark full payment. Reopening never tops up the amount, even if prices change. For an older draft without a settlement field, the stored amount is preserved. If changing a saved payment, save the draft again before finalizing. Confirm the displayed total, received amount, mode and outstanding balance: the server recalculates the bill and checks it against both the confirmation and any saved draft before posting. Deploy the updated client and Functions together; new submissions require explicit payment intent and confirmation. Existing issued invoices are not rewritten.

## Test / capacity boundary

```sh
npm test
npx playwright install chromium && npx playwright test
npm --prefix functions run build
# JDK 21 required; this starts only the local emulators and uses a demo- project.
npx firebase-tools@15.36.0 emulators:exec --only auth,firestore,functions --project demo-aurum 'npm --prefix functions run test:emulator'
```

The emulator integration suite uses real emulated owner ID tokens for tenant requests. Company business-operation fixtures invoke an in-process verified-MFA context; a real administrator MFA challenge flow is still a staging acceptance test. Mobile browser tests are not Android hardware or printer tests. The checkout does not contain privileged project configuration.

Workspace reads are bounded snapshots (2,000 per displayed collection) and the console explicitly rejects more than 500 records per registry. This is an early shop pilot, not a measured thousand-shop capacity claim. Add server pagination, incrementally aggregated reporting, retention/compaction, disaster recovery and load tests before commercial rollout. The next business slice is purchases → supplier ledger → independently reconcilable stock and payment reports.

## Issued documents, printing and Android Back

- Set the **shop name, logo, contact details** in Shop profile; select **Billing & print** for the shop's number prefix, paper, owner line, thank-you, exchange policy and terms. These are snapshots for **new** documents, not global overrides on reprints. Empty optional fields are omitted. Never copy an official mark into the shop logo without permission.
- The header's independent certification slot is **empty by default**. A shop-entered HUID or logo is not proof. Only the trusted provider, after checking documentary permission for the exact tenant, artwork, usage and dates, may provision `tenants/{tenantId}/settings/hallmarkAuthorization`. Its restricted schema and issue-time check are in `functions/src/core/authorization.ts`. There is no owner write path, external verification claim, built-in BIS image or automatic item certification. Revoking a permit stops it on new bills; it does not rewrite issued documents.
- **Estimate** is a quotation, not a final bill or a payment. Convert once to post a sale. **Non-GST bill** adds no tax. For a **GST tax invoice**, enter the actual domestic place of supply. The supplier registration state and effective HSN rule determine IGST or CGST + SGST/UTGST; each component is rounded in paise per line. Overseas/SEZ, special supply rules and tax returns/e-invoicing are outside this domestic-goods flow. Historical aggregate-only GST remains aggregate; no split is invented.
- **Split** under Payment mode accepts two or more positive tenders. Their sum is the single amount received. Save a changed draft allocation before finalizing. **Balance** is for this bill; **account outstanding/credit after document** also includes the snapshotted previous customer account. Do not add the individual tenders to total received a second time. Old single-mode bills reprint with their recorded payment only.
- **Advance receipt**: select a named customer, state the purpose and enter the deposit. Posts a receipt and an account credit, not a sale, item movement or a second collection when a bill is issued. Dues are netted at customer-account level; no line-level matching/refund gateway is implied. **Credit note**: use the existing full-sale reversal with a reason and arrange the matching refund if money was received. Open **View credit note** on the reversed bill. The numbered note references the original and shares its one offsetting stock/payment/ledger transaction. No partial returns, independent negative sales or backfilled historic notes.
- A4 = 210 × 297 mm, A5 = 148 × 210 mm. The 80/58 mm receipts paginate on 200 mm lengths, not an infinite canvas or Letter sheet. The web print stylesheet sets **page media**, not just content width; Android passes ISO/custom media to the system print service. Check the selected paper before saving/printing: individual drivers may substitute supported stock, margins or scaling. **Share summary** shares text, not a PDF.
- Android Back closes the topmost UI first. Stay on a dirty edit with **Continue Editing**, or explicitly discard it. Screen history is in-app only; fresh deep links fall back to a parent. Only the active shop Dashboard offers double-Back to exit (two seconds); a native print sheet handles its own Back. Login/activation remain security gates. No offline draft storage or licensing bypass is introduced.
- Browser acceptance emits the four real PDFs as `invoice-layout-pdfs`. The Android workflow installs its actual debug APK on a disposable API 35 emulator, sends `adb` Back events and captures the separate Android print sheet. These are not tests of a physical thermal printer.
