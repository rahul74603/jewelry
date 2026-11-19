# Phase 0 — repository audit and delivery plan

Baseline: `c466592e7ecbf5828676ec46deea9b6e1cf1d2e3`, reviewed 18 November 2026. The complete tracked tree consists of a ten-byte README (`# jewelry`). The working tree contains no other application files. The attached screenshot is a repository screenshot, not an invoice template.

## A. Current architecture

No application, package manager manifest, platform project, hosting configuration, or CI exists. This is a greenfield implementation, not a migration.

## B. Existing features

None beyond repository initialization. No existing shop information or functionality needs to be migrated.

## C. Missing modules

All admin, jeweller, billing, inventory, accounts, reporting, packaging and backup modules in the brief are absent at baseline. An interactive sample workspace is useful for phone evaluation but is not evidence of production acceptance.

## D. Security gaps

No authentication, authorization, tenant boundary, database/storage rules, transaction validation, audit log, abuse limit or security tests exist. No privileged credentials are present. Do not launch a cloud tenant before these controls and a deployment review.

## E. Database gaps

No database is configured. Use per-tenant subcollections, derive tenant identity from verified Firebase claims, and deny direct client database/storage access. Route privileged operations through authenticated Functions. Do not grant a company administrator general access to tenant financial records.

## F. License architecture

There is no existing lock system. Use server-issued, short-lived, hash-stored activation tokens; consume them and allocate device slots in one transaction. Register a P-256 public key and require a signed, expiring, single-use challenge for workspace reads and writes. Check live tenant/license/device status on those requests. Android uses Android Keystore; browser CryptoKeys are a weaker, per-browser-profile binding. A default Basic license has one active device. Enforce live access before adding offline capabilities.

## G. Recommended implementation plan

1. Establish a shared TypeScript model and precise billing engine, isolated disposable fixtures, responsive jeweller workspace and explicit live/demo build boundary.
2. Implement company-only provisioning and licensing, deny-by-default rules, proof-checked tenant APIs, device transfer/revocation, transaction-safe invoice posting and tests. Configure and validate against the operator's Firebase project separately.
3. Deliver an Android phone-check pipeline early, with a single-file APK download (not just a zipped Actions artifact). It is a debug/test distribution, not a production-signed store release.
4. Follow with purchase, returns, exchanges, repair, order, richer accounting, backup/restore, localization, Windows secure storage/packaging, offline reconciliation and hardware testing. Release only after real-device, cloud, tax and recovery acceptance checks.

See `delivery-status.md` for the implementation/verification boundary after this pass. No pre-existing application files have been removed.
