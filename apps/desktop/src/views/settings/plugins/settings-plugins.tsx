/**
 * [INPUT]: Depends on React Router, SettingsPage, the Settings canvas and alert, workbench-copy, the main window's bounded summary catalog, complete identity index, exact full detail and original plugins bridges, shared stage metadata, settings
 *           navigation, and settings/plugins (list hook, grid, the plugin introduction and settings pages, shared switch, and lazy native package lifecycle panel).
 * [OUTPUT]: Provides PluginsSettingsView — All plugins (the complete grouped catalog), a plugin's introduction, or a plugin's settings page; turning
 *           off uses the shared impact confirmation. Memory's settings page directly reuses its existing settings UI; Dock's reuses its
 *           original sections and target-scoped setup flow. Related pages use the same Settings navigation; source authoring prepares a
 *           lazy Create-mode source intent without allocating a Project. Canonical HostPackage entries delegate original install-identity detail/settings/lifecycle and deduplicate the old rows. Completed package uninstall returns to the catalog and its retained-data controls.
 * [POS]: apps/desktop/src/views/settings/plugins; Reached only when the workbench build flag is on. ProductApp owns the target: a card or a background surface opens the
 *        introduction; the sidebar's Plugins entries (turned-on plugins with settings) and the introduction's Settings icon open the
 *        settings page. The unified catalog includes New plugin and trust-reviewed local installation; introductions keep a catalog return and one hero H1. Turning a plugin off on its settings
 *        page keeps the page, so owner recovery (Dock) stays reachable while off.
 */
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { useSettingsNavigation } from "@/components/providers/navigation/context";
import { useNavigate } from "react-router";
import { formatWorkbench, useWorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsPage } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsAlert, SettingsButton, SettingsCanvas } from "@/components/settings/settings-layout";
import { openPluginAuthoring } from "@/components/settings/plugins/authoring/open";
import { pluginText } from "@/components/settings/plugins/copy";
import { PluginGrid } from "@/components/settings/plugins/grid";
import { PluginAboutPage, PluginControl } from "@/components/settings/plugins/detail/about";
import { PluginSettingsPage } from "@/components/settings/plugins/detail/settings-page";
import { PluginStage } from "@/components/settings/plugins/detail/metadata";
import { usePluginSwitch } from "@/components/settings/plugins/turn-off";
import { pluginPlatformBridge,hostPackageIdentity } from "@/lib/plugin-platform/client";
import {useUnifiedPlugins} from '@/lib/plugin-platform/projection/catalog';
import {useUnifiedPluginIndex,useRuntimePlugins} from '@/lib/plugin-platform/projection/runtime';
import {usePluginDetail} from '@/lib/plugin-platform/projection/detail';
import { pluginPlatformCopy } from "@/lib/plugin-platform/copy";
import { UnifiedPluginCards, UnifiedPluginDetail } from "@/components/settings/plugins/platform/catalog";
import { InstallUnifiedPlugin } from "@/components/settings/plugins/platform/install";
import { PluginAdapters } from "@/components/settings/plugins/platform/adapters";
import { usePluginList } from "@/components/settings/plugins/use-plugins";
import type { PluginDetail, PluginView, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { loadSection } from "../../../../shared/i18n/sections";
import { pluginsBridge } from "@/lib/apps/plugins-client";
import { MemoryPluginPage } from "../../settings-memory/plugin-page";
import { SKILLS_SETTINGS_PATH, requestSettingsSection, type PluginTarget } from "@/lib/settings/navigation/settings-navigation";

const loadDockSettings = () => Promise.all([
  import("@/views/settings/dock/settings-dock"), loadSection("systemDock", effectiveLocale()),
]).then(([module]) => module);
const DockSettingsContent = lazy(() => loadDockSettings().then(module => ({ default: module.DockSettingsContent })));
const DockPluginSetupDialog = lazy(() => loadDockSettings().then(module => ({ default: module.DockPluginSetupDialog })));
const NativePackagePanel = lazy(() => import("@/components/settings/plugins/packages/panel"));

export function PluginsSettingsView({ bridge = pluginsBridge(), computerName, target = null, onOpenPlugin = () => undefined }: {
  bridge?: PluginsBridge | null;
  computerName?: string;
  /** The open plugin page, or null for All plugins. */
  target?: PluginTarget | null;
  onOpenPlugin?: (target: PluginTarget | null) => void;
}) {
  const { i18n } = useAppTranslation();
  const locale = i18n.language;
  const workbench = useWorkbenchCopy(locale);
  const copy = workbench.plugins;
  const navigate = useNavigate();
  const settingsNavigation = useSettingsNavigation();
  /* Dock setup opens where it was asked for; going to another page ends that setup session. */
  const page = target ? `${target.view}:${target.id}` : "";
  const [dockSetup, setDockSetup] = useState({ page, open: false });
  if (dockSetup.page !== page) setDockSetup({ page, open: false });
  const setDockSetupOpen = (open: boolean) => setDockSetup({ page, open });
  const [authoringError, setAuthoringError] = useState("");
  const authoringBusy = useRef(false);
  const openAuthoring = (id: string) => {
    if (authoringBusy.current) return;
    authoringBusy.current = true; setAuthoringError("");
    void openPluginAuthoring(workbench.guiHistory, id).then(route => { settingsNavigation?.close?.(); return navigate(route); })
      .catch(cause => setAuthoringError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { authoringBusy.current = false; });
  };
  const plugins = usePluginList(bridge);
  const unified=useUnifiedPlugins(),index=useUnifiedPluginIndex(),surfaces=useRuntimePlugins(),platformCopy=pluginPlatformCopy(locale);
  const summary=target?index.items.find(item=>item.manifest.id===target.id||hostPackageIdentity(item)===target.id):undefined;
  const detail=usePluginDetail(summary?.manifest.id??target?.id),native=detail.plugin;
  const hostPackageId=summary?hostPackageIdentity(summary):native?hostPackageIdentity(native):undefined;
  const detailId=hostPackageId??target?.id;
  const switching = usePluginSwitch({ bridge, workbench, locale, computerName, plugins });
  const canonicalId=(id:string)=>index.items.find(item=>hostPackageIdentity(item)===id)?.manifest.id??id;
  const openAbout = (id: string) => onOpenPlugin({ id:canonicalId(id), view: "about" });
  const openSettings = (id: string) => onOpenPlugin({ id:canonicalId(id), view: "settings" });
  const openRelated = (section: PluginDetail["related"][number]) => {
    if (section === "memory") openSettings("memory");
    else if (section === "skills") void navigate(SKILLS_SETTINGS_PATH);
    else requestSettingsSection({ section });
  };
  /* A setup plugin is never switched on directly (plugin-setup-required): its own flow turns it on. */
  const setup = (plugin: PluginView) => {
    if (plugin.turnOn.mode !== "setup") return;
    setDockSetupOpen(true);
  };
  const plugin = target ? plugins?.find(item => item.id === detailId) ?? null : null;
  const view = target?.view ?? null;
  const name = plugin ? pluginText(plugin.name, workbench) : "";

  if(summary&&!native&&!hostPackageId)return <SettingsPage><SettingsCanvas><SettingsAlert>{detail.error||platformCopy.loading}</SettingsAlert></SettingsCanvas></SettingsPage>;

  if (native && target && !hostPackageId && !(view === "settings" && plugin?.hasSettings)) {
    return <SettingsPage><SettingsCanvas><div className="mb-5"><SettingsButton data-plugin-back="" variant="ghost" onClick={()=>onOpenPlugin(null)}><ArrowLeft className="size-3.5"/>{copy.back}</SettingsButton></div>
      <UnifiedPluginDetail key={native.manifest.id} plugin={native} items={index.items} locale={locale} onOpen={openAbout} onRemoved={()=>onOpenPlugin(null)}/>
    </SettingsCanvas></SettingsPage>;
  }

  if (target?.id === "memory" && view === "settings") {
    return <MemoryPluginPage onAbout={() => openAbout("memory")}
      unsupported={plugin?.availability.state === "unsupported"} />;
  }
  const alerts = <>
    {switching.failed && <SettingsAlert>{switching.failed}</SettingsAlert>}
    {authoringError && <SettingsAlert>{authoringError}</SettingsAlert>}
  </>;
  const dialogs = <>
    {switching.dialog}
    {dockSetup.open && <Suspense fallback={null}><DockPluginSetupDialog onExit={() => setDockSetupOpen(false)} /></Suspense>}
  </>;

  if (target && bridge && view === "settings") {
    return (
      <div className="h-full" data-plugin-detail={target.id} data-plugin-view="settings">
      <SettingsPage title={name} titleAdornment={plugin && <PluginStage plugin={plugin} workbench={workbench} />} actions={<>
        <SettingsButton variant="ghost" onClick={() => openAbout(target.id)} data-plugin-about-link="">
          {name && formatWorkbench(copy.aboutPlugin, { name })}<ArrowUpRight aria-hidden className="size-3.5" /></SettingsButton>
        {plugin && <PluginControl plugin={plugin} workbench={workbench} switching={switching} onSetup={setup} />}
      </>}>
        <SettingsCanvas>
          {alerts}
          <PluginSettingsPage key={detailId} pluginId={detailId!} bridge={bridge} workbench={workbench} locale={locale} switching={switching}
            onOpenRelated={openRelated} settingsContent={target.id === "dock" ? <Suspense fallback={null}><DockSettingsContent plugin /></Suspense> : undefined} />
        </SettingsCanvas>
        {dialogs}
      </SettingsPage>
      </div>
    );
  }

  if (target && bridge) {
    return (
      <SettingsPage>
        <SettingsCanvas>
        <div className="mb-5 [-webkit-app-region:no-drag]">
        <SettingsButton data-plugin-back="" variant="ghost" onClick={() => onOpenPlugin(null)}><ArrowLeft className="size-3.5" />{copy.back}</SettingsButton>
        </div>
          {alerts}
          <PluginAboutPage key={detailId} pluginId={detailId!} bridge={bridge} workbench={workbench} locale={locale} plugins={plugins ?? []}
            switching={switching} hasSettingsPage={plugin?.hasSettings ?? false} onOpenPlugin={openAbout} onOpenSettings={openSettings}
            onOpenRelated={openRelated} onSetup={setup} onEditSource={hostPackageId?undefined:openAuthoring} />
          {/^sha256:[a-f0-9]{64}$/.test(detailId??"") && <Suspense fallback={null}><NativePackagePanel key={detailId} installIdentity={detailId} onUninstalled={() => onOpenPlugin(null)} /></Suspense>}
        </SettingsCanvas>
        {dialogs}
      </SettingsPage>
    );
  }

  return (
    <SettingsPage title={copy.sidebarAll} actions={<><SettingsButton disabled={!pluginPlatformBridge()} onClick={()=>openAuthoring("")}>{platformCopy.newPlugin}</SettingsButton><InstallUnifiedPlugin locale={locale} onInstalled={openAbout}/></>}>
      <SettingsCanvas>
        {alerts}
        <div className="flex flex-col gap-5">
          <p className="text-pretty text-muted-foreground text-sm">{copy.description}</p>
          {unified.page?.safeMode && <SettingsAlert tone="warn">{platformCopy.safeMode}<SettingsButton variant="ghost" onClick={()=>openAbout(unified.page!.safeMode!.pluginId)}>{platformCopy.details}</SettingsButton></SettingsAlert>}
          {unified.error && <SettingsAlert>{platformCopy.loadFailed}<SettingsButton variant="ghost" onClick={()=>void unified.reload()}>{platformCopy.retry}</SettingsButton></SettingsAlert>}
          <UnifiedPluginCards items={unified.items} locale={locale} onOpen={openAbout}/>
          {unified.page?.nextCursor && <SettingsButton variant="outline" disabled={unified.busy} onClick={()=>void unified.reload(true)}>{platformCopy.more}</SettingsButton>}
          {plugins && <PluginGrid plugins={plugins.filter(item=>!/^sha256:[a-f0-9]{64}$/.test(item.id)&&!index.items.some(native=>native.manifest.id===item.id||native.manifest.id===`bottega.${item.id}`))} workbench={workbench} state={switching.state}
            onOpen={item => openAbout(item.id)} onToggle={switching.toggle} onSetup={setup} />}
          <PluginAdapters native={index.items} surfaces={surfaces.items} locale={locale}/>
        </div>
      </SettingsCanvas>
      {dialogs}
    </SettingsPage>
  );
}
