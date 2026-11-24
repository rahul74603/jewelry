import { useMemo, useState } from "react";
import { Copy, KeyRound, Search, Share2 } from "lucide-react";
import {
  generateUnlockKey,
  DEVELOPER_WHATSAPP,
} from "./lib/offlineActivation";
import { shareSummary } from "./lib/device";
import LicensesDashboard from "./components/LicensesDashboard";
import {
  loadIssuedKeys,
  saveIssuedKeys,
  addRow,
  searchRows,
  flagRows,
  toCSV,
  toText,
  type IssuedKeyRow,
} from "./lib/issuedKeys";
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
 * code AND their 12-character Device ID (both from the lock screen —
 * the shopkeeper sends them on WhatsApp or as a screenshot), enter
 * the master secret (kept in memory only, never stored), generate the
 * unlock key with the exact same generateUnlockKey the Company
 * console's "Offline unlock" tab uses, and copy it to send back on
 * WhatsApp. No billing, no demo data, no sign-in.
 *
 * The key only matches when the same master secret is in the user app
 * build and here — and it only unlocks the phone with that Device ID.
 * The secret is Ajay's chosen short secret, kept in git by his
 * choice — and it is never displayed anywhere in this app.
 *
 * Issued-keys register: every successful key generation is saved
 * automatically (buyer name / number / phone model / IMEI from the
 * form below, code / Device ID / key from the generation), newest
 * first, in Master-app localStorage. A row is flagged when the same
 * buyer number already has a key for a DIFFERENT Device ID — same
 * number + new Device ID + different model / different IMEI means a
 * different phone, not a genuine reset. Honest limit: the register
 * makes repeat requests VISIBLE, it does not technically block
 * resale — the model is per-model, not per-phone, and the key stays
 * bound to code + Device ID. Export the register regularly: it is
 * wiped if the Master app is uninstalled.
 */
export default function Master() {
  const [deviceCode, setDeviceCode] = useState(""),
    [deviceId, setDeviceId] = useState(""),
    [masterSecret, setMasterSecret] = useState(""),
    [buyerName, setBuyerName] = useState(""),
    [buyerNumber, setBuyerNumber] = useState(""),
    [model, setModel] = useState(""),
    [imei, setImei] = useState(""),
    [note, setNote] = useState(""),
    [unlockKey, setUnlockKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [rows, setRows] = useState<IssuedKeyRow[]>(() => loadIssuedKeys()),
    [search, setSearch] = useState(""),
    [exportMsg, setExportMsg] = useState("");
  const flagged = useMemo(() => flagRows(rows), [rows]);
  const visibleRows = useMemo(() => searchRows(rows, search), [rows, search]);
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
            device code and 12-character Device ID on WhatsApp (+91{" "}
            {DEVELOPER_WHATSAPP.slice(2)}) — or as a screenshot of the
            lock screen. Paste both here with the master secret to
            generate their unlock key, then send the key back. The key
            unlocks only the phone with that Device ID, locally only.
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
              label="Device ID from the shopkeeper"
              hint="From the lock screen, next to the device code — dashes optional."
            >
              <input
                value={deviceId}
                maxLength={14}
                autoComplete="off"
                placeholder="e.g. ABCD-1234-EF01"
                onChange={(e) => setDeviceId(e.target.value.toUpperCase())}
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
            <Field
              label="Buyer name"
              hint="Saved in the issued-keys register below."
            >
              <input
                value={buyerName}
                autoComplete="off"
                placeholder="e.g. Ramesh Jewellers"
                onChange={(e) => setBuyerName(e.target.value)}
              />
            </Field>
            <Field
              label="Buyer WhatsApp number"
              hint="Copy it from the WhatsApp sender — the register flags this number if it later asks for a key for a different Device ID."
            >
              <input
                value={buyerNumber}
                autoComplete="off"
                inputMode="tel"
                placeholder="e.g. 9876543210"
                onChange={(e) => setBuyerNumber(e.target.value)}
              />
            </Field>
            <Field
              label="Phone model"
              hint="Paste it from the shopkeeper's WhatsApp message — per-model only, not per-phone."
            >
              <input
                value={model}
                autoComplete="off"
                placeholder="e.g. Infinix ZERO 5G 2023"
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>
            <Field
              label="IMEI (optional)"
              hint="Shopkeeper dials *#06# or checks Settings > About phone. Same number + same IMEI = genuine reset; different IMEI = different phone."
            >
              <input
                value={imei}
                autoComplete="off"
                inputMode="numeric"
                placeholder="e.g. 860123045678901"
                onChange={(e) => setImei(e.target.value)}
              />
            </Field>
            <Field label="Note (optional)">
              <input
                value={note}
                autoComplete="off"
                placeholder="e.g. Paid ₹12,000 on 24 Nov"
                onChange={(e) => setNote(e.target.value)}
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
                  const key = await generateUnlockKey(
                    deviceCode,
                    deviceId,
                    masterSecret,
                  );
                  setUnlockKey(key);
                  // Auto-save to the issued-keys register on every
                  // successful generation — a key request leaves a
                  // trace, so a repeat request is visible later.
                  const next = addRow(rows, {
                    buyerName,
                    buyerNumber,
                    deviceCode,
                    deviceId,
                    model,
                    imei,
                    unlockKey: key,
                    note,
                  });
                  saveIssuedKeys(next);
                  setRows(next);
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
                  Send this key back to the shopkeeper on WhatsApp. It
                  works only for the device code and Device ID above —
                  no other phone can use it. This key has been saved in
                  the issued-keys register below.
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

        <section className="auth-card" style={{ marginTop: 16 }}>
          <div className="eyebrow">
            <i />
            ISSUED-KEYS REGISTER
          </div>
          <h1 style={{ fontSize: 21 }}>Issued keys</h1>
          <p className="muted">
            Every key you generate is saved here automatically, newest
            first. Before issuing a repeat key, check: same number +
            new Device ID + same model + same IMEI = genuine reset,
            give the key. Same number + different model or different
            IMEI = a different phone — ask, or charge again.
          </p>
          <p className="footnote">
            Honest limit: the phone model is per-model, not per-phone,
            and the key stays bound to code + Device ID. This register
            makes repeat requests visible — it does not technically
            block resale. It lives only on this phone: export it
            regularly, because uninstalling the Master app wipes it.
          </p>
          <div className="auth-form">
            <Field label="Search register">
              <div style={{ position: "relative" }}>
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#8a7a4d",
                  }}
                />
                <input
                  value={search}
                  autoComplete="off"
                  placeholder="Search by number, Device ID or IMEI"
                  style={{ paddingLeft: 32 }}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </Field>
            <div
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <button
                className="btn outline"
                disabled={rows.length === 0}
                onClick={async () => {
                  setExportMsg("");
                  try {
                    const result = await shareSummary(
                      "Aurum issued keys",
                      toText(rows),
                    );
                    setExportMsg(
                      result === "copied"
                        ? "Register copied — paste it into a note or file to keep it safe."
                        : "Register shared.",
                    );
                  } catch (e) {
                    setExportMsg(err(e));
                  }
                }}
              >
                <Share2 size={14} />
                Export as text
              </button>
              <button
                className="btn outline"
                disabled={rows.length === 0}
                onClick={async () => {
                  setExportMsg("");
                  try {
                    const result = await shareSummary(
                      "Aurum issued keys",
                      toCSV(rows),
                    );
                    setExportMsg(
                      result === "copied"
                        ? "CSV copied — paste it into a spreadsheet or file to keep it safe."
                        : "CSV shared.",
                    );
                  } catch (e) {
                    setExportMsg(err(e));
                  }
                }}
              >
                <Share2 size={14} />
                Export as CSV
              </button>
            </div>
            {exportMsg && <p className="footnote">{exportMsg}</p>}
            {visibleRows.length === 0 ? (
              <p className="footnote">
                {rows.length === 0
                  ? "No keys issued yet — the first key you generate will appear here."
                  : "No rows match this search."}
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {visibleRows.map((row) => {
                  const isFlagged = flagged.has(row.id);
                  return (
                    <li
                      key={row.id}
                      style={{
                        border: `1px solid ${isFlagged ? "#c0392b" : "#e3d9bd"}`,
                        borderLeft: `4px solid ${isFlagged ? "#c0392b" : "#cbb476"}`,
                        borderRadius: 8,
                        padding: 10,
                        background: isFlagged ? "#fdf0ee" : "#fcf8ef",
                        fontSize: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                        }}
                      >
                        <strong>
                          {row.buyerName || "(no name)"}
                          {row.buyerNumber
                            ? ` · ${row.buyerNumber}`
                            : ""}
                        </strong>
                        <span className="muted">
                          {row.date.slice(0, 10)}
                        </span>
                      </div>
                      <div>
                        Device code: <code>{row.deviceCode}</code>
                        {" · "}Device ID: <code>{row.deviceId}</code>
                      </div>
                      <div>
                        Model: {row.model || "—"}
                        {" · "}IMEI: {row.imei || "—"}
                        {" · "}Key: <code>{row.unlockKey}</code>
                      </div>
                      {row.note && <div>Note: {row.note}</div>}
                      {isFlagged && (
                        <div
                          style={{
                            marginTop: 6,
                            fontWeight: 700,
                            color: "#c0392b",
                          }}
                        >
                          ⚠ Same buyer number, different Device ID — check
                          before issuing another key. Same model + same
                          IMEI means a genuine reset; a different model
                          or IMEI means a different phone.
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <LicensesDashboard />
      </div>
    </main>
  );
}
