/**
 * Lazy Firebase access for the offline-license heartbeat.
 *
 * The Demo/Master builds ship WITHOUT Firebase config (the CI
 * workflow sets only VITE_APP_MODE — no VITE_FIREBASE_* vars, no
 * secrets), and src/lib/cloud.ts runs initializeApp at import time,
 * so importing it at module top level would break the build when
 * unconfigured. Everything here is therefore lazy: nothing touches
 * Firebase until isFirebaseConfigured() is true AND a caller asks
 * for the API, and only then is cloud.ts dynamically imported.
 */
export function isFirebaseConfigured(): boolean {
  const e = import.meta.env;
  return Boolean(
    e.VITE_FIREBASE_PROJECT_ID?.trim() &&
      e.VITE_FIREBASE_API_KEY?.trim() &&
      e.VITE_FIREBASE_APP_ID?.trim() &&
      e.VITE_APP_CHECK_SITE_KEY?.trim(),
  );
}

/** The asia-south1 Functions instance, imported only when configured. */
export async function getFunctionsApi() {
  if (!isFirebaseConfigured())
    throw Error("Firebase is not configured in this build.");
  const { api } = await import("./cloud");
  return api;
}
