import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  displayDeviceId,
  listOfflineLicenses,
  NOT_CONFIGURED_MESSAGE,
  removeOfflineLicense,
  setOfflineLicenseStatus,
  type OfflineDeviceRow,
} from "../lib/licenseAdmin";
import { isLicenseAdminConfigured } from "../lib/licenseServer";
import { err } from "../lib/format";
import { Brand, Problem } from "./ui";

/**
 * Kill-switch dashboard for the Master app — self-contained; the
 * coordinator mounts it in Master.tsx (see report for the exact
 * wiring). Do NOT mount it inside the customer (Demo) app.
 *
 * Left: server presence list — every device that ever sent a
 * heartbeat (Device ID, shop name, model, app version, last seen,
 * status) with Block/Unblock. Right/below: the local issued-keys
 * register, IF Part 1's register module exists in this build.
 *
 * When the license server is not configured in this build, the server list
 * shows a clear "not connected" state instead of failing — the
 * Master app still works offline for key generation.
 */

export type LocalRegisterRow = {
  deviceId: string;
  shopName?: string;
  model?: string;
  issuedAt?: number;
};

/** Optional register passed in by the coordinator (Part 1's module). */
export type LicensesDashboardProps = {
  localRegister?: LocalRegisterRow[];
};

/**
 * Best-effort lazy load of Part 1's issued-keys register
 * (src/lib/issuedKeys.ts — `loadIssuedKeys()`, localStorage key
 * `aurum:issued-keys-v1`). The variable import keeps Vite from
 * failing the build when the module is absent (it resolves at
 * runtime and rejects → caught → section hidden). Only device IDs,
 * buyer names, models and issue dates are ever shown — never unlock
 * keys, device codes, phone numbers or IMEIs.
 */
async function loadLocalRegister(): Promise<LocalRegisterRow[]> {
  const moduleName = "issuedKeys";
  const mod = (await import(`../lib/${moduleName}`)) as {
    loadIssuedKeys?: () => Array<{
      deviceId?: string;
      buyerName?: string;
      model?: string;
      date?: string;
    }>;
  };
  const rows = mod.loadIssuedKeys?.() ?? [];
  return rows.map((r) => ({
    deviceId: String(r.deviceId ?? ""),
    shopName: r.buyerName ? String(r.buyerName) : undefined,
    model: r.model ? String(r.model) : undefined,
    issuedAt: r.date ? Date.parse(r.date) : undefined,
  }));
}

function fmtTime(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export default function LicensesDashboard({
  localRegister,
}: LicensesDashboardProps) {
  const connected = isLicenseAdminConfigured();
  const [devices, setDevices] = useState<OfflineDeviceRow[]>([]);
  const [register, setRegister] = useState<LocalRegisterRow[] | null>(
    localRegister ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setError("");
    if (!connected) return;
    setLoading(true);
    try {
      setDevices(await listOfflineLicenses());
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  }, [connected]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (localRegister) {
      setRegister(localRegister);
      return;
    }
    let alive = true;
    void loadLocalRegister()
      .then((rows) => {
        if (alive) setRegister(rows);
      })
      .catch(() => {
        // No register module in this build — section stays hidden.
        if (alive) setRegister(null);
      });
    return () => {
      alive = false;
    };
  }, [localRegister]);

  const toggle = async (d: OfflineDeviceRow) => {
    const next = d.status === "blocked" ? "active" : "blocked";
    if (
      !window.confirm(
        next === "blocked"
          ? `Block ${displayDeviceId(d.deviceId)} (${d.shopName || "unknown shop"})? The app on that phone will lock on its next check.`
          : `Unblock ${displayDeviceId(d.deviceId)} (${d.shopName || "unknown shop"})? The app on that phone will open again on its next check.`,
      )
    )
      return;
    setBusyId(d.deviceId);
    setError("");
    try {
      await setOfflineLicenseStatus(d.deviceId, next);
      await load();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyId("");
    }
  };

  const remove = async (d: OfflineDeviceRow) => {
    if (
      !window.confirm(
        `Remove ${displayDeviceId(d.deviceId)} (${d.shopName || "unknown shop"}) from this list? This only clears the entry here — if that phone still has the app, it will re-appear on its next heartbeat.`,
      )
    )
      return;
    setBusyId(d.deviceId);
    setError("");
    try {
      await removeOfflineLicense(d.deviceId);
      await load();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyId("");
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <Brand />
        <section className="auth-card">
          <div className="eyebrow">
            <i />
            MASTER · LICENSES DASHBOARD
          </div>
          <h1>Devices &amp; kill switch</h1>
          <p className="muted">
            Every phone that sent a heartbeat — block one and its app
            locks on its next check. Online for block/unlock and
            presence only; nothing else leaves the phone.
          </p>
          {!connected ? (
            <p className="muted">{NOT_CONFIGURED_MESSAGE} — key
            generation below still works offline. Deploy the license
            server and rebuild with the license server URL and admin
            token to enable this list.</p>
          ) : (
            <div className="auth-form">
              <button
                className="btn outline"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCw size={14} /> {loading ? "Loading…" : "Refresh"}
              </button>
              <Problem message={error} />
              <p className="muted">
                Remove is for phones that were uninstalled — it only
                clears the entry here. A phone that still has the app
                will re-appear on its next heartbeat.
              </p>
              {devices.length === 0 && !loading && !error ? (
                <p className="muted">
                  No devices have phoned home yet. A device appears here
                  after its first heartbeat (when online).
                </p>
              ) : (
                <div>
                  {devices.map((d) => (
                    <div
                      key={d.deviceId}
                      style={{
                        borderTop: "1px solid var(--hatch-widget-border, #ddd)",
                        padding: "10px 0",
                      }}
                    >
                      <p>
                        <strong>{displayDeviceId(d.deviceId)}</strong>{" "}
                        {d.status === "blocked" ? (
                          <span>
                            <ShieldAlert size={14} /> Blocked
                          </span>
                        ) : (
                          <span>
                            <ShieldCheck size={14} /> Active
                          </span>
                        )}
                      </p>
                      <p className="muted">
                        {d.shopName || "Unknown shop"}
                        {d.model ? ` · ${d.model}` : ""} ·{" "}
                        {d.appVersion || "dev"}
                      </p>
                      <p className="muted">
                        Last seen {fmtTime(d.lastSeen)} ·{" "}
                        {d.heartbeatCount} check
                        {d.heartbeatCount === 1 ? "" : "s"}
                      </p>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          flexWrap: "wrap",
                        }}
                      >
                        <button
                          className="btn outline"
                          disabled={busyId === d.deviceId}
                          onClick={() => void toggle(d)}
                        >
                          {d.status === "blocked" ? "Unblock" : "Block"}
                        </button>
                        <button
                          className="btn outline"
                          disabled={busyId === d.deviceId}
                          onClick={() => void remove(d)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {register !== null && (
            <div className="auth-form">
              <h2>Issued keys (this device)</h2>
              {register.length === 0 ? (
                <p className="muted">No keys issued yet on this Master app.</p>
              ) : (
                <div>
                  {register.map((r) => (
                    <p key={r.deviceId} className="muted">
                      {displayDeviceId(r.deviceId)}
                      {r.shopName ? ` · ${r.shopName}` : ""}
                      {r.model ? ` · ${r.model}` : ""}
                      {r.issuedAt ? ` · ${fmtTime(r.issuedAt)}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
