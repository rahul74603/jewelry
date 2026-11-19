import { createContext, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
export const NavigationGuard = createContext<
  (scope: ParentNode | null, close: () => void) => void
>((_, close) => close());
export const useDismissGuard = () => useContext(NavigationGuard);
const selector = '[data-unsaved="true"],form[data-edited="true"]';
export function isDirty(scope: ParentNode | null) {
  return (
    !!scope &&
    ((scope instanceof Element && scope.matches(selector)) ||
      !!scope.querySelector(selector))
  );
}
export function markSaved(scope: ParentNode | null) {
  if (!scope) return;
  const nodes = [
    ...(scope instanceof Element ? [scope] : []),
    ...scope.querySelectorAll(selector + ', [data-saving="true"]'),
  ];
  for (const el of nodes) {
    if (el.hasAttribute("data-unsaved"))
      el.setAttribute("data-unsaved", "false");
    if (el.hasAttribute("data-saving")) el.setAttribute("data-saving", "false");
    el.removeAttribute("data-edited");
  }
}
export const historyPaths = new Map<number, string>();
// Pop the detail entry, not a new push of the list (which would reopen the detail on Back).
export function useClosePanel() {
  const nav = useNavigate(),
    loc = useLocation();
  return () => {
    const prev = historyPaths.get(Number(history.state?.idx) - 1);
    if (prev === loc.pathname) void nav(-1);
    else void nav(loc.pathname, { replace: true });
  };
}
