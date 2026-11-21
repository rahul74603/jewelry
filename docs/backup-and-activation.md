# Offline backup / restore + offline activation

MediSmart-v2-style backup and activation, adapted for Aurum. Branch:
`feature/offline-backup-activation`.

## Backup & restore

- **What it is:** a versioned JSON file (`{format: "aurum-backup",
  version: 1}`) holding the whole workspace — profile, products,
  customers, rates, invoices, drafts, loans (the 7 real collections in
  `functions/src/core/model.ts`) — plus a SHA-256 checksum over
  canonical JSON (`stableJson`) and per-collection counts. See
  `src/lib/backup.ts`. Backups made before the Girvi & EMI module have
  no loans collection and still restore — the restore fills
  `loans: []` for them.
- **Where it lives:** Settings → “Backup & restore”. **Backup now**
  (one tap) writes the file straight to the phone’s
  `Documents/AurumBackup/` folder — no share sheet, no picking a
  folder. If that write fails, it falls back to the Share sheet (and
  says so). On the web build it is a plain download.
- **One file per year, overwritten daily.**
  `aurum-backup-<shop>-<YYYY>.json` is the same file every day within
  the year — each backup overwrites it in place, so there is always
  exactly one current file and the whole shop history stays inside
  it. A new file starts each January; old years stay listed in
  Settings. No pile of daily files.
- **Daily, on open — NOT at 02:00.** Like MediSmart, the check runs
  when the app opens (`src/pages/Dashboard.tsx` shows a reminder when
  today’s backup is pending; the toggle is in Settings). An exact 02:00
  backup needs a native Android WorkManager scheduler plus a
  battery-optimisation exemption. That is **not built**.
- **Google Drive cloud backup (automatic).** Settings → “Google
  Drive cloud backup” → “Connect Google Drive folder” opens the
  Android folder picker once; the shopkeeper picks a folder in
  Google Drive (needs the Google Drive app on the phone). After
  that, every backup also writes the same yearly file into that
  Drive folder (overwritten in place), and the local copy in
  `Documents/AurumBackup/` is always kept too — so the backup
  survives a lost, changed or reset phone. No Google sign-in, no
  Google Cloud project, no OAuth client: the folder is picked
  through the Storage Access Framework and the permission is kept
  by the native `DriveFolder` plugin
  (`android/app/src/main/java/com/aurum/jewellery/DriveFolderPlugin.java`,
  `src/lib/cloudBackup.ts`). The picker is opened with My Drive as
  the initial location (the Drive provider's roots are queried for
  the "My Drive" root; if that query comes back empty — it can do
  so even with Drive installed, when Drive was never opened or
  signed in — the fallback is My Drive's well-known "root"
  document, and the picker still opens so the shopkeeper can reach
  Drive from its drawer menu; a missing root is never read as
  "Drive is missing"). A folder outside Google Drive is rejected
  with a clear message, so a local folder can never be saved as
  the "Drive" folder and silently make cloud backup phone-only.
  The "last cloud backup" date belongs to the currently connected
  folder — changing the folder clears it, so it never shows an
  upload that went to the previous folder — and a failed upload
  shows its specific reason in Settings (could not create the
  file, write failed, permission lost), instead of only "pending".
  SAF was chosen because an Android
  OAuth client is tied to the package name + SHA-1 signing
  fingerprint, and CI builds are DEBUG APKs with a disposable debug
  signing key, so no registered OAuth client could ever match them
  (the Drive REST API fails with `UnregisteredOnApiConsole` for
  exactly this reason). If the folder is deleted in Drive or its
  permission is revoked, the next backup marks the cloud copy
  pending and Settings asks to pick the folder again; the local
  backup never fails because the cloud failed. Restore can read the
  file back from Drive (“Restore from Google Drive”) — it goes
  through the same validation as a local file.
- **No Gmail backup.** Gmail cannot take an attachment via a `mailto:`
  link, so Gmail is not offered. To keep a second copy elsewhere,
  share the file to WhatsApp yourself from the Share sheet (the
  secondary “Share sheet” option in Settings).
- **Restore is real.** Settings → “Restore from a backup file”: pick
  a file, it is validated first (format, version, SHA-256 checksum,
  record counts), then one confirmation applies it —
  `perform("restore", workspaceData)` replaces the whole workspace
  (all 7 collections) via the `"restore"` Action in
  `functions/src/core/model.ts`, a `demoMutation` case, and a server
  handler in `functions/src/server/workspace.ts` (which also rebuilds
  voided/converted flags and bumps document counters past the highest
  restored number). A file that fails validation can never wipe the
  shop. The Drive copy restores the same way — “Restore from Google
  Drive” downloads the yearly file from the connected folder and
  validates it first.
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

- The salt is Ajay's chosen short secret `Musebhai`
  (`MASTER_SECRET_PLACEHOLDER` in `src/lib/offlineActivation.ts`),
  set in the 2026-11-20 update. A short public secret means the lock
  is light — anyone reading the repo can generate keys. A long random
  secret held off-git would be the real lock; Ajay chose short.
- The **same** secret must be in the local app build and the master
  build, or codes and keys will not match.
- MediSmart’s own salt was deliberately **not** copied or quoted here.

## Tests

`tests/backup.test.ts` (8 tests), `tests/restore.test.ts` (3 tests),
`tests/cloudBackup.test.ts` (26 tests) and
`tests/offlineActivation.test.ts`
(9 tests): backup creation/validation, tamper rejection, daily-due
logic, one-file-per-year naming and per-year history, the
6-collection shape; whole-workspace restore (valid backup round-trips,
bad payloads throw, voided flags survive); cloud backup (folder pick,
yearly-file upload, pending/retry on failure, permission-lost
handling, restore from Drive, disconnect, rejection of a folder
outside Drive); code/key derivation,
verification, wrong-key/secret rejection, timing-safe compare, the
confirmed developer WhatsApp number, the master-app-key → user-app
round-trip (two-app flow), and the licensed-flag helpers being safe
without browser storage.

## Build notes

- 2026-11-21: Run #24's demo job failed at the Gradle packaging step
  — the runner could not download
  `org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24` (required by
  `:capacitor-filesystem`). The master job on the same commit passed,
  and the artifact is a long-published release, so this was a transient
  runner-side download failure; re-triggered as Run #25 with no code
  change.
