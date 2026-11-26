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
  const [update, setUpdate] = useState<UpdateAvailable | null>(null);
  useEffect(() => {
    // Once per app open, at most once a day (the once-a-day cache
    // in appUpdate.ts) — fail-open, so offline or a down server
    // just means no banner and the shop works normally.
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        // Same Device ID the heartbeat sends (getDeviceId is cached
        // per session) — checkLatest normalises it to the 12-hex
        // wire form itself.
        const [deviceId, abi] = await Promise.all([
          getDeviceId(),
          getPrimaryAbi(),
        ]);
        const r = await maybeCheckLatest({
          deviceId,
          currentVersion: APP_VERSION,
          mode: "demo",
          abi,
        });
        if (alive && r.available) setUpdate(r);
      } catch {
        // Update check must never break the shop.
      }
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    // Heartbeat: on open, on foreground, and every 5 minutes while
    // the app stays open, only when online. Sends ONLY deviceId +
    // shopName + model + appVersion (block/unlock + presence —
    // nothing else goes online). No-op when the license server is
    // not configured; any failure leaves the app fully working.
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const [deviceId, model] = await Promise.all([
          getDeviceId(),
          getDeviceModel(),
        ]);
        const r = await maybeCheckLicenseHeartbeat({
          deviceId,
          shopName: ref.current.profile.shopName,
          model,
          appVersion: APP_VERSION,
        });
        if (!alive) return;
        if (r.status === "blocked") setBlocked(true);
        else if (!r.error && !r.skipped) setBlocked(false);
      } catch {
        // Heartbeat must never break the shop.
      }
    };
    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    // Re-check while the app stays open in the foreground: a block
    // issued from the Master app must lock this app without waiting
    // for a restart. Same 5-minute throttle as the heartbeat itself,
    // so the interval never spams the server.
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
        <UpdateBanner info={update} onDismiss={() => setUpdate(null)} />
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
