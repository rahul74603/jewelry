import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker, useLocation, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Modal } from "./ui";
import { useToast } from "../lib/store";
import {
  NavigationGuard,
  isDirty,
  markSaved,
  historyPaths,
} from "../lib/navigation";

const saving = () => !!document.querySelector('[data-saving="true"]');
function overlay() {
  // Radix portals are appended in stack order. Native select/IME and the Android
  // print activity consume their own Back before it reaches our activity.
  const top = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][data-state="open"],[role="menu"][data-state="open"],[role="listbox"][data-state="open"]',
    ),
  ].at(-1);
  if (top)
    return {
      routed: top.hasAttribute("data-route-panel"),
      close: () => {
        if (top.getAttribute("role") === "dialog")
          top
            .querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')
            ?.click();
        else
          top.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
      },
    };
  const drawer = document.querySelector<HTMLButtonElement>(".drawer-backdrop");
  if (drawer) return { routed: false, close: () => drawer.click() };
}
export function BackNavigation({ children }: { children: ReactNode }) {
  const loc = useLocation(),
    nav = useNavigate(),
    toast = useToast(),
    armed = useRef<number | null>(null);
  const [pending, P] = useState<{
    discard: () => void;
    keep: () => void;
  } | null>(null);
  const guard = useCallback((scope: ParentNode | null, close: () => void) => {
    if (saving()) return;
    if (isDirty(scope)) {
      P({
        discard: () => {
          markSaved(scope);
          close();
        },
        keep: () => {},
      });
    } else close();
  }, []);
  const blocker = useBlocker(
    ({ historyAction, currentLocation, nextLocation }) => {
      if (
        currentLocation.pathname + currentLocation.search ===
        nextLocation.pathname + nextLocation.search
      )
        return false;
      if (saving()) return true;
      const top = overlay();
      return (
        isDirty(document) ||
        (historyAction === "POP" &&
          !!top &&
          (!top.routed || currentLocation.pathname !== nextLocation.pathname))
      );
    },
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (saving()) {
      blocker.reset();
      return;
    }
    const top = overlay();
    if (
      top &&
      (!top.routed ||
        (!isDirty(document) && blocker.location.pathname !== loc.pathname))
    ) {
      blocker.reset();
      top.close();
      return;
    }
    P({
      keep: () => blocker.reset(),
      discard: () => {
        markSaved(document);
        blocker.proceed();
      },
    });
  }, [blocker, loc.pathname]);
  useLayoutEffect(() => {
    armed.current = null;
    historyPaths.set(
      Number(history.state?.idx ?? 0),
      loc.pathname + loc.search,
    );
  }, [loc.key, loc.pathname, loc.search]);
  const back = useRef(() => {});
  back.current = () => {
    if (saving()) return;
    const top = overlay();
    if (top) {
      armed.current = null;
      top.close();
      return;
    }
    const home =
      loc.pathname === "/" &&
      !loc.search &&
      document.querySelector<HTMLElement>("[data-shop-home]");
    if (home) {
      const now = performance.now();
      if (armed.current !== null && now - armed.current < 2000) {
        armed.current = null;
        void App.exitApp();
      } else {
        armed.current = now;
        toast(
          home.lang === "hi"
            ? "बाहर निकलने के लिए दोबारा Back दबाएं"
            : "Press back again to exit",
          2000,
        );
      }
      return;
    }
    armed.current = null;
    // Only return to a distinct location actually visited in this mounted app.
    // A fresh WebView/deep link has no trusted predecessor; never pop to another origin.
    if (
      !document.querySelector("main.content") ||
      document.querySelector('[data-setup-required="true"]')
    )
      return;
    const index = Number(history.state?.idx ?? 0),
      current = loc.pathname + loc.search;
    for (let prev = index - 1; historyPaths.has(prev); prev--) {
      const path = historyPaths.get(prev)!;
      if (
        path !== current &&
        /^\/(?:$|(?:billing(?:\/[A-Za-z0-9_-]+)?|inventory|customers|rates|reports|settings)(?:\?|$))/.test(
          path,
        )
      ) {
        void nav(prev - index);
        return;
      }
    }
    if (loc.search) void nav(loc.pathname, { replace: true });
    else if (loc.pathname !== "/")
      void nav(loc.pathname.startsWith("/billing/") ? "/billing" : "/", {
        replace: true,
      });
  };
  useEffect(() => {
    const edit = (e: Event) => {
      const form = e.target instanceof Element && e.target.closest("form");
      if (form && !form.hasAttribute("data-unsaved"))
        form.dataset.edited = "true";
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (isDirty(document)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const reset = () => {
      armed.current = null;
    };
    document.addEventListener("input", edit, true);
    document.addEventListener("change", edit, true);
    document.addEventListener("visibilitychange", reset);
    window.addEventListener("beforeunload", unload);
    const listener =
      Capacitor.getPlatform() === "android"
        ? App.addListener("backButton", () => back.current())
        : null;
    return () => {
      void listener?.then((h) => h.remove());
      document.removeEventListener("input", edit, true);
      document.removeEventListener("change", edit, true);
      document.removeEventListener("visibilitychange", reset);
      window.removeEventListener("beforeunload", unload);
    };
  }, []);
  const keep = () => {
    pending?.keep();
    P(null);
  };
  return (
    <NavigationGuard.Provider value={guard}>
      {children}
      <Modal
        open={!!pending}
        title="Discard unsaved changes?"
        description="Your unsaved edits will be lost."
        onClose={keep}
      >
        <div className="modal-actions">
          <button className="btn outline" onClick={keep}>
            Continue Editing
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const action = pending?.discard;
              P(null);
              action?.();
            }}
          >
            Discard Changes
          </button>
        </div>
      </Modal>
    </NavigationGuard.Provider>
  );
}
