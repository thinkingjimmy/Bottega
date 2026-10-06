/**
 * [INPUT]: Depends on lucide icons, Agent identity, the Settings switch/button primitives, workbench-copy and the plugin view.
 * [OUTPUT]: Provides PluginGlyph (built-in icon, Provider mark or package mark) and PluginIcon (that glyph on a md / lg / xl tile), PluginCard (icon, name that opens the plugin's
 *           introduction, publisher, two-line summary, actionable notes and a top-right control: switch, "Turn on…" / "Set up…"
 *           for a setup plugin, or a fixed badge; button-matched corners and no redundant status row), CardState (what the page
 *           knows beyond the catalog: switching now, busy, changed files) and lockedCard.
 * [POS]: One card of the All plugins catalog (redesign 2026-10-02: All plugins introduces, the sidebar entry holds settings). The whole
 *        card opens the introduction through its name's stretched button and shows a pointer; keyboard users reach the name and the control as two stops.
 */
import type { ReactNode } from "react";
import { Box, Brain, Globe, LoaderCircle, Lock, PanelBottom, PenTool, Puzzle, Table2, Workflow } from "lucide-react";
import { formatWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { cn } from "@ai-chat/ui/lib/utils";
import { SettingsButton, SettingsSwitch } from "@/components/settings/settings-layout";
import { AgentBackendIcon, backendLabel, isAgentBackendId } from "@/lib/agent/agent-backends";
import { ReportIssueButton } from "@/components/report-issue-button";
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { pluginPublisher, pluginText } from "./copy";

const BUILTIN_ICONS: Record<string, typeof Table2> = { base: Table2, workflow: Workflow, memory: Brain, tunnel: Globe, dock: PanelBottom, sketch: PenTool };

const ICON_SIZE = { md: ["size-9 rounded-lg", "size-[18px]"], lg: ["size-11 rounded-xl", "size-[22px]"], xl: ["size-16 rounded-2xl", "size-8"] } as const;

/** The plugin's glyph alone: its built-in icon, its Provider's mark, or a package / puzzle mark. */
export function PluginGlyph({ plugin, className }: { plugin: Pick<PluginView, "icon" | "source" | "managedBy">; className?: string }) {
  const name = plugin.icon?.builtin ?? plugin.managedBy ?? null;
  const Icon = name ? BUILTIN_ICONS[name] : undefined;
  return Icon ? <Icon className={className} /> : name && isAgentBackendId(name) ? <AgentBackendIcon backend={name} className={className} />
    : plugin.source === "package" ? <Box className={className} /> : <Puzzle className={className} />;
}

export function PluginIcon({ plugin, size = "md" }: { plugin: Pick<PluginView, "icon" | "source" | "managedBy">; size?: keyof typeof ICON_SIZE }) {
  const [box, glyph] = ICON_SIZE[size];
  return <span aria-hidden className={cn("grid shrink-0 place-items-center bg-muted text-foreground", box)}><PluginGlyph plugin={plugin} className={glyph} /></span>;
}

/** What the page knows about a card beyond the catalog: switching now, or refused as busy / needing its files restored. */
export type CardState = { pending: { id: string; enabled: boolean } | null; notes: Readonly<Record<string, "busy" | "reinstall">>; locked: string | null };
export const lockedCard = (state: CardState, id: string) => state.locked === id || state.pending?.id === id || Boolean(state.notes[id]);

/** Packages and Agent-native plugins carry no summary yet; say what kind of plugin it is rather than leave two blank lines. */
const fallbackSummary = (plugin: PluginView, copy: WorkbenchCopy["plugins"]) =>
  plugin.source === "package" ? formatWorkbench(copy.badgePackage, { version: plugin.version ?? "—" }) : plugin.source === "agent-native" ? copy.sourceNativeLong : "";

export function PluginCard({ plugin, workbench, state, onOpen, onToggle, onSetup }: {
  plugin: PluginView;
  workbench: WorkbenchCopy;
  state: CardState;
  onOpen(plugin: PluginView): void;
  onToggle(plugin: PluginView, enabled: boolean): void;
  onSetup(plugin: PluginView): void;
}) {
  const copy = workbench.plugins;
  const name = pluginText(plugin.name, workbench);
  const note = state.notes[plugin.id];
  const blocked = plugin.enabled && plugin.availability.state === "blocked";
  const pending = state.pending?.id === plugin.id ? state.pending : null;
  let control: ReactNode;
  if (pending) {
    control = <span role="status" className="pointer-events-auto flex items-center gap-1.5 text-muted-foreground text-xs" data-plugin-pending={pending.enabled ? "on" : "off"}>
      <LoaderCircle aria-hidden className="size-3.5 animate-spin" />{pending.enabled ? copy.turningOn : copy.turningOff}</span>;
  } else if (!plugin.turnOff.allowed) {
    const text = plugin.turnOff.reason === "always-on" ? copy.alwaysOn : plugin.turnOff.reason === "project-scoped" ? copy.projectScopedBadge
      : formatWorkbench(copy.nativeManagedBy, { agent: backendLabel(plugin.managedBy ?? "") });
    control = <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-muted-foreground text-xs"><Lock aria-hidden className="size-3" />{text}</span>;
  } else if (!plugin.enabled && plugin.turnOn.mode === "setup") {
    control = <SettingsButton className="pointer-events-auto" variant="outline" disabled={lockedCard(state, plugin.id) || plugin.availability.state === "unsupported"} onClick={() => onSetup(plugin)}>
      {copy.setupDock}</SettingsButton>;
  } else if (note === "reinstall") {
    /* Always shown, not only on hover (touch has none); the one thing to do now is tell us. */
    control = <span className="pointer-events-auto"><ReportIssueButton title={formatWorkbench(copy.reinstallIssueTitle, { name })} body={`Plugin: ${name}\nError: plugin-reinstall-required`} /></span>;
  } else {
    control = <span className="pointer-events-auto"><SettingsSwitch id={`plugin-${plugin.id}`} label={formatWorkbench(copy.switchLabel, { name })} checked={plugin.enabled}
      disabled={lockedCard(state, plugin.id) || (!plugin.enabled && plugin.availability.state === "unsupported")} onToggle={next => onToggle(plugin, next)} /></span>;
  }
  const line = note === "busy" && !pending ? formatWorkbench(copy.busyNote, { name })
    : note === "reinstall" ? formatWorkbench(copy.reinstallRequired, { name })
    : plugin.turnOff.allowed === false && plugin.turnOff.reason === "project-scoped" ? copy.projectScopedNote
    : plugin.availability.state === "unsupported" ? pluginText(plugin.availability.detail, workbench)
    : blocked ? copy.blocked : null;
  return (
    <div data-plugin={plugin.id} data-plugin-enabled={plugin.enabled ? "true" : "false"}
      className="group/card relative flex min-w-0 flex-col gap-2.5 rounded-md border bg-card p-3 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-ring/50">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn(!plugin.enabled && plugin.source !== "agent-native" && "opacity-60")}><PluginIcon plugin={plugin} size="md" /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <button type="button" data-card-open="" onClick={() => onOpen(plugin)}
            className="min-w-0 cursor-pointer truncate text-left font-semibold text-[13px] leading-5 outline-none after:absolute after:inset-0 after:cursor-pointer after:rounded-md after:content-['']">{name}</button>
          <span className="truncate text-muted-foreground text-xs">{pluginPublisher(plugin, workbench)}</span>
        </span>
        {control && <span className="pointer-events-none relative z-10 flex min-h-5 max-w-1/2 shrink-0 items-center self-start" aria-busy={pending ? true : undefined}>{control}</span>}
      </div>
      <p className="line-clamp-2 min-h-[2lh] text-pretty text-muted-foreground text-xs leading-[18px]">{pluginText(plugin.summary, workbench) || fallbackSummary(plugin, copy)}</p>
      {line && <p className={cn("text-xs leading-[17px]", note === "reinstall" ? "text-destructive" : note === "busy" || blocked ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
        data-plugin-note={note ?? (plugin.availability.state === "unsupported" ? "unsupported" : blocked ? "blocked" : "scoped")}>{line}</p>}
    </div>
  );
}
