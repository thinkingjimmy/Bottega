/**
 * [INPUT]: Depends on native app-info platform facts, shared platform capabilities, i18n, SettingsPage and Settings primitives.
 * [OUTPUT]: Provides MemorySettingsFrame, MemoryPageOptions (the plugin's About link / one-shot setup intent), useMemoryPlatformSupport and useMemoryClock.
 * [POS]: Shares the content H1 and trailing controls across Memory's standalone and plugin entry points; platform refusal precedes loading content.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsBadge, SettingsButton, SettingsCanvas } from "@/components/settings/settings-layout";
import { appInfoStore } from "@/lib/platform/update-client";
import { resolvePlatformCapabilities } from "../../../shared/platform/platform-capabilities";

export type MemoryPageOptions = { onAbout?: () => void; unsupported?: boolean; setupRequested?: boolean; onSetupHandled?: () => void };

export function useMemoryPlatformSupport() {
  const appInfo = useSyncExternalStore(appInfoStore.subscribe, appInfoStore.getSnapshot);
  useEffect(() => { appInfoStore.ensureLoaded(); }, []);
  return appInfo ? resolvePlatformCapabilities(appInfo.platform).capabilities.memory : null;
}

export function useMemoryClock(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function MemorySettingsFrame({ onAbout, unsupported, actions, children }: MemoryPageOptions & {
  actions?: ReactNode; children: ReactNode;
}) {
  const { t } = useAppTranslation();
  const supported = useMemoryPlatformSupport();
  const unavailable = unsupported || supported === false;
  return <div className="h-full" data-plugin-detail={onAbout ? "memory" : undefined} data-plugin-view={onAbout ? "settings" : undefined}>
    <SettingsPage title={onAbout ? t("memory.plugin.name") : t("common.memory")}
      titleAdornment={onAbout && <SettingsBadge tone="muted">{t("memory.plugin.official")}</SettingsBadge>}
      actions={<>
        {onAbout && <SettingsButton variant="ghost" onClick={onAbout} data-plugin-about-link="">
          {t("memory.plugin.about")}<ArrowUpRight aria-hidden className="size-3.5" />
        </SettingsButton>}
        {!unavailable && actions}
      </>}>
      {unavailable ? <SettingsCanvas><p role="status" data-memory-unsupported="" className="text-sm text-muted-foreground">
        {t("memory.plugin.unsupported")}
      </p></SettingsCanvas> : children}
    </SettingsPage>
  </div>;
}
