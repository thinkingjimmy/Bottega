/**
 * [INPUT]: Depends on React effects, active route/settings facts, Sidebar App target, and pending origin/navigation state
 * [OUTPUT]: Provides cold-residence-safe origin cleanup and direct-navigation supersession of in-flight App alias intents
 * [POS]: Sidebar navigation reconciliation hook; bridges local route intent to the main-owned generation fence
 */

import { useEffect } from "react";
import { sidebarAppOriginStore, type SidebarAppOrigin } from "./app-origin";
import {
  activeAppId,
  originMatchesTarget,
  type SidebarAppTarget,
} from "./app-target";

export function useAppOriginReconciliation(input: Readonly<{
  activePath: string;
  settingsOpen: boolean;
  origin: SidebarAppOrigin;
  target: SidebarAppTarget;
}>) {
  useEffect(() => {
    const pending = sidebarAppOriginStore.pendingActivation();
    if (
      pending &&
      (input.settingsOpen || activeAppId(input.activePath) !== pending.appId)
    ) {
      void sidebarAppOriginStore.supersedeNavigation().ready.catch(() => undefined);
    }
    if (input.origin && !originMatchesTarget(input.origin, input.target)) {
      sidebarAppOriginStore.clear();
    }
  }, [input.activePath, input.origin, input.settingsOpen, input.target]);
}
