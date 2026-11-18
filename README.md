# Aurum · Universal Jewellery ERP

A multi-shop jewellery workspace and a separate company licensing console. **This is a foundation/pilot, not a production-certified ERP.** The phone preview runs without credentials; real shop data requires the licensed build and a configured Firebase project.

## फ़ोन पर ऐप कैसे जाँचें

1. GitHub में **Actions → Android phone preview → Run workflow** खोलें। पहली बार workflow को default branch (`main`) में merge करना ज़रूरी है ताकि **Run workflow** बटन दिखाई दे। इस working branch पर पहला push भी preview build शुरू करता है।
2. हरा build पूरा होने पर run का **Summary → ⬇ Download Android APK** लिंक टैप करें। वैकल्पिक रूप से **Releases → Aurum · Android phone preview → Assets → `aurum-phone-preview.apk`** खोलें। यह सीधे `.apk` देता है, source-code ZIP नहीं।
3. डाउनलोड हुई APK खोलें। Android यदि पूछे तो **उसी विश्वसनीय स्रोत** को install की अनुमति दें, फिर **Install → Open** करें। Hosted runners की debug signing key बदल सकती है; update reject हो तो पुराना **preview** uninstall करें।
4. Dashboard → New invoice में item जोड़ें, draft save करें, finalize करें और inventory देखें। Demo में वास्तविक ग्राहक डेटा न डालें। Refresh/relaunch पर sample data वापस आता है।

GitHub Actions आपके फ़ोन पर अपने-आप download, install या app launch नहीं कर सकता। हर सफल run अपना अलग direct link बनाता है। Release permission बंद होने पर run के **Artifacts → aurum-phone-preview** ZIP में भी APK और SHA-256 checksum मिलते हैं। Debug APK बिक्री/Play Store distribution के लिए नहीं है।

## Run the workspace

Node 22.12+ and npm are required.

```sh
npm ci
npm run dev                 # responsive demo
npm test                    # shared financial and license policies
npm run build               # typecheck + Vite production build
npm --prefix functions ci
npm --prefix functions run build
```

- Demo: disposable fixtures in `src/lib/demo.ts`, with a visible demo indicator and sample markings on printed bills. No cloud tenant is accessed. No fake license status or localStorage license flag.
- Licensed: `VITE_APP_MODE=live`, verified Firebase identity, App Check and signed device requests. No demo fallback. Configuration and deployment checklist: [operator guide](docs/operator-guide.md).
- Android: `npm run android:sync`, then `cd android && ./gradlew :app:assembleDebug` (JDK 21, Android SDK 35). Debug package ID is distinct from the release package. A physical device with Android 6+ and an up-to-date compatible System WebView is required.

## What to review

- [Baseline audit A–G](docs/00-repository-audit.md) — the original repository contained only `# jewelry`.
- [Delivery status and release gates](docs/delivery-status.md) — what works, what was tested, what remains.
- [Operator guide](docs/operator-guide.md) — tenant boundaries, Firebase deployment, MFA, device proof and test commands.

```
src/                         Shared React web / Android workspace
functions/src/core/          Validated models, integer-paise posting, license policies
functions/src/server/        Trusted company and device-authorized tenant operations
functions/integration/       Firebase Emulator Suite isolation / race tests
android/                     Capacitor shell + Android Keystore and print bridge
.github/workflows/           Verification and direct APK distribution
```
