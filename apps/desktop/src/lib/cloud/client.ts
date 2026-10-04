/**
 * [INPUT]: Depends on React subscription primitives and the trusted cloud preload projection.
 * [OUTPUT]: Provides event-ordered account/setup subscriptions, idle setup defaults, a credential-free client, every online/offline change forwarded to main (T20-2) and an unmounted-only snapshot reset.
 * [POS]: Renderer account adapter; main owns state, persistence and every network operation.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { CloudAccountState, CloudBridgeApi } from "../../../shared/ipc/settings/cloud-ipc";
import { initialEncryptionState, initialSyncSetupState } from "../../../shared/cloud/encryption";
import { syncProgressSchema } from "../../../shared/cloud/sync";
declare global { interface Window { cloud?: CloudBridgeApi } }
const initial: CloudAccountState = { available: false, environmentId: null, status: "local-only", profile: null, machine: null,
  canDiscardSavedLogin: false, canRetryCredentialStorage: false, canRetryLoginSave: false, loginCancelling: false, cancelUnconfirmed: false, signOutPending: false,
  deviceId: null, pendingLogin: null, error: null, sync: syncProgressSchema.parse({ status: "not-connected" }), encryption: initialEncryptionState, syncSetup: initialSyncSetupState };
let value = initial, subscribers = 0, revision = 0, unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();
const change = (next: CloudAccountState) => { value = next; revision++; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
/* The retained snapshot survives unmounts on purpose (reopening Settings paints the
   last known account at once). forget() is the one seam for dropping it, and only
   while nothing is mounted: a mounted view keeps its truth. */
export const cloudAccountSource = { snapshot: () => value, subscribe, forget() { if (!subscribers) { value = initial; revision++; } } };
export function cloudAccountClient() {
  if (!window.cloud) throw new Error("Cloud account unavailable"); return window.cloud;
}
/* Every online/offline change goes to main (TASK-20 T20-2): it wakes a token retry, re-checks a failing handshake and
   reconnects a lost socket; main is single-flight and ignores what does not apply. */
const reconnected = () => { void window.cloud?.networkChanged(true).catch(() => {}); };
const disconnected = () => { void window.cloud?.networkChanged(false).catch(() => {}); };
export function useCloudAccount() {
  const state = useSyncExternalStore(subscribe, () => value, () => initial);
  useEffect(() => {
    subscribers++;
    if (subscribers === 1 && window.cloud) {
      unsubscribe = window.cloud.onAccountChanged(change);
      window.addEventListener("online", reconnected); window.addEventListener("offline", disconnected);
      const expected = revision;
      void window.cloud.getAccountState().then(next => { if (subscribers && revision === expected) change(next); })
        .catch(() => { if (subscribers && revision === expected) change({ ...initial, status: "error", error: "request-failed" }); });
    }
    return () => { subscribers--; if (!subscribers) { unsubscribe?.(); unsubscribe = null; window.removeEventListener("online", reconnected); window.removeEventListener("offline", disconnected); revision++; } };
  }, []);
  return state;
}
