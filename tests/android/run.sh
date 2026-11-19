#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/phone
adb install -r phone/aurum-phone-preview.apk
set +e
node --test tests/android/phone.cjs 2>&1 | tee test-results/phone/results.tap
result=${PIPESTATUS[0]}
set -e
node <<'JS'
const tap=require('fs').readFileSync('test-results/phone/results.tap','utf8');
const scenarios=[...tap.matchAll(/^(not ok|ok) (\d+) - (.+)$/gm)];console.log('::notice title=Android scenario results::'+scenarios.map(([_,s,n,t])=>`${n}. ${t}: ${s}`).join('; '));
for(const m of tap.matchAll(/^# ((?:SPOOLER|DEVICE_PDF) .+)$/gm))console.log('::notice title=Device evidence::'+m[1]);
console.log('::notice title=Device totals::'+tap.match(/^# pass .+/m)?.[0]+'; '+tap.match(/^# fail .+/m)?.[0]);
JS
if [[ "$result" -ne 0 ]]; then
  grep -E '^  error:|^    Timed out:' test-results/phone/results.tap | cut -c1-650 | head -18 | while IFS= read -r line; do printf '::error title=Device acceptance::%s\n' "$line"; done || true
  adb logcat -d -s 'Capacitor/Console:E' 'chromium:E' 'AndroidRuntime:E' | tail -35 | tee test-results/phone/webview.log | while IFS= read -r line; do printf '::warning title=WebView::%s\n' "$line"; done || true
fi
exit "$result"
