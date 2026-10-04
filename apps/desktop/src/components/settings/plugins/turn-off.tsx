/**
 * [INPUT]: Depends on React, the shared ConfirmationDialog, errorMessage, workbench-copy and the plugins bridge.
 * [OUTPUT]: Provides usePluginSwitch — the card/detail switch: turning on needs no confirmation; turning off first reads the impact and
 *           confirms it (configurations, workflows, runs, Chats, plugins that stop working, the plugin's own effects); refusals are read
 *           by code through Electron's IPC wrapper (busy waits until the catalog changes, changed files keep it off) — and its dialog.
 * [POS]: Shared by the plugins page and the detail page, so both switch exactly alike (T-P3: every switch confirms with its impact).
 */
import { useState, type ReactNode } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { formatWorkbench, pluralWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import type { PluginView, PluginsBridge } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import type { PluginDisableImpact } from "@ai-chat/cloud-protocol/contracts/plugins/impact";
import type { CardState } from "./card";
import { pluginText } from "./copy";

export function usePluginSwitch({ bridge, workbench, locale, computerName, plugins }: {
  bridge: PluginsBridge | null;
  workbench: WorkbenchCopy;
  locale: string;
  computerName?: string;
  /** The latest catalog read: a change ends whatever kept a plugin busy. */
  plugins: readonly PluginView[] | null;
}): { state: CardState; failed: string | null; toggle(plugin: PluginView, enabled: boolean): void; dialog: ReactNode } {
  const copy = workbench.plugins;
  const [confirm, setConfirm] = useState<{ plugin: PluginView; impact: PluginDisableImpact } | null>(null);
  const [pending, setPending] = useState<CardState["pending"]>(null);
  /* The card whose turn-off impact is being read; it cannot be clicked twice either. */
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [notes, setNotes] = useState<CardState["notes"]>({});
  const [failed, setFailed] = useState<string | null>(null);
  // A catalog change is the end of whatever kept a plugin busy: its switch opens again (nothing retries on its own).
  const [previous, setPrevious] = useState(plugins);
  if (previous !== plugins) {
    setPrevious(plugins);
    setNotes(current => Object.fromEntries(Object.entries(current).filter(([, note]) => note !== "busy")));
  }
  const nameOf = (plugin: PluginView) => pluginText(plugin.name, workbench);
  const change = async (plugin: PluginView, enabled: boolean) => {
    if (pending) return;
    setPending({ id: plugin.id, enabled }); setFailed(null);
    try { await bridge?.setEnabled(plugin.id, enabled); setConfirm(null); }
    catch (error) {
      const code = errorMessage(error);
      setConfirm(null);
      if (code === "plugin-busy" || code === "plugin-reinstall-required") setNotes(current => ({ ...current, [plugin.id]: code === "plugin-busy" ? "busy" : "reinstall" }));
      else setFailed(formatWorkbench(copy.switchFailed, { name: nameOf(plugin) }));
    }
    finally { setPending(null); }
  };
  const toggle = async (plugin: PluginView, enabled: boolean) => {
    if (enabled) return change(plugin, true);
    if (!bridge || previewing) return;
    setPreviewing(plugin.id);
    try { setConfirm({ plugin, impact: await bridge.disableImpact(plugin.id) }); }
    catch { setFailed(formatWorkbench(copy.switchFailed, { name: nameOf(plugin) })); }
    finally { setPreviewing(null); }
  };
  /* Configs and workflows are named (a bounded sample, then "and N more"); runs and Chats are counted by their totals. */
  const more = (shown: number, total: number) => total > shown ? [pluralWorkbench(copy, "impactMore", locale, total - shown)] : [];
  const impact = confirm?.impact, name = confirm ? nameOf(confirm.plugin) : "";
  const lines = impact ? [
    ...impact.agentConfigs.items.map(config => formatWorkbench(copy.impactConfigs, { config: config.name })),
    ...more(impact.agentConfigs.items.length, impact.agentConfigs.total),
    ...impact.workflows.items.map(item => formatWorkbench(copy.impactWorkflows, { workflow: item.name, name })),
    ...more(impact.workflows.items.length, impact.workflows.total),
    ...(impact.runs.total ? [pluralWorkbench(copy, "impactRuns", locale, impact.runs.total, { name })] : []),
    ...(impact.readOnlyChats.total ? [pluralWorkbench(copy, "impactChats", locale, impact.readOnlyChats.total, { name })] : []),
    ...impact.effects.items.map(effect => pluginText(effect.label, workbench)),
  ] : [];
  const dependents = impact ? impact.dependents.items.map(item => formatWorkbench(copy.dependentLine, { plugin: pluginText(item.name, workbench), name })) : [];
  const dialog = (
    <ConfirmationDialog
      open={Boolean(confirm)}
      busy={pending !== null}
      title={confirm ? formatWorkbench(copy.turnOffTitle, { name }) : ""}
      description={confirm ? (
        <div className="flex flex-col gap-3 text-left">
          <p>{formatWorkbench(copy.turnOffBody, { name, computer: computerName ?? copy.thisComputer })}</p>
          {dependents.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3" data-testid="turn-off-dependents">
              <p className="font-medium text-amber-900 dark:text-amber-300">{copy.dependentsTitle}</p>
              <ul className="list-disc space-y-1 pl-5">{dependents.map(line => <li key={line}>{line}</li>)}</ul>
            </div>
          )}
          {lines.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-foreground">{copy.whatChanges}</p>
              <ul className="list-disc space-y-1 pl-5" data-testid="turn-off-impacts">{lines.map(line => <li key={line}>{line}</li>)}</ul>
            </div>
          )}
        </div>
      ) : ""}
      confirmLabel={copy.turnOff}
      confirmTone="destructive"
      onConfirm={() => { if (confirm) void change(confirm.plugin, false); }}
      onOpenChange={open => { if (!open && pending === null) setConfirm(null); }}
    />
  );
  return { state: { pending, notes, locked: previewing }, failed, toggle: (plugin, enabled) => void toggle(plugin, enabled), dialog };
}
