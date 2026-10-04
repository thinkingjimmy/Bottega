/**
 * [INPUT]: Depends on the card setup intent and the existing settings/runtime facts and consent opener.
 * [OUTPUT]: Provides useMemoryPluginSetup, consuming one card intent once initial data arrives and opening only the original consent UI.
 * [POS]: Memory plugin entry adapter; an unconfigured backend stays on the existing setup surface and cancellation never reopens consent.
 */
import { useEffect, useRef } from "react";
import type { AppSettings } from "../../../shared/ipc/settings/settings-ipc";
import type { MemoryRuntimeSnapshot } from "../../../shared/ipc/content/memory-ipc";
import type { MemoryPageOptions } from "./page-frame";

export function useMemoryPluginSetup(page: MemoryPageOptions, settings: AppSettings | null,
  runtimes: Record<string, MemoryRuntimeSnapshot>, loading: boolean, openConsent: (id: string) => void) {
  const consumed = useRef(false);
  useEffect(() => {
    if (!page.setupRequested || consumed.current || !settings || loading || page.unsupported) return;
    const runtime = runtimes[settings.memory.provider];
    if (!runtime) return;
    consumed.current = true;
    page.onSetupHandled?.();
    if (!settings.memory.enabled && runtime.installed && runtime.configured) openConsent(settings.memory.provider);
  }, [page, settings, runtimes, loading, openConsent]);
}
