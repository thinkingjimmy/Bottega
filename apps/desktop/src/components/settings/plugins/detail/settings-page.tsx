/**
 * [INPUT]: Depends on the plugins bridge (detail, settings), workbench-copy, the declarative settings form, an optional owner settings
 *           slot, shared requirements, and the read-only sections.
 * [OUTPUT]: Provides PluginSettingsPage — one plugin's settings: the one banner that matters, its settings (the owner's own interface
 *           when it has one, otherwise the declared form), and health with its fixes.
 * [POS]: Body of the plugin's settings page. The view owns the title, switch and introduction link; about.tsx owns the introduction.
 */
import type { ReactNode } from "react";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { PluginDetail, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { usePluginDetail } from "../use-plugins";
import { PluginLoadState, type Switching } from "./about";
import { PluginSettingsForm } from "./settings-form";
import { HealthSection, PluginBanners } from "./sections";
import { PluginRequirement } from "./metadata";

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
      <PluginRequirement plugin={detail} workbench={workbench} />
      <PluginBanners detail={detail} workbench={workbench} note={switching.state.notes[detail.id]} onOpenRelated={onOpenRelated} />
      {settingsContent ?? (detail.settings && <PluginSettingsForm pluginId={detail.id} provider={detail.kind === "provider"}
        view={detail.settings} bridge={bridge} workbench={workbench} />)}
      <HealthSection detail={detail} workbench={workbench} locale={locale} />
    </div>
  );
}
