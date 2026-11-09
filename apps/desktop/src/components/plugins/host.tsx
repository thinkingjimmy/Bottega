/**
 * [INPUT]: Native Dock settings, shared navigation, locale catalogs and plugin presentation copy.
 * [OUTPUT]: NativePluginPage renders the main-owned Dock settings page without a duplicate lifecycle.
 * [POS]: Unified native page adapter; privileged registration supplies the host-view identity.
 */
import { lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { pluginPlatformCopy } from "@/lib/plugin-platform/copy";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { loadSection } from "../../../shared/i18n/sections";
const DockSettings = lazy(() => Promise.all([import("@/views/settings/dock/settings-dock"), loadSection("systemDock", effectiveLocale())])
  .then(([module]) => ({ default: module.DockSettingsContent })));
export function NativePluginPage({ view, name }: { view: "dock-settings"; name: string }) {
  const { i18n } = useAppTranslation(), copy = pluginPlatformCopy(i18n.language);
  return <PageShell title={name} backHref="/"><div className="h-full overflow-auto" data-native-plugin-view={view}>
    <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">{copy.loading}</p>}><DockSettings /></Suspense>
  </div></PageShell>;
}
