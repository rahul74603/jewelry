import {
  createContext,
  useContext,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import { CheckCircle2, X } from "lucide-react";
import type {
  Action,
  LicenseInfo,
  Workspace,
} from "../../functions/src/core/model";
export type ShopContext = {
  data: Workspace;
  demo: boolean;
  license?: LicenseInfo;
  perform: (action: Action, payload: unknown) => Promise<void>;
  logout?: () => Promise<void>;
};
export const Shop = createContext<ShopContext | null>(null);
export const useShop = () => {
  const s = useContext(Shop);
  if (!s) throw Error("Workspace required");
  return s;
};
const Toast = createContext<(message: string, duration?: number) => void>(
  () => {},
);
export const useToast = () => useContext(Toast);
export function Feedback({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  const notify = useCallback((text: string, duration = 4500) => {
    const id = Date.now();
    setMsg({ text, id });
    setTimeout(() => setMsg((m) => (m?.id === id ? null : m)), duration);
  }, []);
  return (
    <Toast.Provider value={notify}>
      {children}
      {msg && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {msg.text}
          <button
            aria-label="Dismiss notification"
            onClick={() => setMsg(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </Toast.Provider>
  );
}
