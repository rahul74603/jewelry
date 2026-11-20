# Offline backup / restore + offline activation

MediSmart-v2-style backup and activation, adapted for Aurum. Branch:
`feature/offline-backup-activation`.

## Backup & restore

- **What it is:** a versioned JSON file (`{format: "aurum-backup",
  version: 1}`) holding the whole workspace — profile, products,
  customers, rates, invoices, drafts (the 6 real collections in
  `functions/src/core/model.ts`) — plus a SHA-256 checksum over
  canonical JSON (`stableJson`) and per-collection counts. See
  `src/lib/backup.ts`.
- **Where it lives:** Settings → “Backup & restore”. Export shares the
  file via the system share sheet or downloads it; the last 7 backups
  are listed, with the last-backup date.
- **Daily, on open — NOT at 02:00.** Like MediSmart, the check runs
  when the app opens (`src/pages/Dashboard.tsx` shows a reminder when
  today’s backup is pending; the toggle is in Settings). An exact 02:00
  backup needs a native Android WorkManager scheduler plus a
  battery-optimisation exemption. That is **not built**.
- **Gmail / WhatsApp / Drive are manual picks, not automatic sends.**
  Gmail cannot take an attachment via a `mailto:` link, and Google
  Drive needs a one-time sign-in. The export opens the Share sheet (or
  downloads the file) and the shopkeeper picks Gmail, WhatsApp or
  Drive there. There is no background auto-upload.
- **Restore is PREVIEW-ONLY.** Choosing a backup file validates it
  (format, version, SHA-256 checksum, record counts) and shows a
  preview of what it contains. Applying the restore is **not wired**:
  it needs a new `perform("restore", workspaceData)` hook — an
  `"restore"` Action in `functions/src/core/model.ts`, a `demoMutation`
  case, and a server handler in `functions/src/server/workspace.ts`.
  Until that hook exists, never claim a restore applies data.
- **Shop details:** the shopkeeper enters shop details in Settings →
  “Shop profile” (the existing form). The backup includes that profile.
  No duplicate shop-details form was added.

## Offline activation (MediSmart v2) — full-screen lock + separate master app

MediSmart v2 (`lib/services/license_service.dart`) uses a **per-install
UUID** in SharedPreferences — **not a MAC address** (Android MACs are
randomised/unreliable). A reinstall or cleared storage means a new
install id and a fresh activation.

```
code = SHA256(installId | salt | CODE)   first 8 chars, uppercase
key  = SHA256(code      | salt | KEY)    first 8 chars, uppercase
```

- **User app — full-screen lock** (`src/components/ActivationGate.tsx`,
  wired at the app root in `src/main.tsx`): on first launch the app
  opens BEHIND NOTHING — only the activation screen shows, in both
  demo and live modes. Big device code, “Send this code to developer
  on WhatsApp” (opens `wa.me/916263396446` with the code prefilled —
  developer number confirmed by Ajay: **+91 6263396446**), 8-character
  key input + Verify. Until the correct key is entered, the app does
  not open. On success the device is marked licensed locally and the
  app opens directly on later launches. Reinstall / cleared storage
  means a new code and re-activation, exactly like MediSmart.
- **Master app — separate build** (`src/Master.tsx`,
  `VITE_APP_MODE=master`): renders ONLY the key tool — paste the
  shopkeeper’s device code, enter the master secret (kept in memory
  only, never stored), Generate key, Copy. It uses the exact same
  `generateUnlockKey` as the Company console’s “Offline unlock” tab,
  so keys match the user app’s `verifyUnlockKey`. No billing, no demo
  data, no sign-in. The master APK has its own package
  (`com.aurum.jewellery.master`, label “Aurum Master”), so it installs
  side-by-side with the user app on one phone — the developer can test
  the whole code → key → unlock flow on a single device.
- **Builds** (`.github/workflows/android-phone.yml`): the same push
  builds three APKs — `Aurum-Customer-arm64.apk` and
  `Aurum-Customer-armeabi.apk` (user app, demo mode) and
  `Aurum-Master-arm64.apk` (master app, arm64 only — the developer
  has the latest phone) — and publishes them in the same prerelease.
- **Install id** (`src/lib/offlineActivation.ts` `getInstallId()`):
  prefers Aurum’s existing device fingerprint — SHA-256 of the P-256
  public key (Android Keystore on device, IndexedDB in the browser;
  `src/lib/device.ts` `deviceIdentity`) — with a locally stored UUID
  fallback when no signed-in uid / keystore is available. The root
  gate runs before any sign-in, so it uses the stored-UUID install id.
- **The offline key unlocks the device LOCALLY only.** It does not
  grant the live server workspace — live billing still needs internet
  verification (`LicensedShop` in `src/Live.tsx`).

## Master secret — must be decided before distribution

- The salt is currently the placeholder `CHANGE-ME-BEFORE-DISTRIBUTION`
  (`MASTER_SECRET_PLACEHOLDER` in `src/lib/offlineActivation.ts`).
- The developer must replace it with one long random secret, held
  off-git (developer machine / password manager, never in the repo).
- The **same** secret must be in the local app build and the master
  build, or codes and keys will not match.
- MediSmart’s own salt was deliberately **not** copied or quoted here.

## Tests

`tests/backup.test.ts` (8 tests) and `tests/offlineActivation.test.ts`
(9 tests): backup creation/validation, tamper rejection, daily-due
logic, last-7 history, the 6-collection shape; code/key derivation,
verification, wrong-key/secret rejection, timing-safe compare, the
confirmed developer WhatsApp number, the master-app-key → user-app
round-trip (two-app flow), and the licensed-flag helpers being safe
without browser storage.
