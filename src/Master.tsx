import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";
import {
  generateUnlockKey,
  DEVELOPER_WHATSAPP,
} from "./lib/offlineActivation";
import { err } from "./lib/format";
import { Brand, Field, Problem } from "./components/ui";

/** Build version baked in by CI (VITE_APP_VERSION=1.0.<run number>);
 * "dev" for local builds without the variable. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

/**
 * Master app (VITE_APP_MODE=master) — the developer's key tool, as a
 * separate build from the user app.
 *
 * Renders ONLY this screen: paste a shopkeeper's 8-character device
 * code, enter the master secret (kept in memory only, never stored),
 * generate the unlock key with the exact same generateUnlockKey the
 * Company console's "Offline unlock" tab uses, and copy it to send
 * back on WhatsApp. No billing, no demo data, no sign-in.
 *
 * The key only matches when the same master secret is in the user app
 * build and here. The secret is Ajay's chosen short secret, kept in
 * git by his choice — and it is never displayed anywhere in this app.
 */
export default function Master() {
  const [deviceCode, setDeviceCode] = useState(""),
    [masterSecret, setMasterSecret] = useState(""),
    [unlockKey, setUnlockKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <Brand />
        <section className="auth-card">
          <div className="eyebrow">
            <i />
            MASTER · OFFLINE ACTIVATION
          </div>
          <h1>Generate unlock key</h1>
          <p className="muted">
            A shopkeeper on a new device sends you their 8-character
            device code on WhatsApp (+91 {DEVELOPER_WHATSAPP.slice(2)}).
            Paste it here with the master secret to generate their unlock
            key, then send the key back. The key unlocks that device
            locally only.
          </p>
          <div className="auth-form">
            <Field label="Device code from the shopkeeper">
              <input
                value={deviceCode}
                maxLength={8}
                autoComplete="off"
                placeholder="e.g. A1B2C3D4"
                onChange={(e) => setDeviceCode(e.target.value.toUpperCase())}
              />
            </Field>
            <Field
              label="Master secret"
              hint="Kept in memory only — never stored or sent anywhere."
            >
              <input
                type="password"
                value={masterSecret}
                autoComplete="off"
                placeholder="Enter master secret"
                onChange={(e) => setMasterSecret(e.target.value)}
              />
            </Field>
            <Problem message={error} />
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setError("");
                setUnlockKey("");
                setCopied(false);
                if (!masterSecret) {
                  setError("Enter the master secret.");
                  return;
                }
                setBusy(true);
                try {
                  setUnlockKey(
                    await generateUnlockKey(deviceCode, masterSecret),
                  );
                } catch (e) {
                  setError(err(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <KeyRound size={15} />
              {busy ? "Generating…" : "Generate unlock key"}
            </button>
            {unlockKey && (
              <div className="qr-code">
                <div className="code-box">{unlockKey}</div>
                <button
                  className="btn outline"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(unlockKey)
                      .then(() => setCopied(true))
                      .catch((e) => setError(err(e)))
                  }
                >
                  <Copy size={14} />
                  {copied ? "Copied!" : "Copy key"}
                </button>
                <p className="footnote">
                  Send this key back to the shopkeeper on WhatsApp. It works
                  only for the device code above.
                </p>
              </div>
            )}
            <p className="footnote">
              The master secret is known only to the developer — it is
              never shown here. Codes and keys only match when the same
              secret is in the user app build and here.
            </p>
            <p className="footnote">
              Aurum Master · App version {APP_VERSION}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
