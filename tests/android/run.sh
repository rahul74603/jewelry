#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/phone
adb install -r phone/aurum-phone-preview.apk
set +e
node --test tests/android/phone.cjs 2>&1 | tee test-results/phone/results.tap
result=${PIPESTATUS[0]}
set -e
grep -E '^# (SPOOLER|WebView:|pass |fail )' test-results/phone/results.tap | while IFS= read -r line; do printf '::notice title=Device evidence::%s\n' "$line"; done || true
if [[ "$result" -ne 0 ]]; then
  grep -E '^not ok|error:|Timed out:|ERR_ASSERTION|Expected|failureType|hook failed' test-results/phone/results.tap | head -35 | while IFS= read -r line; do printf '::error title=Device acceptance::%s\n' "$line"; done || true
  adb logcat -d -s 'Capacitor/Console:E' 'chromium:E' 'AndroidRuntime:E' | tail -35 | tee test-results/phone/webview.log | while IFS= read -r line; do printf '::warning title=WebView::%s\n' "$line"; done || true
fi
exit "$result"
