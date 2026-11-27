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
import { transferServerBackup } from "../lib/serverBackup";
import { err } from "../lib/format";
import { Modal, Problem } from "./ui";

/**
 * Licenses dashboard for the Master app — a Shell route in master
 * mode (/master/licenses). Do NOT mount it inside the customer
 * (Demo) app.
 *
 * Server presence list — every device that ever sent a heartbeat
 * (Device ID, shop name, model, app version, last seen, status)
 * with Block/Unblock — plus, below it, the local issued-keys
 * register with tap-to-reveal key view.
 *
 * When the license server is not configured in this build, the server list
 * shows a clear "not connected" state instead of failing — the
 * Master app still works offline for key generation.
 */

/**
 * One row of the local issued-keys register (src/lib/issuedKeys.ts,
 * localStorage `aurum:issued-keys-v1`). Carries the FULL row —
 * including the unlock key, device code, buyer number and IMEI.
 *
 * Policy (Ajay, 2026-11-26): the key IS shown in the Master app,
 * but only on tap-to-reveal — hidden by default behind a "Key
 * dikhao" button in the row's detail view. That is safe because
 * the Master app runs only on Ajay's own phone, and the register
 * already exports keys in CSV/text anyway.
 */
export type LocalRegisterRow = {
  id?: string;
  deviceId: string;
  shopName?: string;
  model?: string;
  issuedAt?: number;
  buyerNumber?: string;
  deviceCode?: string;
  imei?: string;
  unlockKey?: string;
  note?: string;
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
 * runtime and rejects → caught → section hidden). Carries the
 * FULL row (buyer number, device code, IMEI, unlock key, note):
 * the key is shown only on tap-to-reveal in the detail view —
 * the Master app runs only on Ajay's own phone, and the register
 * already exports keys in CSV/text.
 */
async function loadLocalRegister(): Promise<LocalRegisterRow[]> {
  const moduleName = "issuedKeys";
  const mod = (await import(`../lib/${moduleName}`)) as {
    loadIssuedKeys?: () => Array<{
      id?: string;
      deviceId?: string;
      buyerName?: string;
      buyerNumber?: string;
      deviceCode?: string;
      model?: string;
      imei?: string;
      unlockKey?: string;
      note?: string;
      date?: string;
    }>;
  };
  const rows = mod.loadIssuedKeys?.() ?? [];
  return rows.map((r) => ({
    id: r.id ? String(r.id) : undefined,
    deviceId: String(r.deviceId ?? ""),
    shopName: r.buyerName ? String(r.buyerName) : undefined,
    model: r.model ? String(r.model) : undefined,
    issuedAt: r.date ? Date.parse(r.date) : undefined,
    buyerNumber: r.buyerNumber ? String(r.buyerNumber) : undefined,
    deviceCode: r.deviceCode ? String(r.deviceCode) : undefined,
    imei: r.imei ? String(r.imei) : undefined,
    unlockKey: r.unlockKey ? String(r.unlockKey) : undefined,
    note: r.note ? String(r.note) : undefined,
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
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState("");
  // Backup transfer: the old Device ID typed per row (new phone
  // after a reset / replacement — its cloud backup still lives
  // under the old Device ID).
  const [transferFrom, setTransferFrom] = useState<Record<string, string>>(
    {},
  );
  // Issued-keys detail: the tapped row, with its unlock key hidden
  // behind "Key dikhao" until Ajay taps to reveal it.
  const [selected, setSelected] = useState<LocalRegisterRow | null>(null);
  const [keyShown, setKeyShown] = useState(false);

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

  /**
   * Backup transfer (Master only): copy this phone's cloud backup
   * from the OLD Device ID typed in the row, so a shopkeeper whose
   * phone was reset / replaced can restore on the new phone. Same
   * window.confirm pattern as Block/Unblock/Remove above; success
   * is an inline note like the error line, failure goes to it.
   */
  const transferBackup = async (d: OfflineDeviceRow) => {
    const oldId = (transferFrom[d.deviceId] ?? "").trim();
    if (!oldId) return;
    if (
      !window.confirm(
        `Is phone ka backup purane Device ID ${oldId} se is phone par copy karen?`,
      )
    )
      return;
    setBusyId(d.deviceId);
    setError("");
    setNote("");
    try {
      const res = await transferServerBackup(oldId, d.deviceId);
      const count = res.copied.length;
      setNote(
        `Backup transfer ho gaya — ${count} file${count === 1 ? "" : "s"} copy hui. Is phone par ab "Cloud backup se restore" se restore karen.`,
      );
      setTransferFrom((m) => ({ ...m, [d.deviceId]: "" }));
    } catch (e) {
      setError(err(e));
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
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
            {note && <p className="muted">{note}</p>}
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
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        flexWrap: "wrap",
                        marginTop: "8px",
                      }}
                    >
                      <input
                        value={transferFrom[d.deviceId] ?? ""}
                        onChange={(e) =>
                          setTransferFrom((m) => ({
                            ...m,
                            [d.deviceId]: e.target.value,
                          }))
                        }
                        placeholder="Purana Device ID (XXXX-XXXX-XXXX)"
                        aria-label="Purana Device ID"
                        style={{ flex: "1 1 200px", minWidth: 0 }}
                      />
                      <button
                        className="btn outline"
                        disabled={
                          busyId === d.deviceId ||
                          !(transferFrom[d.deviceId] ?? "").trim()
                        }
                        onClick={() => void transferBackup(d)}
                      >
                        Transfer
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
            <p className="muted">
              Tap a row to see the full details — the unlock key stays
              hidden until you tap “Key dikhao”.
            </p>
            {register.length === 0 ? (
              <p className="muted">No keys issued yet on this Master app.</p>
            ) : (
              <div>
                {register.map((r, i) => (
                  <button
                    key={r.id ?? `${r.deviceId}-${i}`}
                    type="button"
                    className="muted"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      borderBottom: "1px solid var(--hatch-widget-border, #ddd)",
                      padding: "8px 0",
                      cursor: "pointer",
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                    onClick={() => {
                      setSelected(r);
                      setKeyShown(false);
                    }}
                  >
                    {displayDeviceId(r.deviceId)}
                    {r.shopName ? ` · ${r.shopName}` : ""}
                    {r.model ? ` · ${r.model}` : ""}
                    {r.issuedAt ? ` · ${fmtTime(r.issuedAt)}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.shopName || "Issued key"}
        description="Full details for this issued key."
      >
        {selected && (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <p>
              <strong>Buyer:</strong> {selected.shopName || "—"}
            </p>
            <p>
              <strong>Number:</strong> {selected.buyerNumber || "—"}
            </p>
            <p>
              <strong>Device code:</strong>{" "}
              <code>{selected.deviceCode || "—"}</code>
            </p>
            <p>
              <strong>Device ID:</strong>{" "}
              <code>{selected.deviceId || "—"}</code>
            </p>
            <p>
              <strong>Model:</strong> {selected.model || "—"}
            </p>
            <p>
              <strong>IMEI:</strong> {selected.imei || "—"}
            </p>
            <p>
              <strong>Date:</strong>{" "}
              {selected.issuedAt ? fmtTime(selected.issuedAt) : "—"}
            </p>
            {selected.note && (
              <p>
                <strong>Note:</strong> {selected.note}
              </p>
            )}
            <p>
              <strong>Unlock key:</strong>{" "}
              {keyShown ? (
                <code>{selected.unlockKey || "—"}</code>
              ) : (
                "••••••••"
              )}{" "}
              <button
                type="button"
                className="btn outline"
                style={{ marginLeft: 6 }}
                onClick={() => setKeyShown((v) => !v)}
              >
                {keyShown ? "Key chhupao" : "Key dikhao"}
              </button>
            </p>
            {keyShown && selected.unlockKey && (
              <p>
                <button
                  type="button"
                  className="btn outline"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(selected.unlockKey!)
                      .catch(() => {
                        // Clipboard unavailable — the key is visible
                        // above, so nothing is lost.
                      })
                  }
                >
                  Copy key
                </button>
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
