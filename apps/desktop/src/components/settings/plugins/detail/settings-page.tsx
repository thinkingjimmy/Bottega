/**
 * [INPUT]: Depends on the plugins bridge (detail, settings), workbench-copy, the declarative settings form, an optional owner settings
 *           slot, and the read-only sections.
 * [OUTPUT]: Provides PluginSettingsPage — one plugin's settings: the one banner that matters, its settings (the owner's own interface
 *           when it has one, otherwise the declared form), Health with its fixes, and Used by.
 * [POS]: Opened from the plugin's own entry in the Settings sidebar, which lists turned-on plugins that have settings. The view puts the
 *        plugin's name, its switch and "About <name>" in the page header and marks the page (data-plugin-view); the introduction lives in
 *        about.tsx.
 */
import type { ReactNode } from "react";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { PluginDetail, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { pluginText } from "../copy";
import { usePluginDetail } from "../use-plugins";
import { PluginLoadState, type Switching } from "./about";
import { PluginSettingsForm } from "./settings-form";
import { HealthSection, PluginBanners, UsedBySection } from "./sections";

export function PluginSettingsPage({ pluginId, bridge, workbench, locale, switching, onOpenRelated, settingsContent }: {
  pluginId: string;
  bridge: PluginsBridge;
  workbench: WorkbenchCopy;
  locale: string;
  switching: Switching;
  onOpenRelated(section: PluginDetail["related"][number]): void;
  /** An owner's existing interface (Dock) takes the declared form's place instead of duplicating it. */
  settingsContent?: ReactNode;
}) {
  const { detail, error, retry } = usePluginDetail(bridge, pluginId);
  if (!detail) return <PluginLoadState error={error} retry={retry} workbench={workbench} />;
  return (
    <div className="flex flex-col gap-8">
      <PluginBanners detail={detail} workbench={workbench} note={switching.state.notes[detail.id]} onOpenRelated={onOpenRelated} />
      {settingsContent ?? (detail.settings && <PluginSettingsForm pluginId={detail.id} name={pluginText(detail.name, workbench)} provider={detail.kind === "provider"}
        view={detail.settings} bridge={bridge} workbench={workbench} />)}
      <HealthSection detail={detail} workbench={workbench} locale={locale} />
      <UsedBySection detail={detail} workbench={workbench} onOpen={onOpenRelated} />
    </div>
  );
}
