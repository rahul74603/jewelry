import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import {
  codeForInstallId,
  getInstallId,
  getDeviceId,
  verifyUnlockKeyForDevice,
  markOfflineLicensed,
  developerWhatsAppLink,
  MASTER_SECRET_PLACEHOLDER,
  DEVELOPER_WHATSAPP,
} from "../lib/offlineActivation";
import { err } from "../lib/format";
import { useToast } from "../lib/store";
import { Brand, Field, Problem } from "./ui";

/**
 * Full-screen offline activation lock (MediSmart-style).
 *
 * Rendered at the app root (src/main.tsx) in the user modes (demo +
 * live) BEFORE the app itself: until this device is unlocked, nothing
 * behind the gate opens. The shopkeeper sees the big device code AND
 * the Device ID, sends both to the developer on WhatsApp (or sends a
 * screenshot of this screen), and enters the unlock key the developer
 * generates in the master app. On success the device is marked
 * licensed locally and the app opens.
 *
 * The gate runs before any sign-in, so the install id is the locally
 * stored UUID (getInstallId() with no uid) — stable per install, and
 * the code shown here is exactly the code the master key is generated
 * from. The Device ID comes from the hardware-backed keystore
 * fingerprint (getDeviceId()), so the key only unlocks THIS phone.
 * A reinstall / cleared storage means a new install id and Device ID
 * and a fresh activation, exactly like MediSmart.
 *
 * The offline key unlocks the device LOCALLY only. It does NOT grant
 * the live server workspace — live billing still needs internet
 * verification (src/Live.tsx LicensedShop).
 */
export default function ActivationGate({
  onUnlocked,
}: {
  onUnlocked: () => void;
}) {
  const notify = useToast();
  const [code, setCode] = useState(""),
    [deviceId, setDeviceId] = useState(""),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      getInstallId().then((id) =>
        codeForInstallId(id, MASTER_SECRET_PLACEHOLDER),
      ),
      getDeviceId(),
    ])
      .then(([c, d]) => {
        if (alive) {
          setCode(c);
          setDeviceId(d);
        }
      })
      .catch((e) => {
        if (alive) setError(err(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <Brand />
        <section className="auth-card">
          <div className="eyebrow">
            <i />
            ACTIVATION REQUIRED
          </div>
          <h1>Unlock Aurum on this device</h1>
          <p className="muted">
            First launch on a new device? Send your device code and
            Device ID to the developer and enter the unlock key they send
            back. The app stays locked until then — the key only works on
            this phone.
          </p>
          <div className="auth-form">
            <p className="code-label">Device code</p>
            <div className="code-box">{code || "Loading device code…"}</div>
            <p className="code-label">Device ID</p>
            <div className="code-box">
              {deviceId || "Loading Device ID…"}
            </div>
            <a
              className="btn outline"
              href={
                code && deviceId
                  ? developerWhatsAppLink(code, deviceId)
                  : undefined
              }
              target="_blank"
              rel="noreferrer"
            >
              Send code &amp; Device ID to developer on WhatsApp (+91{" "}
              {DEVELOPER_WHATSAPP.slice(2)})
            </a>
            <Field label="Unlock key from developer">
              <input
                value={key}
                maxLength={8}
                autoComplete="off"
                placeholder="8-character key"
                onChange={(e) => setKey(e.target.value.toUpperCase())}
              />
            </Field>
            <Problem message={error} />
            <button
              className="btn primary"
              disabled={busy || !code || !deviceId || key.length !== 8}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const ok = await verifyUnlockKeyForDevice(
                    code,
                    deviceId,
                    key,
                    MASTER_SECRET_PLACEHOLDER,
                  );
                  if (!ok)
                    throw Error(
                      "That key does not match this device code and Device ID.",
                    );
                  markOfflineLicensed();
                  notify("Device unlocked offline.");
                  onUnlocked();
                } catch (e) {
                  setError(err(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <KeyRound size={15} />
              {busy ? "Verifying…" : "Verify unlock key"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
