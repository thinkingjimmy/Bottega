/**
 * [INPUT]: Depends on lucide icons, Settings layout primitives including the named icon action, workbench-copy, the plugins bridge (detail), the shared switch state,
 *           shared GUI history, the card's icon and the read-only sections.
 * [OUTPUT]: Provides PluginControl (the switch, "Turn on…" / "Set up…", or a fixed badge — the same decision as a card) and
 *           PluginAboutPage — a plugin's introduction: hero (icon, name, publisher and health, summary, the control and, when it has
 *           settings, a Settings icon before the control), the one banner that matters, About, What it can do, Works with, In use, Versions
 *           for GUI plugins, and Information with related pages.
 * [POS]: Opened from a card in All plugins or by a background surface naming a plugin (openPlugins(pluginId)). All plugins introduces;
 *        settings live on the sidebar entry's page (settings-page.tsx). An Agent-native plugin is read only and says who manages it.
 */
import type { ReactNode } from "react";
import { Lock, Settings, TriangleAlert } from "lucide-react";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsButton, SettingsIconButton, SettingsSwitch } from "@/components/settings/settings-layout";
import { backendLabel } from "@/lib/agent/agent-backends";
import { PluginHistoryList } from "@/components/gui-history/list";
import type { PluginDetail, PluginView, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { lockedCard, PluginIcon, type CardState } from "../card";
import { pluginPublisher, pluginText } from "../copy";
import { usePluginDetail } from "../use-plugins";
import { AboutSection, CapabilitiesSection, HealthDot, InformationSection, InUseSection, PluginBanners, WorksWithSection } from "./sections";

type Related = PluginDetail["related"][number];
export type Switching = { state: CardState; toggle(plugin: PluginView, enabled: boolean): void };

export function PluginControl({ plugin, workbench, switching, onSetup }: { plugin: PluginView; workbench: WorkbenchCopy; switching: Switching; onSetup(plugin: PluginView): void }) {
  const copy = workbench.plugins;
  const name = pluginText(plugin.name, workbench);
  if (!plugin.turnOff.allowed) {
    return <span className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-muted-foreground text-xs" data-plugin-fixed="">
      <Lock aria-hidden className="size-3.5" />{plugin.turnOff.reason === "always-on" ? copy.alwaysOn : plugin.turnOff.reason === "project-scoped" ? copy.projectScopedBadge
        : formatWorkbench(copy.nativeManagedBy, { agent: backendLabel(plugin.managedBy ?? "") })}</span>;
  }
  if (!plugin.enabled && plugin.turnOn.mode === "setup") {
    return <SettingsButton variant="outline" disabled={plugin.availability.state === "unsupported"} onClick={() => onSetup(plugin)}>
      {plugin.turnOn.setup === "memory-consent" ? copy.setupMemory : copy.setupDock}</SettingsButton>;
  }
  if (switching.state.notes[plugin.id] === "reinstall") return null;
  const pending = switching.state.pending?.id === plugin.id ? switching.state.pending : null;
  return (
    <span className="flex items-center gap-2" aria-busy={pending ? true : undefined}>
      {pending && <span role="status" className="text-muted-foreground text-sm">{pending.enabled ? copy.turningOn : copy.turningOff}</span>}
      <SettingsSwitch id={`plugin-page-${plugin.id}`} label={formatWorkbench(copy.switchLabel, { name })} checked={plugin.enabled}
        disabled={lockedCard(switching.state, plugin.id) || (!plugin.enabled && plugin.availability.state === "unsupported")}
        onToggle={next => switching.toggle(plugin, next)} />
    </span>
  );
}

/** While the detail loads or fails, the page keeps its frame and says why. */
export function PluginLoadState({ error, retry, workbench }: { error: string | null; retry(): void; workbench: WorkbenchCopy }) {
  const copy = workbench.plugins;
  if (!error) return null;
  const gone = error.includes("plugin-not-found");
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-destructive text-sm">
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <span className="flex-1">{gone ? copy.notFound : copy.loadFailed}</span>
      {!gone && <SettingsButton variant="outline" onClick={retry}>{copy.retry}</SettingsButton>}
    </div>
  );
}

export function PluginAboutPage({ pluginId, bridge, workbench, locale, plugins, switching, hasSettingsPage, onOpenPlugin, onOpenSettings, onOpenRelated, onSetup, onEditSource }: {
  pluginId: string;
  bridge: PluginsBridge;
  workbench: WorkbenchCopy;
  locale: string;
  /** The catalog list, for other plugins' names in Works with. */
  plugins: readonly PluginView[];
  switching: Switching;
  /** True when the plugin has settings, so its settings page exists (on or off; the sidebar lists it only while on). */
  hasSettingsPage: boolean;
  onOpenPlugin(pluginId: string): void;
  onOpenSettings(pluginId: string): void;
  onOpenRelated(section: Related): void;
  onSetup(plugin: PluginView): void;
  onEditSource?(pluginId: string): void;
}) {
  const copy = workbench.plugins;
  const { detail, error, retry } = usePluginDetail(bridge, pluginId);
  if (!detail) return <PluginLoadState error={error} retry={retry} workbench={workbench} />;
  const names = new Map(plugins.map(plugin => [plugin.id, plugin]));
  const native = detail.source === "agent-native";
  const health: ReactNode = detail.enabled && !native && detail.health.level !== "unknown"
    ? <><span aria-hidden>·</span><HealthDot level={detail.health.level} /><span data-plugin-health={detail.health.level}>{pluginText(detail.health.summary, workbench)}</span></> : null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8" data-plugin-detail={detail.id} data-plugin-view="about">
      <header className="flex flex-wrap items-start gap-5">
        <PluginIcon plugin={detail} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-balance font-heading font-semibold text-2xl tracking-tight">{pluginText(detail.name, workbench)}</h1>
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">{pluginPublisher(detail, workbench)}{health}</p>
          {detail.summary && <p className="max-w-prose text-pretty text-foreground/80 text-sm">{pluginText(detail.summary, workbench)}</p>}
        </div>
        <div className="flex items-center gap-2.5 pt-1">
          {hasSettingsPage && <SettingsIconButton label={copy.sectionSettings} onClick={() => onOpenSettings(detail.id)} data-plugin-open-settings=""><Settings aria-hidden /></SettingsIconButton>}
          <PluginControl plugin={detail} workbench={workbench} switching={switching} onSetup={onSetup} />
        </div>
      </header>
      <PluginBanners detail={detail} workbench={workbench} note={switching.state.notes[detail.id]} onOpenRelated={onOpenRelated} />
      <AboutSection detail={detail} workbench={workbench} />
      <CapabilitiesSection detail={detail} workbench={workbench} />
      {!native && <WorksWithSection detail={detail} workbench={workbench} names={names} onOpenPlugin={onOpenPlugin} />}
      <InUseSection detail={detail} workbench={workbench} />
      <PluginHistoryList id={pluginId} locale={locale} onEdit={onEditSource ? () => onEditSource(pluginId) : undefined} />
      <InformationSection detail={detail} workbench={workbench} onOpen={onOpenRelated} />
    </div>
  );
}
