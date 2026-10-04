/**
 * [INPUT]: Depends on the shared Setup context and visible page lifecycle events.
 * [OUTPUT]: Requests main-owned freshness checks while an Agent setup surface is visible.
 * [POS]: Shared event-only refresh hook for Onboarding and Agent Settings; no polling.
 */
import { useEffect } from "react";
import { useSetup } from "../setup-provider";

export function useSetupRefresh() {
  const { refreshIfNeeded } = useSetup();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void refreshIfNeeded(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshIfNeeded]);
}
