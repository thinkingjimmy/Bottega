/**
 * [INPUT]: Depends on the plugin view, workbench-copy, PluginCard and the Puzzle empty-state icon.
 * [OUTPUT]: Provides PluginGrid — one flat grid of plugin cards in catalog order, plus the empty-catalog message; S17 replaces the old feature/Provider/package grouping with the two sections the page now owns ("Can be turned off" / "Always on").
 * [POS]: All plugins page body. The page owns data, sectioning, switching and navigation; this component only lays out cards.
 */
import { Puzzle } from "lucide-react";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { PluginCard, type CardState } from "./card";

export function PluginGrid({ plugins, workbench, state, onOpen, onToggle, onSetup }: {
  plugins: readonly PluginView[];
  workbench: WorkbenchCopy;
  state: CardState;
  onOpen(plugin: PluginView): void;
  onToggle(plugin: PluginView, enabled: boolean): void;
  onSetup(plugin: PluginView): void;
}) {
  const copy = workbench.plugins;
  return (
    <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">
      {plugins.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} workbench={workbench} state={state} onOpen={onOpen} onToggle={onToggle} onSetup={onSetup} />
      ))}
      {!plugins.length && (
        <div className="col-span-full flex flex-col items-center gap-3 rounded-[0.875rem] border border-dashed px-6 py-12 text-center" data-plugin-empty="">
          <Puzzle aria-hidden className="size-5 text-muted-foreground" />
          <p className="font-semibold text-sm">{copy.emptyAll}</p>
        </div>
      )}
    </div>
  );
}
