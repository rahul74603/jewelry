import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  if (env.VITE_APP_MODE && !["live", "demo"].includes(env.VITE_APP_MODE))
    throw Error("VITE_APP_MODE must be demo or live");
  if (env.VITE_APP_MODE === "live")
    for (const field of [
      "FIREBASE_API_KEY",
      "FIREBASE_AUTH_DOMAIN",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_APP_ID",
      "APP_CHECK_SITE_KEY",
    ])
      if (!env["VITE_" + field]?.trim())
        throw Error(`Live build requires VITE_${field}`);
  return {
    plugins: [react()],
    server: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
    preview: { host: "0.0.0.0", allowedHosts: [".e2b.app"] },
    test: { include: ["tests/**/*.test.ts"] },
  };
});
