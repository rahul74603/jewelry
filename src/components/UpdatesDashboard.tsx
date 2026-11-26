import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  displayDeviceId,
  deriveReleaseStatus,
  listOfflineLicenses,
  listUpdateRecords,
  NOT_CONFIGURED_MESSAGE,
  pushRelease,
  type OfflineDeviceRow,
  type UpdateRow,
} from "../lib/licenseAdmin";
import { isLicenseAdminConfigured } from "../lib/licenseServer";
import { err } from "../lib/format";
import { Problem } from "./ui";

/**
 * Updates — staged rollout control (Master app only, a Shell route
 * in master mode: /master/updates).
 *
 * A new version goes to EVERYONE eventually — but first ONLY to
 * Ajay's own test phone, so he can check it is normal. When
 * satisfied he taps ONE button here ("Sabko update bhejo") and it
 * goes to all shops. Until then no shop sees or gets the update.
 *
 * The staged version is the newest version across GET
 * /admin/updates; it is "pushed" when every record for that
 * version has allowed=1, otherwise "testing". Below it a
 * READ-ONLY per-device list (shop name/model from the heartbeat
 * list + "Update mil gaya" / "Baaki hai" from each device's
 * allowed flag). No per-device toggles, no mandatory updates —
 * every pushed update is a normal optional update.
 *
 * When the license server is not configured in this build, the
 * section shows a clear "not connected" state instead of failing.
 */

function fmtTime(ms: number): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "—";
  }
}

export default function UpdatesDashboard() {
  const connected = isLicenseAdminConfigured();
  const [devices, setDevices] = useState<OfflineDeviceRow[]>([]);
  const [updates, setUpdates] = useState<UpdateRow[] | null>(null);
  const [updatesError, setUpdatesError] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    // Rollout records load separately: if the server does not have
    // the /admin/updates route yet, the devices list above must
    // still work — only this section shows the error.
    setUpdatesError("");
    try {
      setUpdates(await listUpdateRecords());
    } catch (e) {
      setUpdatesError(err(e));
    }
  }, [connected]);

  useEffect(() => {
    void load();
  }, [load]);

  // Staged version + read-only per-device list: the union of the
  // heartbeat list and the update records.
  const updateRows = useMemo(() => {
    const byId = new Map<
      string,
      { device?: OfflineDeviceRow; record?: UpdateRow }
    >();
    for (const d of devices) byId.set(d.deviceId, { device: d });
    for (const u of updates ?? []) {
      const entry = byId.get(u.deviceId) ?? {};
      entry.record = u;
      byId.set(u.deviceId, entry);
    }
    return [...byId.values()];
  }, [devices, updates]);

  const release = useMemo(
    () => deriveReleaseStatus(updates ?? []),
    [updates],
  );

  const pushToAll = async () => {
    if (!release || release.status !== "testing") return;
    if (
      !window.confirm(
        `Version ${release.version} sabhi shops ko bhej do? Iske baad har phone par update ka banner aayega.`,
      )
    )
      return;
    setPushing(true);
    setPushMsg("");
    setError("");
    try {
      const r = await pushRelease(release.version);
      setPushMsg(
        `Version ${r.version} sabko bhej diya — ${r.pushedTo} device${r.pushedTo === 1 ? "" : "s"}.`,
      );
      setUpdates(await listUpdateRecords());
    } catch (e) {
      setError(err(e));
    } finally {
      setPushing(false);
    }
  };

  return (
    <section className="auth-card">
      <div className="eyebrow">
        <i />
        MASTER · UPDATES
      </div>
      <h1>Updates — rollout control</h1>
      <p className="muted">
        Naya version pehle sirf aapke phone par aata hai — test karo,
        sab theek lage to ek click me sabhi shops ko bhej do. Jab tak
        aap nahi bhejte, kisi shop ko update nahi dikhega.
      </p>
      {!connected ? (
        <p className="muted">
          {NOT_CONFIGURED_MESSAGE} — rollout control needs the license
          server URL and admin token in this build.
        </p>
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
          <Problem message={updatesError} />
          {pushMsg && <p className="footnote">{pushMsg}</p>}
          {updates === null && !updatesError ? (
            <p className="muted">Loading…</p>
          ) : !release ? (
            <p className="muted">
              Abhi koi naya version staged nahi hai — jab publish hoga,
              yahan dikhega.
            </p>
          ) : release.status === "testing" ? (
            <>
              <p>
                <strong>Version {release.version}</strong> — Testing —
                sirf aapke phone par hai
              </p>
              <button
                className="btn primary"
                disabled={pushing}
                onClick={() => void pushToAll()}
              >
                {pushing ? "Bhej rahe hain…" : "Sabko update bhejo"}
              </button>
            </>
          ) : (
            <p>
              <strong>Version {release.version}</strong> — Sabko bhej
              diya — {fmtTime(release.pushedAt)}
            </p>
          )}
          {updates !== null && updateRows.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {updateRows.map(({ device, record }) => {
                const id = device?.deviceId ?? record!.deviceId;
                return (
                  <p
                    key={id}
                    className="muted"
                    style={{
                      borderTop:
                        "1px solid var(--hatch-widget-border, #ddd)",
                      padding: "8px 0",
                      margin: 0,
                    }}
                  >
                    {displayDeviceId(id)}
                    {device?.shopName ? ` · ${device.shopName}` : ""}
                    {device?.model ? ` · ${device.model}` : ""} ·{" "}
                    {record
                      ? record.allowed
                        ? "Update mil gaya"
                        : "Baaki hai"
                      : "Koi update record nahi"}
                  </p>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
