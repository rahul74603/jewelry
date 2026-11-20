import React, { lazy, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { BackNavigation } from "./components/BackNavigation";
import ActivationGate from "./components/ActivationGate";
import { Feedback } from "./lib/store";
import { isOfflineLicensed } from "./lib/offlineActivation";
import "./styles.css";
const MODE = import.meta.env.VITE_APP_MODE;
const Root =
  MODE === "live"
    ? lazy(() => import("./Live"))
    : MODE === "master"
      ? lazy(() => import("./Master"))
      : lazy(() => import("./Demo"));
/**
 * User modes (demo + live) open behind the full-screen offline
 * activation lock until this device is unlocked — MediSmart-style.
 * Master mode has no lock: it IS the developer's key tool.
 */
function GatedRoot() {
  const [unlocked, setUnlocked] = useState(() => isOfflineLicensed());
  if (MODE === "master" || unlocked) return <Root />;
  return <ActivationGate onUnlocked={() => setUnlocked(true)} />;
}
class Boundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="spinner-page">
          <h2>Workspace could not open</h2>
          <p>Reload the app. If this continues, contact your provider.</p>
          <button className="btn outline" onClick={() => location.reload()}>
            Reload workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
const router = createHashRouter([
  {
    path: "*",
    element: (
      <Feedback>
        <BackNavigation>
          <Suspense
            fallback={
              <div className="spinner-page">
                <i />
                Opening workspace…
              </div>
            }
          >
            <GatedRoot />
          </Suspense>
        </BackNavigation>
      </Feedback>
    ),
  },
]);
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <RouterProvider router={router} />
  </Boundary>,
);
