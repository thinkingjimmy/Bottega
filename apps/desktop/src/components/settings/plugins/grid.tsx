/**
 * [INPUT]: Depends on the plugin view, workbench-copy, PluginCard and the Puzzle empty-state icon.
 * [OUTPUT]: Provides PluginGrid — all plugin cards grouped by Bottega features, Providers, Extensions and Agent-native plugins,
 *           with the catalog order preserved inside each group and an empty-catalog message.
 * [POS]: All plugins page body. The page owns data, switching and navigation; this component only groups and lays out cards.
 */
import { Puzzle } from "lucide-react";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { PluginCard, type CardState } from "./card";

const GROUPS = [["feature", "groupFeature"], ["provider", "groupProvider"], ["package", "groupPackage"], ["agent-native", "groupNative"]] as const;
const groupOf = (plugin: PluginView) => plugin.source === "builtin" ? plugin.kind : plugin.source;

export function PluginGrid({ plugins, workbench, state, onOpen, onToggle, onSetup }: {
  plugins: readonly PluginView[];
  workbench: WorkbenchCopy;
  state: CardState;
  onOpen(plugin: PluginView): void;
  onToggle(plugin: PluginView, enabled: boolean): void;
  onSetup(plugin: PluginView): void;
}) {
  const copy = workbench.plugins;
  const sections = GROUPS.map(([group, title]) => ({ key: group, title: copy[title], items: plugins.filter(plugin => groupOf(plugin) === group) }))
    .filter(section => section.items.length);
  const card = (plugin: PluginView) => (
    <PluginCard key={plugin.id} plugin={plugin} workbench={workbench} state={state} onOpen={onOpen} onToggle={onToggle} onSetup={onSetup} />
  );
  return (
    <div className="flex flex-col gap-4">
      {sections.map(section => (
        <section key={section.key} className="flex flex-col gap-2.5" aria-label={section.title} data-plugin-group={section.key}>
          <h2 className="font-semibold text-foreground/80 text-xs">{section.title} <span className="font-normal text-muted-foreground">{section.items.length}</span></h2>
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">{section.items.map(card)}</div>
        </section>
      ))}
      {!plugins.length && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center" data-plugin-empty="">
          <Puzzle aria-hidden className="size-5 text-muted-foreground" />
          <p className="font-semibold text-sm">{copy.emptyAll}</p>
        </div>
      )}
    </div>
  );
}
