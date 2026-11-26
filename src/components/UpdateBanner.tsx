import { useState } from "react";
import { Download } from "lucide-react";
import {
  canInstallPackages,
  downloadApk,
  installApk,
  isAndroidApp,
  openInstallSettings,
  type UpdateAvailable,
} from "../lib/appUpdate";

/**
 * One-tap in-app update UI ("Ek click update", v1.0.45).
 *
 * A small in-flow banner at the top of the app (reuses
 * .bill-alert, never covers the screen, dismissible with
 * [Baad me] until tomorrow's check). EVERY update is a normal
 * optional update — there is no mandatory blocking screen: even
 * if the server sends mandatory=true, the banner still shows
 * [Baad me] (Ajay's staged rollout: pushed updates are optional).
 *
 * The flow: [Update karo] downloads the APK with progress, then —
 * on Android — checks "Install unknown apps": if not allowed yet,
 * the shopkeeper is told in plain Hindi to allow it once, with a
 * button that opens the setting; then the system installer opens
 * and they tap Install once. The update is IN PLACE (same package
 * + that device's own signing key), so shop data and activation survive it.
 */

type Stage =
  | "offer"
  | "downloading"
  | "need-permission"
  | "ready-to-install"
  | "installer-open"
  | "downloaded-web"
  | "error";

function UpdateFlow({
  info,
  onDismiss,
}: {
  info: UpdateAvailable;
  /** Shown only for optional updates. */
  onDismiss?: () => void;
}) {
  const [stage, setStage] = useState<Stage>("offer");
  const [progress, setProgress] = useState(-1);
  const [error, setError] = useState("");

  const startDownload = async () => {
    setError("");
    setProgress(-1);
    setStage("downloading");
    try {
      await downloadApk(info.apkUrl, (p) => setProgress(p));
      if (!isAndroidApp()) {
        // Web build: the APK was downloaded by the browser; there
        // is no installer to open here.
        setStage("downloaded-web");
        return;
      }
      if (await canInstallPackages()) {
        await openInstaller();
      } else {
        setStage("need-permission");
      }
    } catch {
      setError(
        "Download nahi hua — internet check karo aur dobara try karo.",
      );
      setStage("error");
    }
  };

  const openInstaller = async () => {
    const started = await installApk();
    if (started) setStage("installer-open");
    else {
      setError(
        "Installer nahi khula — dobara try karo, ya phone restart karke phir se karo.",
      );
      setStage("error");
    }
  };

  return (
    <div>
      {stage === "offer" && (
        <>
          <strong>Naya version {info.version} aaya hai — Update karo</strong>
          <p>
            Naya version download karke install karo. Aapka saara data —
            bill, stock, customer aur activation — bilkul safe rahega,
            kuch delete nahi hoga.
          </p>
          <div className="bill-alert-actions">
            <button className="btn primary" onClick={() => void startDownload()}>
              <Download size={15} /> Update karo
            </button>
            {onDismiss && (
              <button className="btn outline" onClick={onDismiss}>
                Baad me
              </button>
            )}
          </div>
        </>
      )}
      {stage === "downloading" && (
        <>
          <strong>
            Download ho raha hai
            {progress >= 0 ? `… ${progress}%` : "…"}
          </strong>
          <p>Thoda intezaar karo — app band mat karo.</p>
        </>
      )}
      {stage === "need-permission" && (
        <>
          <strong>Ek baar permission deni hogi</strong>
          <p>
            APK download ho gaya hai. Phone ki Settings me Aurum ke liye
            “Install unknown apps” ko Allow karo (sirf ek baar), phir
            wapas aakar Install karo.
          </p>
          <div className="bill-alert-actions">
            <button
              className="btn primary"
              onClick={async () => {
                await openInstallSettings();
                setStage("ready-to-install");
              }}
            >
              Settings kholo
            </button>
            {onDismiss && (
              <button className="btn outline" onClick={onDismiss}>
                Baad me
              </button>
            )}
          </div>
        </>
      )}
      {stage === "ready-to-install" && (
        <>
          <strong>APK download ho gaya hai</strong>
          <p>
            Permission mil gayi ho to ab Install dabao — naya version
            install ho jayega, aapka data safe rahega.
          </p>
          <div className="bill-alert-actions">
            <button className="btn primary" onClick={() => void openInstaller()}>
              Install karo
            </button>
            {onDismiss && (
              <button className="btn outline" onClick={onDismiss}>
                Baad me
              </button>
            )}
          </div>
        </>
      )}
      {stage === "installer-open" && (
        <>
          <strong>Installer khul gaya hai</strong>
          <p>
            Screen par <strong>Install</strong> dabao — update ho jayega,
            aapka data aur activation safe rahenge.
          </p>
        </>
      )}
      {stage === "downloaded-web" && (
        <>
          <strong>APK download ho gaya hai</strong>
          <p>
            Download ki hui APK file ko phone me kholkar install karo.
          </p>
        </>
      )}
      {stage === "error" && (
        <>
          <strong>Update nahi ho paya</strong>
          <p>{error}</p>
          <div className="bill-alert-actions">
            <button className="btn primary" onClick={() => void startDownload()}>
              Dobara try karo
            </button>
            {onDismiss && (
              <button className="btn outline" onClick={onDismiss}>
                Baad me
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Optional update: small dismissible banner at the top of the app. */
export function UpdateBanner({
  info,
  onDismiss,
}: {
  info: UpdateAvailable;
  onDismiss: () => void;
}) {
  return (
    <div className="bill-alert" role="status" style={{ margin: "12px 12px 0" }}>
      <UpdateFlow info={info} onDismiss={onDismiss} />
    </div>
  );
}
