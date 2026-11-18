import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { Feedback } from "./lib/store";
import "./styles.css";
const Root =
  import.meta.env.VITE_APP_MODE === "live"
    ? lazy(() => import("./Live"))
    : lazy(() => import("./Demo"));
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
createRoot(document.getElementById("root")!).render(
  <Boundary>
    <HashRouter>
      <Feedback>
        <Suspense
          fallback={
            <div className="spinner-page">
              <i className="spinner" />
              Opening workspace…
            </div>
          }
        >
          <Root />
        </Suspense>
      </Feedback>
    </HashRouter>
  </Boundary>,
);
