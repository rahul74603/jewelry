import { useEffect, useRef, useState } from "react";
import {
  demoMutation,
  loadDemoWorkspace,
  saveDemoWorkspace,
} from "./lib/demo";
import { Shop } from "./lib/store";
import { Shell } from "./components/Shell";
import { getDeviceId } from "./lib/offlineActivation";
import {
  getPrimaryAbi,
  maybeCheckLatest,
  type UpdateAvailable,
} from "./lib/appUpdate";
import { UpdateBanner } from "./components/UpdateBanner";

/** Build version baked in by CI (VITE_APP_VERSION=1.0.<run number>); "dev" locally. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "dev";

/**
 * Master app (VITE_APP_MODE=master) — Ajay's own tool, one app
 * that does everything.
 *
 * It runs the FULL shopkeeper experience (the same Shell as the
 * Customer app: Dashboard, single-screen Billing, Catalog,
 * Customers, Girvi & EMI, Reports, Settings) with its own demo
 * workspace (loadDemoWorkspace/saveDemoWorkspace — separate from
 * the Customer app because it is a different package, which is
 * correct: this is his TEST copy, so he can test the whole shop
 * flow on the Master app itself without installing the Customer
 * app). The master features live in the sidebar as their own
 * entries (see Shell.tsx): "Code banao" (key generation),
 * "Licenses" (block/unblock + issued-keys register with
 * tap-to-reveal key view) and "Updates" (staged rollout +
 * "Sabko update bhejo").
 *
 * The shop screens inside Master run UNLOCKED — no customer
 * activation gate (main.tsx already skips the gate for master
 * mode, and there is no license heartbeat/block here). The
 * Master app's own update check (mode=master) runs once per open,
 * at most once a day, fail-open like the customer app; every
 * update is optional, the banner always offers [Baad me].
 */
export default function Master() {
  const [data, setData] = useState(loadDemoWorkspace);
  const ref = useRef(data);
  const [update, setUpdate] = useState<UpdateAvailable | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) return;
      try {
        const [deviceId, abi] = await Promise.all([
          getDeviceId(),
          getPrimaryAbi(),
        ]);
        const r = await maybeCheckLatest({
          deviceId,
          currentVersion: APP_VERSION,
          mode: "master",
          abi,
        });
        if (alive && r.available) setUpdate(r);
      } catch {
        // Update check must never break the Master app.
      }
    };
    void check();
    return () => {
      alive = false;
    };
  }, []);
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
