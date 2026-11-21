import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  type User,
  type MultiFactorResolver,
  type MultiFactorError,
  type TotpSecret,
} from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import {
  LockKeyhole,
  KeyRound,
  RefreshCw,
  ScanLine,
  ArrowRight,
  Upload,
} from "lucide-react";
import { auth, secured } from "./lib/cloud";
import { err } from "./lib/format";
import { Shop, useToast } from "./lib/store";
import { Brand, Field, Problem } from "./components/ui";
import { Shell } from "./components/Shell";
import type { Workspace, LicenseInfo } from "../functions/src/core/model";
import Company from "./pages/Company";
function Gate({
  kicker,
  title,
  text,
  children,
}: {
  kicker: string;
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-wrap">
        <Brand />
        <section className="auth-card">
          <div className="eyebrow">
            <i />
            {kicker}
          </div>
          <h1>{title}</h1>
          <p className="muted">{text}</p>
          {children}
        </section>
      </div>
    </main>
  );
}
function Login() {
  const [email, M] = useState(""),
    [password, P] = useState(""),
    [code, C] = useState(""),
    [error, E] = useState(""),
    [busy, B] = useState(false),
    [resolver, R] = useState<MultiFactorResolver | null>(null);
  const notify = useToast();
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    E("");
    B(true);
    try {
      if (resolver) {
        const hint = resolver.hints.find(
          (h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID,
        );
        if (!hint) throw Error("A supported authenticator factor is required.");
        await resolver.resolveSignIn(
          TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code),
        );
      } else await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      if ((e as { code: string }).code === "auth/multi-factor-auth-required")
        R(getMultiFactorResolver(auth, e as MultiFactorError));
      else E(err(e));
    } finally {
      B(false);
    }
  };
  return (
    <Gate
      kicker="LICENSED WORKSPACE"
      title={resolver ? "Verify your sign-in" : "Welcome to Aurum"}
      text={
        resolver
          ? "Enter the code from your authenticator."
          : "Sign in with the account issued by your software provider."
      }
    >
      <form className="auth-form" onSubmit={login}>
        {resolver ? (
          <Field label="Authenticator code">
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => C(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="Email address">
              <input
                required
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => M(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <input
                required
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => P(e.target.value)}
              />
            </Field>
          </>
        )}
        <Problem message={error} />
        <button className="btn primary" disabled={busy}>
          <LockKeyhole size={15} />
          {busy ? "Checking…" : resolver ? "Verify code" : "Sign in securely"}
        </button>
      </form>
      {!resolver && (
        <button
          className="text-link"
          onClick={async () => {
            if (!email) {
              E("Enter your email address first.");
              return;
            }
            try {
              await sendPasswordResetEmail(auth, email);
              notify("If the account exists, a reset email has been sent.");
            } catch (e) {
              E(err(e));
            }
          }}
        >
          Set or reset password
        </button>
      )}
    </Gate>
  );
}
function Enroll({ user }: { user: User }) {
  const [secret, S] = useState<TotpSecret | null>(null),
    [code, C] = useState(""),
    [error, E] = useState("");
  return (
    <Gate
      kicker="COMPANY SECURITY"
      title="Set up two-factor sign-in"
      text="A verified authenticator is required before any company operation."
    >
      <div className="auth-form">
        {secret ? (
          <>
            <div className="qr-code">
              <QRCodeSVG
                value={secret.generateQrCodeUrl(
                  user.email ?? "Admin",
                  "Aurum Company",
                )}
                size={160}
              />
            </div>
            <Field label="Authenticator code">
              <input
                inputMode="numeric"
                value={code}
                onChange={(e) => C(e.target.value)}
              />
            </Field>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await multiFactor(user).enroll(
                    TotpMultiFactorGenerator.assertionForEnrollment(
                      secret,
                      code,
                    ),
                    "Company authenticator",
                  );
                  await signOut(auth);
                } catch (e) {
                  E(err(e));
                }
              }}
            >
              Verify & sign in again
            </button>
          </>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              try {
                S(
                  await TotpMultiFactorGenerator.generateSecret(
                    await multiFactor(user).getSession(),
                  ),
                );
              } catch (e) {
                E(err(e));
              }
            }}
          >
            Set up authenticator
          </button>
        )}
        <Problem message={error} />
        <button className="btn outline" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </Gate>
  );
}
async function scan(file: File) {
  if (file.size > 6 * 1024 * 1024) throw Error("Choose a QR image under 6 MB.");
  const bmp = await createImageBitmap(file),
    scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw Error("Image decoding unavailable.");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const pix = ctx.getImageData(0, 0, c.width, c.height),
    qr = (await import("jsqr")).default(pix.data, pix.width, pix.height);
  if (!qr || !/^[a-f\d\s-]{32,64}$/i.test(qr.data))
    throw Error("No valid activation QR found in this image.");
  return qr.data;
}
type Snapshot = { workspace: Workspace; license: LicenseInfo };
function LicensedShop() {
  const [snapshot, S] = useState<Snapshot | null>(null),
    [loading, L] = useState(true),
    [error, E] = useState(""),
    [code, C] = useState(""),
    [busy, B] = useState(false);
  const epoch = useRef(0);
  const validate = useCallback(async () => {
    const n = ++epoch.current;
    try {
      if (!navigator.onLine)
        throw Error("Server verification requires an internet connection.");
      const result = await secured<Snapshot>("workspace", {});
      if (n === epoch.current) {
        S(result);
        E("");
      }
    } catch (e) {
      if (n === epoch.current) {
        S(null);
        E(err(e));
      }
      throw e;
    } finally {
      if (n === epoch.current) L(false);
    }
  }, []);
  useEffect(() => {
    const verify = () => void validate().catch(() => {});
    verify();
    const timer = setInterval(verify, 120000);
    const visible = () => {
      if (!document.hidden) verify();
    };
    const offline = () => {
      epoch.current++;
      S(null);
      E("Offline. Reconnect for license verification.");
      L(false);
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", verify);
    document.addEventListener("visibilitychange", visible);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener("online", verify);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [validate]);
  if (loading)
    return (
      <div className="spinner-page">
        <i className="spinner" />
        Verifying license & device…
      </div>
    );
  if (snapshot)
    return (
      <Shop.Provider
        value={{
          // Older live workspaces have no loans collection yet.
          data: { ...snapshot.workspace, loans: snapshot.workspace.loans ?? [] },
          license: snapshot.license,
          demo: false,
          logout: () => signOut(auth),
          perform: async (action, payload) => {
            try {
              await secured(action, payload);
            } catch (e) {
              if (
                /license|not authorized|shop access|unauthenticated/i.test(
                  err(e),
                )
              ) {
                epoch.current++;
                S(null);
                E(err(e));
              }
              throw e;
            }
            await validate();
          },
        }}
      >
        <Shell />
      </Shop.Provider>
    );
  return (
    <Gate
      kicker="DEVICE ACTIVATION"
      title="Verify your workspace"
      text="For a new device, enter the one-time activation code issued by your provider. Already active? Recheck your license."
    >
      <Problem message={error} />
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          B(true);
          E("");
          try {
            await secured("activate", { code });
            C("");
            await validate();
          } catch (e) {
            E(err(e));
          } finally {
            B(false);
          }
        }}
      >
        <Field label="One-time activation code">
          <input
            value={code}
            required
            autoComplete="off"
            placeholder="Enter the code from your provider"
            onChange={(e) => C(e.target.value)}
            maxLength={64}
          />
        </Field>
        <label className="text-link upload-label">
          <ScanLine size={15} />
          Read QR from image
          <input
            type="file"
            accept="image/*"
            onChange={async (e) => {
              if (e.target.files?.[0])
                try {
                  C(await scan(e.target.files[0]));
                  E("");
                } catch (e) {
                  E(err(e));
                }
            }}
          />
        </label>
        <button className="btn primary" disabled={busy}>
          <KeyRound size={15} />
          {busy ? "Verifying…" : "Activate device"}
        </button>
      </form>
      <div className="row-between">
        <button
          className="text-link"
          disabled={busy}
          onClick={() => validate().catch(() => {})}
        >
          <RefreshCw size={13} />
          Recheck license
        </button>
        <button className="text-link" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </div>
    </Gate>
  );
}
export default function Live() {
  const [state, S] = useState("loading"),
    [user, U] = useState<User | null>(null);
  useEffect(() => {
    let version = 0;
    const sub = onAuthStateChanged(auth, async (u) => {
      const n = ++version;
      U(u);
      if (!u) {
        S("login");
        return;
      }
      S("loading");
      try {
        const { claims } = await u.getIdTokenResult(true);
        if (n !== version) return;
        S(
          claims.role === "company_admin"
            ? (claims.firebase as Record<string, unknown>)
                ?.sign_in_second_factor
              ? "company"
              : "enroll"
            : claims.role === "owner"
              ? "shop"
              : "denied",
        );
      } catch {
        if (n === version) S("denied");
      }
    });
    return () => {
      version++;
      sub();
    };
  }, []);
  if (state === "login") return <Login />;
  if (state === "company") return <Company />;
  if (state === "enroll" && user) return <Enroll user={user} />;
  if (state === "shop") return <LicensedShop key={user?.uid} />;
  if (state === "denied")
    return (
      <Gate
        kicker="ACCESS CONTROL"
        title="No workspace assigned"
        text="Contact your provider to check this account’s registration."
      >
        <button className="btn outline" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </Gate>
    );
  return (
    <div className="spinner-page">
      <i className="spinner" />
      Checking sign-in…
    </div>
  );
}
