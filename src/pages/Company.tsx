import { useState, useEffect } from "react";
import { signOut } from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import {
  Plus,
  RefreshCw,
  ShieldCheck,
  KeyRound,
  LogOut,
  Copy,
} from "lucide-react";
import { auth, company } from "../lib/cloud";
import { useToast } from "../lib/store";
import { cash, day, err } from "../lib/format";
import type { License, Device } from "../../functions/src/core/license";
import {
  Brand,
  Empty,
  Field,
  Modal,
  PageHead,
  Problem,
  Records,
  Select,
  Status,
} from "../components/ui";
type Plan = {
  id: string;
  name: string;
  price: number;
  days: number;
  deviceLimit: number;
  features: string[];
  enabled: boolean;
};
type Tenant = {
  id: string;
  licenseId: string;
  shopName: string;
  email: string;
};
type Overview = {
  shops: Tenant[];
  licenses: License[];
  devices: Omit<Device, "publicKey">[];
  plans: Plan[];
  events: { action: string; at: number; uid: string; licenseId?: string }[];
};
export default function Company() {
  const [d, D] = useState<Overview | null>(null),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [tab, T] = useState("Shops & licenses"),
    [dialog, M] = useState(""),
    [lid, L] = useState(""),
    [dev, V] = useState(""),
    [pid, P] = useState(""),
    [token, K] = useState<{ code: string; expiresAt: number } | null>(null),
    notify = useToast();
  const load = async () => {
    const s = await company<Overview>("list");
    D(s);
  };
  useEffect(() => {
    load().catch((e) => E(err(e)));
  }, []);
  const l = d?.licenses.find((l) => l.id === lid),
    p = d?.plans.find((p) => p.id === pid),
    name = (id: string) =>
      d?.shops.find((s) => s.licenseId === id)?.shopName ?? id;
  const status = (l: License) =>
    ["Active", "Pending"].includes(l.status) &&
    l.expiresAt !== null &&
    l.expiresAt <= Date.now()
      ? "Expired"
      : l.status;
  const open = (dialog: string) => {
    E("");
    M(dialog);
  };
  const run = async (op: string, fields: unknown) => {
    if (busy) return;
    E("");
    B(true);
    try {
      const r = await company<{ code?: string; expiresAt: number }>(op, fields);
      await load();
      if (r.code) {
        K({ code: r.code, expiresAt: r.expiresAt });
        M("Issued activation");
      } else {
        M("");
        notify(
          op === "createShop"
            ? "Shop provisioned. The owner can set their password by email."
            : "Company record updated.",
        );
      }
    } catch (e) {
      E(err(e));
    } finally {
      B(false);
    }
  };
  return (
    <>
      <header className="company-head">
        <Brand />
        <button className="btn" onClick={() => signOut(auth)}>
          <LogOut size={15} />
          Sign out
        </button>
      </header>
      <main className="company-shell">
        <PageHead
          eyebrow="RESTRICTED · COMPANY ADMIN"
          title="License console"
          subtitle="Manage shop registration and device access, not shop financial data."
        >
          <button
            className="btn outline"
            onClick={() => load().catch((e) => E(err(e)))}
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button className="btn primary" onClick={() => open("Register shop")}>
            <Plus size={15} />
            Register shop
          </button>
        </PageHead>
        <Problem message={!dialog ? error : ""} />
        {d ? (
          <>
            <div className="stat-strip">
              <div>
                <small>Registered shops</small>
                <strong>{d.shops.length}</strong>
              </div>
              <div>
                <small>Active licenses</small>
                <strong>
                  {d.licenses.filter((l) => status(l) === "Active").length}
                </strong>
              </div>
              <div>
                <small>Expired licenses</small>
                <strong>
                  {d.licenses.filter((l) => status(l) === "Expired").length}
                </strong>
              </div>
              <div>
                <small>Active devices</small>
                <strong>
                  {d.devices.filter((d) => d.status === "Active").length}
                </strong>
              </div>
            </div>
            <div className="tabs">
              {["Shops & licenses", "Devices", "Plans", "Audit log"].map(
                (t) => (
                  <button
                    key={t}
                    className={tab === t ? "on" : ""}
                    onClick={() => T(t)}
                  >
                    {t}
                  </button>
                ),
              )}
            </div>
            {tab === "Shops & licenses" ? (
              <Records
                items={d.licenses}
                search={(l) => name(l.id) + l.id + l.tenantId}
                action={(l) => {
                  L(l.id);
                  open("Manage license");
                }}
                columns={[
                  {
                    label: "Shop",
                    value: (l) => <strong>{name(l.id)}</strong>,
                    sort: (l) => name(l.id),
                  },
                  { label: "Plan", value: (l) => l.plan },
                  {
                    label: "Status",
                    value: (l) => <Status text={status(l)} />,
                  },
                  {
                    label: "Devices",
                    value: (l) => `${l.activeCount} / ${l.deviceLimit}`,
                  },
                  {
                    label: "Valid until",
                    value: (l) => (l.expiresAt ? day(l.expiresAt) : "Lifetime"),
                  },
                ]}
              />
            ) : tab === "Devices" ? (
              <Records
                items={d.devices}
                search={(x) => name(x.licenseId) + x.id + x.platform}
                action={(x) => {
                  V(x.id);
                  L(x.licenseId);
                  open("Manage device");
                }}
                columns={[
                  {
                    label: "Device key",
                    value: (d) => d.id.slice(0, 14) + "…",
                  },
                  { label: "Shop", value: (d) => name(d.licenseId) },
                  { label: "Platform", value: (d) => d.platform },
                  { label: "Registered", value: (d) => day(d.createdAt) },
                  { label: "Last verified", value: (d) => day(d.lastVerified) },
                  { label: "Status", value: (d) => <Status text={d.status} /> },
                ]}
              />
            ) : tab === "Plans" ? (
              <Records
                items={d.plans}
                search={(p) => p.name}
                filters={
                  <button
                    className="btn primary"
                    onClick={() => {
                      P("");
                      open("Configure plan");
                    }}
                  >
                    <Plus size={14} />
                    Add plan
                  </button>
                }
                action={(p) => {
                  P(p.id);
                  open("Configure plan");
                }}
                columns={[
                  { label: "Plan", value: (p) => <strong>{p.name}</strong> },
                  { label: "Price", value: (p) => cash(p.price) },
                  {
                    label: "Duration",
                    value: (p) => (p.days ? p.days + " days" : "Lifetime"),
                  },
                  { label: "Device limit", value: (p) => p.deviceLimit },
                  {
                    label: "Sale status",
                    value: (p) => (p.enabled ? "Enabled" : "Disabled"),
                  },
                ]}
              />
            ) : (
              <Records
                items={d.events.map((e, i) => ({ ...e, id: String(i) }))}
                search={(e) => e.action + e.uid}
                columns={[
                  { label: "Event", value: (e) => e.action },
                  {
                    label: "Date",
                    value: (e) =>
                      day(e.at, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                  },
                  { label: "Actor", value: (e) => e.uid },
                  { label: "License", value: (e) => e.licenseId ?? "—" },
                ]}
              />
            )}
          </>
        ) : (
          !error && <div className="spinner" />
        )}
        <Modal
          open={!!dialog}
          title={dialog}
          onClose={() => {
            if (!busy) {
              M("");
              K(null);
              E("");
            }
          }}
        >
          <Problem message={error} />
          {dialog === "Register shop" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                void run("createShop", f);
              }}
            >
              <div className="form-grid">
                {[
                  ["shopName", "Business name"],
                  ["ownerName", "Owner name"],
                  ["email", "Owner email"],
                ].map(([k, t]) => (
                  <Field key={k} label={t}>
                    <input
                      name={k}
                      type={k === "email" ? "email" : "text"}
                      required
                    />
                  </Field>
                ))}
                <Field label="Subscription plan">
                  <Select name="planId" required>
                    {d?.plans
                      .filter((p) => p.enabled)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.deviceLimit} device(s)
                        </option>
                      ))}
                  </Select>
                </Field>
              </div>
              <p className="footnote spaced">
                The provider creates the account. The owner then uses “Set or
                reset password” on the sign-in screen.
              </p>
              <button
                className="btn primary"
                disabled={busy || !d?.plans.some((p) => p.enabled)}
              >
                Create shop & license
              </button>
            </form>
          ) : dialog === "Manage license" && l ? (
            <>
              <h3>{name(l.id)}</h3>
              <dl className="details">
                {[
                  ["License", l.id],
                  ["Tenant", l.tenantId],
                  ["Plan", l.plan],
                  ["Status", status(l)],
                  ["Slots", `${l.activeCount} / ${l.deviceLimit}`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="company-actions">
                {[
                  ["token", "Issue activation code"],
                  ["renew", "Renew license"],
                  ["block", "Block"],
                  ["suspend", "Suspend"],
                  ["resume", "Resume"],
                  ["revoke", "Revoke permanently"],
                ].map(([op, t]) => (
                  <button
                    key={op}
                    className="btn outline"
                    onClick={() => open(op)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          ) : dialog === "Manage device" ? (
            <>
              <p className="muted">
                {name(lid)} · {dev.slice(0, 16)}…
              </p>
              <div className="company-actions">
                <button
                  className="btn outline"
                  onClick={() => open("revokeDevice")}
                >
                  Revoke device
                </button>
                <button
                  className="btn primary"
                  onClick={() => open("transfer")}
                >
                  Transfer activation
                </button>
              </div>
            </>
          ) : dialog === "Issued activation" && token ? (
            <div className="qr-code">
              <QRCodeSVG value={token.code} size={180} />
              <div className="code-box">{token.code}</div>
              <small>
                Single use · Expires{" "}
                {new Date(token.expiresAt).toLocaleTimeString()}
              </small>
              <button
                className="btn outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(token.code)
                    .then(() => notify("Activation code copied."))
                    .catch((e) => E(err(e)))
                }
              >
                <Copy size={14} />
                Copy code
              </button>
              <p className="footnote">
                Share privately with the verified owner. The plaintext token is
                not retrievable later.
              </p>
            </div>
          ) : dialog === "Configure plan" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run("plan", {
                  id: f.get("id"),
                  name: f.get("name"),
                  deviceLimit: Number(f.get("limit")),
                  price: Number(f.get("price")),
                  days: Number(f.get("days")),
                  features: String(f.get("features"))
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                  enabled: f.has("enabled"),
                });
              }}
            >
              <div className="form-grid">
                {[
                  ["id", "Plan ID", p?.id ?? ""],
                  ["name", "Plan name", p?.name ?? ""],
                  ["limit", "Device limit", p?.deviceLimit ?? 1],
                  ["price", "Price (₹)", p?.price ?? 0],
                  ["days", "Days (0 = lifetime)", p?.days ?? 365],
                  [
                    "features",
                    "Feature description",
                    p?.features.join(", ") ?? "Billing, Inventory, Customers",
                  ],
                ].map(([k, t, v]) => (
                  <Field label={String(t)} key={k}>
                    <input
                      required
                      name={String(k)}
                      readOnly={k === "id" && !!p}
                      defaultValue={v}
                      type={
                        ["limit", "price", "days"].includes(String(k))
                          ? "number"
                          : "text"
                      }
                    />
                  </Field>
                ))}
              </div>
              <label className="check-line spaced">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={p?.enabled ?? true}
                />
                Available for new licenses
              </label>
              <p className="footnote">
                Plan changes apply to future shop registrations.
              </p>
              <div className="modal-actions">
                <button className="btn primary" disabled={busy}>
                  Save plan
                </button>
              </div>
            </form>
          ) : dialog && l ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(dialog, {
                  licenseId: lid,
                  ...(dialog === "renew"
                    ? { days: Number(f.get("days")) }
                    : {}),
                  ...(["transfer", "revokeDevice"].includes(dialog)
                    ? { deviceId: dev }
                    : {}),
                });
              }}
            >
              <div className="info-box">
                <ShieldCheck />
                <p>
                  Confirm <b>{dialog}</b> for <b>{name(lid)}</b>. This operation
                  is recorded in the company audit log.
                </p>
              </div>
              {dialog === "renew" && (
                <Field label="Additional days">
                  <input
                    required
                    name="days"
                    type="number"
                    min={1}
                    max={3650}
                    defaultValue={365}
                  />
                </Field>
              )}
              {["transfer", "token", "revokeDevice"].includes(dialog) && (
                <label className="check-line spaced">
                  <input type="checkbox" required />I verified the customer’s
                  license ownership.
                </label>
              )}
              <div className="modal-actions">
                <button
                  className="btn outline"
                  type="button"
                  onClick={() => M("")}
                >
                  Cancel
                </button>
                <button className="btn primary" disabled={busy}>
                  {busy ? "Working…" : "Confirm operation"}
                </button>
              </div>
            </form>
          ) : null}
        </Modal>
      </main>
    </>
  );
}
