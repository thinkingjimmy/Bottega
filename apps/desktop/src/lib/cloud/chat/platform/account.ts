/**
 * [INPUT]: Depends on the existing main account bridge and renderer account subscription source.
 * [OUTPUT]: Provides an account-scoped shared facade without owning authentication or synchronization state.
 * [POS]: Desktop Chat account adapter; account changes fence queued device reads and account actions.
 */
import { useMemo } from "react";
import type { AccountFacade, AccountSnapshot } from "@ai-chat/chat-ui/contracts";
import type { CloudAccountState, CloudBridgeApi } from "../../../../../shared/cloud-ipc";
import { cloudAccountClient, cloudAccountSource, useCloudAccount } from "../../client";
type Source = { snapshot(): CloudAccountState; subscribe(changed: () => void): () => void };
export function desktopAccountFacade(bridge: Pick<CloudBridgeApi, "startLogin" | "signOut" | "listDevices">, source: Source, userId?: string): AccountFacade {
  let previous: CloudAccountState | undefined, projected: AccountSnapshot;
  const snapshot = () => {
    const state = source.snapshot(); if (previous === state) return projected;
    previous = state;
    const sameAccount = !userId || state.profile?.userId === userId;
    projected = { state: !sameAccount ? "blocked" : state.status === "ready" ? "ready" : state.status === "temporarily-offline" ? "offline" :
      ["signed-out", "local-only"].includes(state.status) ? "signed-out" : "blocked",
    profile: sameAccount ? state.profile : null, deviceId: sameAccount ? state.deviceId : null };
    return projected;
  };
  const admitted = () => { if (snapshot().state !== "ready") throw new Error("CHAT_ACCOUNT_UNAVAILABLE"); };
  return { snapshot, subscribe: source.subscribe,
    signIn: async () => { if (userId && source.snapshot().profile?.userId !== userId) throw new Error("CHAT_ACCOUNT_CHANGED"); await bridge.startLogin(); },
    signOut: async () => { const state = snapshot(); if (!state.profile || !["ready", "offline"].includes(state.state)) throw new Error("CHAT_ACCOUNT_UNAVAILABLE"); await bridge.signOut(); },
    devices: async cursor => { admitted(); const page = await bridge.listDevices({ cursor }); admitted(); return page; } };
}
export function useDesktopAccountFacade() {
  const state = useCloudAccount(), userId = state.profile?.userId;
  return useMemo(() => desktopAccountFacade({ startLogin: () => cloudAccountClient().startLogin(), signOut: () => cloudAccountClient().signOut(),
    listDevices: input => cloudAccountClient().listDevices(input) }, cloudAccountSource, userId), [userId]);
}
