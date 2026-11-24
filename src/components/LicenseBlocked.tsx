import { ShieldAlert } from "lucide-react";
import { Brand } from "./ui";
import { DEVELOPER_WHATSAPP } from "../lib/offlineActivation";

/**
 * Full-screen kill-switch lock, styled like ActivationGate.
 *
 * Shown when the server has blocked this device (licenseHeartbeat
 * returned status "blocked"), and on every later launch while the
 * local `aurum:license-blocked` flag is set. It locks the whole app
 * — there is no way past it from inside the app; only the developer
 * unblocking the Device ID on the server (then one successful
 * heartbeat, or clearing the flag) re-opens it. Works fully offline
 * once the flag is set: no network is needed to show the lock.
 */
export default function LicenseBlocked() {
  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <Brand />
        <section className="auth-card">
          <div className="eyebrow">
            <i />
            DEVICE BLOCKED
          </div>
          <h1>
            <ShieldAlert size={22} style={{ verticalAlign: "-4px" }} /> This
            device is blocked
          </h1>
          <p className="muted">
            This device has been blocked by the developer. Contact Aurum
            support.
          </p>
          <div className="auth-form">
            <a
              className="btn outline"
              href={`https://wa.me/${DEVELOPER_WHATSAPP}?text=${encodeURIComponent("Namaste, my Aurum device shows blocked. Please help.")}`}
              target="_blank"
              rel="noreferrer"
            >
              Contact Aurum support on WhatsApp (+91{" "}
              {DEVELOPER_WHATSAPP.slice(2)})
            </a>
            <p className="footnote">
              Billing, stock and all shop data on this device are untouched
              — only opening the app is blocked until the developer
              unblocks this device.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
