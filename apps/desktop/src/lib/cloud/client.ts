/**
 * [INPUT]: Depends on React subscription primitives and the trusted cloud preload projection.
 * [OUTPUT]: Provides event-ordered account/setup subscriptions, a first-snapshot readiness signal, idle setup defaults, a credential-free client, a reconnect-driven handshake re-check and an unmounted-only snapshot reset.
 * [POS]: Renderer account adapter; main owns state, persistence and every network operation.
 */
import { useEffect, useSyncExternalStore } from "react";
import { cloudHandshakeFailed, type CloudAccountState, type CloudBridgeApi } from "../../../shared/cloud-ipc";
import { initialEncryptionState, initialSyncSetupState } from "../../../shared/cloud/encryption";
import { syncProgressSchema } from "../../../shared/cloud/sync";
declare global { interface Window { cloud?: CloudBridgeApi } }
const initial: CloudAccountState = { available: false, environmentId: null, status: "local-only", profile: null, machine: null,
  canDiscardSavedLogin: false, canRetryCredentialStorage: false, canRetryLoginSave: false, loginCancelling: false, cancelUnconfirmed: false, signOutPending: false,
  deviceId: null, pendingLogin: null, error: null, sync: syncProgressSchema.parse({ status: "not-connected" }), encryption: initialEncryptionState, syncSetup: initialSyncSetupState };
let loaded = false;
let value = initial, subscribers = 0, revision = 0, unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();
const change = (next: CloudAccountState) => { value = next; loaded = true; revision++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/* The retained snapshot survives unmounts on purpose (reopening Settings paints the
   last known account at once). forget() is the one seam for dropping it, and only
   while nothing is mounted: a mounted view keeps its truth. */
export const cloudAccountSource = { snapshot: () => value, isLoaded: () => loaded, subscribe, forget() { if (!subscribers) { value = initial; loaded = false; revision++; } } };
export function cloudAccountClient() {
  if (!window.cloud) throw new Error("Cloud account unavailable"); return window.cloud;
}
/* A connection coming back is the cheapest re-check there is, and the only one the renderer
   can see; main is single-flight, so a failing handshake is all this needs to wake it for. */
const reconnected = () => { if (cloudHandshakeFailed(value)) void window.cloud?.retryConnection().catch(() => {}); };
export function useCloudAccount() {
  const state = useSyncExternalStore(subscribe, () => value, () => initial);
  useEffect(() => {
    subscribers++;
    if (subscribers === 1 && window.cloud) {
      unsubscribe = window.cloud.onAccountChanged(change);
      window.addEventListener("online", reconnected);
      const expected = revision;
      void window.cloud.getAccountState().then(next => { if (subscribers && revision === expected) change(next); })
        .catch(() => { if (subscribers && revision === expected) change({ ...initial, status: "error", error: "request-failed" }); });
    }
    return () => { subscribers--; if (!subscribers) { unsubscribe?.(); unsubscribe = null; window.removeEventListener("online", reconnected); revision++; } };
  }, []);
  return state;
}

/** Initial renderer emptiness must never seed onboarding navigation. */
export function useCloudAccountLoaded() {
  return useSyncExternalStore(subscribe, () => !window.cloud || loaded, () => false);
}
