import { useRef, useState } from "react";
import { demoMutation, seedDemo } from "./lib/demo";
import { Shop } from "./lib/store";
import { Shell } from "./components/Shell";
export default function Demo() {
  const [data, setData] = useState(seedDemo);
  const ref = useRef(data);
  return (
    <Shop.Provider
      value={{
        data,
        demo: true,
        perform: async (a, p) => {
          const next = demoMutation(ref.current, a, p);
          ref.current = next;
          setData(next);
        },
      }}
    >
      <Shell />
    </Shop.Provider>
  );
}
