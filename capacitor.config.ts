import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.aurum.jewellery",
  appName: "Aurum Workspace",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, zoomEnabled: true },
};
export default config;
