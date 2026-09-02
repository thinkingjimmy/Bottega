/**
 * [INPUT]: Depends on React external-store hooks and the main-owned surface navigation-intent fence
 * [OUTPUT]: Provides non-persistent SidebarAppOrigin, pending activation facts, and renderer/main shared last-intent-wins generations
 * [POS]: Ephemeral navigation provenance and intent ordering; never participates in durable App, Project, route, or grant identity
 */

import { useSyncExternalStore } from "react";
import { beginSurfaceNavigationIntent } from "@/lib/window-surfaces-client";

export type SidebarAppOrigin = Readonly<{
  appId: string;
  projectId: string;
}> | null;

let origin: SidebarAppOrigin = null;
let activationEpoch = 0;
let intentSerial = 0;
let pending: Readonly<{ epoch: number; appId: string }> | null = null;
const listeners = new Set<() => void>();

function publish(next: SidebarAppOrigin) {
  if (origin?.appId === next?.appId && origin?.projectId === next?.projectId) return;
  origin = next;
  for (const listener of listeners) listener();
}

export const sidebarAppOriginStore = {
  getSnapshot: () => origin,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(next: SidebarAppOrigin) {
    activationEpoch += 1;
    pending = null;
    publish(next);
  },
  clear() {
    activationEpoch += 1;
    pending = null;
    publish(null);
  },
  beginActivation(appId: string) {
    return beginNavigation(appId);
  },
  supersedeNavigation() {
    return beginNavigation(null);
  },
  pendingActivation() {
    return pending;
  },
  isCurrent(epoch: number) {
    return epoch === activationEpoch;
  },
  finishNavigation(epoch: number) {
    if (epoch !== activationEpoch) return false;
    pending = null;
    return true;
  },
  commitActivation(epoch: number, next: Exclude<SidebarAppOrigin, null>) {
    if (epoch !== activationEpoch) return false;
    pending = null;
    publish(next);
    return true;
  },
};

function beginNavigation(appId: string | null) {
  const epoch = ++activationEpoch;
  const intentId = `sidebar:${Date.now().toString(36)}:${++intentSerial}`;
  pending = appId ? { epoch, appId } : null;
  publish(null);
  return {
    epoch,
    intentId,
    ready: beginSurfaceNavigationIntent(intentId),
  };
}

export function useSidebarAppOrigin() {
  return useSyncExternalStore(
    sidebarAppOriginStore.subscribe,
    sidebarAppOriginStore.getSnapshot,
    sidebarAppOriginStore.getSnapshot
  );
}
