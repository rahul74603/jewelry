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
  maybeCheckLicenseHeartbeat,
} from "./lib/licenseCheck";

/** Build version baked in by CI (VITE_APP_VERSION=1.0.<run number>); "dev" locally. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

export default function Demo() {
  const [data, setData] = useState(loadDemoWorkspace);
  const ref = useRef(data);
  // Kill switch: the server-blocked flag persists across launches,
  // so a blocked device shows the lock screen before the shop opens.
  const [blocked, setBlocked] = useState(() => isLicenseBlocked());
  useEffect(() => {
    let alive = true;
    // Heartbeat: at most once a day, only when online. Sends ONLY
    // deviceId + shopName + model + appVersion (block/unlock +
    // presence — nothing else goes online). No-op when Firebase is
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
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (blocked) return <LicenseBlocked />;
  return (
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
  );
}
