import { useRef, useState } from "react";
import {
  demoMutation,
  loadDemoWorkspace,
  saveDemoWorkspace,
} from "./lib/demo";
import { Shop } from "./lib/store";
import { Shell } from "./components/Shell";
export default function Demo() {
  const [data, setData] = useState(loadDemoWorkspace);
  const ref = useRef(data);
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
