import { useEffect, useRef, useState } from "react";
import {
  demoMutation,
  loadDemoWorkspace,
  saveDemoWorkspace,
} from "./lib/demo";
import { Shop } from "./lib/store";
import { Shell } from "./components/Shell";
import LicenseBlocked from "./components/LicenseBlocked";
import { getDeviceId } from "./lib/offlineActivation";
import {
  getDeviceModel,
  isLicenseBlocked,
  LICENSE_CHECK_INTERVAL_MS,
  maybeCheckLicenseHeartbeat,
} from "./lib/licenseCheck";
import {
  getPrimaryAbi,
  maybeCheckLatest,
  type UpdateAvailable,
} from "./lib/appUpdate";
import {
  cancelUpdateNotification,
  requestUpdateNotificationPermission,
  syncUpdateNotification,
} from "./lib/updateNotify";
import { UpdateBanner } from "./components/UpdateBanner";

/** Build version baked in by CI (VITE_APP_VERSION=1.0.<run number>); "dev" locally. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

export default function Demo() {
  const [data, setData] = useState(loadDemoWorkspace);
  const ref = useRef(data);
  // Kill switch: the server-blocked flag persists across launches,
  // so a blocked device shows the lock screen before the shop opens.
  const [blocked, setBlocked] = useState(() => isLicenseBlocked());
  // One-tap update: a newer allowed version on the server offers a
  // dismissible banner (every update is optional — no mandatory block).
  // [Baad me] dismisses ONLY for this session: the check below runs on
  // every open and on the 5-minute tick, so the banner comes straight
  // back until the app is updated (v1.0.54 — Ajay: the notice must
  // stay until the app is on the latest version).
  const [update, setUpdate] = useState<UpdateAvailable | null>(null);
  // True while an update is pending AND the notification permission
  // has not been asked yet — the banner then shows the one-line
  // Hindi explanation + [Notification on karo].
  const [notifyAsk, setNotifyAsk] = useState(false);
  useEffect(() => {
    let alive = true;
    // Heartbeat + update check, together on ONE tick: on open, on
    // foreground, and every 5 minutes while the app stays open, only
    // when online. No second timer — the update check piggybacks
    // the license heartbeat's tick (v1.0.54).
    //
    // Heartbeat sends ONLY deviceId + shopName + model + appVersion
    // (block/unlock + presence — nothing else goes online). No-op
    // when the license server is not configured; any failure leaves
    // the app fully working.
    //
    // Update check: runs on EVERY tick now (no once-a-day cache any
    // more — that is what hid the notice after a reinstall). When
    // an update is available the banner shows AND the notification
    // shade gets the persistent "Aurum update aaya hai" notice.
    // When a check CONFIRMS the phone is on the latest version
    // (checked=true) the banner and the notice are both cleared —
    // a FAILED check (offline/server down) leaves both alone, so a
    // dead network never silently clears the notice.
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const [deviceId, model, abi] = await Promise.all([
          getDeviceId(),
          getDeviceModel(),
          getPrimaryAbi(),
        ]);
        const [hb, r] = await Promise.all([
          maybeCheckLicenseHeartbeat({
            deviceId,
            shopName: ref.current.profile.shopName,
            model,
            appVersion: APP_VERSION,
          }),
          maybeCheckLatest({
            deviceId,
            currentVersion: APP_VERSION,
            mode: "demo",
            abi,
          }),
        ]);
        if (!alive) return;
        if (hb.status === "blocked") setBlocked(true);
        else if (!hb.error && !hb.skipped) setBlocked(false);
        if (r.available) {
          setUpdate(r);
          const state = await syncUpdateNotification(r);
          if (!alive) return;
          setNotifyAsk(state === "needs-permission");
        } else if (r.checked) {
          setUpdate(null);
          setNotifyAsk(false);
          await cancelUpdateNotification();
        }
      } catch {
        // Heartbeat + update check must never break the shop.
      }
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Re-check while the app stays open in the foreground: a block
    // issued from the Master app must lock this app without waiting
    // for a restart, and a pushed update must show without waiting
    // either. Same 5-minute throttle as the heartbeat itself, so
    // the interval never spams the server.
    const timer = window.setInterval(
      () => void check(),
      LICENSE_CHECK_INTERVAL_MS,
    );
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (blocked) return <LicenseBlocked />;
  // Every update is optional (staged rollout: pushed updates are
  // never mandatory) — the banner always offers [Baad me].
  return (
    <>
      {update && (
        <UpdateBanner
          info={update}
          onDismiss={() => setUpdate(null)}
          showNotifyAsk={notifyAsk}
          onEnableNotifications={async () => {
            // One-line Hindi explanation is in the banner already;
            // this tap is the permission request itself.
            const granted = await requestUpdateNotificationPermission();
            if (granted) {
              await syncUpdateNotification(update);
              setNotifyAsk(false);
            }
          }}
        />
      )}
      <Shop.Provider
        value={{
          data,
          demo: true,
          perform: async (a, p) => {
            const next = demoMutation(ref.current, a, p);
            ref.current = next;
            saveDemoWorkspace(next);
            setData(next);
          },
        }}
      >
        <Shell />
      </Shop.Provider>
    </>
  );
}
