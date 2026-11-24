import { initializeApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from "firebase/app-check";
import { type Action, stableJson } from "../../functions/src/core/model";
import { deviceIdentity, hash } from "./device";
const e = import.meta.env;
const app = initializeApp({
  apiKey: e.VITE_FIREBASE_API_KEY,
  authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: e.VITE_FIREBASE_PROJECT_ID,
  appId: e.VITE_FIREBASE_APP_ID,
});
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(e.VITE_APP_CHECK_SITE_KEY),
  isTokenAutoRefreshEnabled: true,
});
export const auth = initializeAuth(app, { persistence: inMemoryPersistence });
export const api = getFunctions(app, "asia-south1");
export async function secured<T>(action: Action, payload: unknown): Promise<T> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw Error("Sign in first.");
  const key = await deviceIdentity(uid);
  if (action === "activate")
    payload = {
      code: (payload as { code: string }).code,
      publicKey: key.publicKey,
      platform: key.platform,
    };
  const digest = await hash(new TextEncoder().encode(stableJson(payload)));
  const challenge = (
    await httpsCallable<unknown, { message: string; challengeId: string }>(
      api,
      "beginDeviceRequest",
    )({ action, deviceId: key.deviceId, digest })
  ).data;
  const signature = await key.sign(challenge.message);
  return (
    await httpsCallable<unknown, T>(
      api,
      "completeDeviceRequest",
    )({
      payload,
      challengeId: challenge.challengeId,
      encoding: key.encoding,
      signature,
    })
  ).data;
}
export async function company<T>(op: string, data: unknown = {}): Promise<T> {
  return (await httpsCallable<unknown, T>(api, "companyConsole")({ op, data }))
    .data;
}
