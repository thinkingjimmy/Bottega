/**
 * [INPUT]: Depends on lucide icons, Agent identity, the Settings badge/switch/button primitives, workbench-copy and the plugin view.
 * [OUTPUT]: Provides PluginGlyph (built-in icon, Provider mark or package mark) and PluginIcon (that glyph on a md / lg / xl tile), PluginCard (icon, name that opens the plugin's
 *           introduction, publisher, two-line summary, a status line with its dot (who uses it when on), and the row-end control: switch, "Turn on…" / "Set up…"
 *           for a setup plugin, or a fixed badge; Dock reports its current off state without inferring prior use), CardState (what the page
 *           knows beyond the catalog: switching now, busy, changed files) and lockedCard.
 * [POS]: One card of the All plugins catalog (redesign 2026-10-02: All plugins introduces, the sidebar entry holds settings). The whole
 *        card opens the introduction through its name's stretched button and shows a pointer; keyboard users reach the name and the control as two stops.
 */
import type { ReactNode } from "react";
import { Box, Brain, Globe, LoaderCircle, Lock, PanelBottom, PenTool, Puzzle, Table2, Workflow } from "lucide-react";
import { formatWorkbench, pluralWorkbench, type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
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

const DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", danger: "bg-destructive", off: "bg-muted-foreground/40" } as const;

/** Packages and Agent-native plugins carry no summary yet; say what kind of plugin it is rather than leave two blank lines. */
const fallbackSummary = (plugin: PluginView, copy: WorkbenchCopy["plugins"]) =>
  plugin.source === "package" ? formatWorkbench(copy.badgePackage, { version: plugin.version ?? "—" }) : plugin.source === "agent-native" ? copy.sourceNativeLong : "";

/** The card's status line: what needs attention first, then off with when, then on with who uses it (T-D10 names Workflow's Projects). */
function status(plugin: PluginView, copy: WorkbenchCopy["plugins"], locale: string, note: CardState["notes"][string] | undefined): [keyof typeof DOT, string] {
  if (note === "reinstall") return ["danger", copy.reinstallBadge];
  if (plugin.availability.state === "unsupported") return ["off", copy.unsupported];
  if (!plugin.enabled) {
    if (plugin.turnedOffAt) return ["off", formatWorkbench(copy.turnedOffOn, { date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(plugin.turnedOffAt) })];
    return ["off", plugin.turnOn.mode === "setup" && plugin.id !== "dock" ? copy.neverOn : copy.statusOff];
  }
  if (plugin.availability.state === "blocked") return ["warn", copy.blocked];
  if (plugin.usedBy) return ["ok", plugin.usedBy.length ? pluralWorkbench(copy, "providerUsedBy", locale, plugin.usedBy.length) : copy.providerUnused];
  if (plugin.workflowIn?.length) return ["ok", plugin.workflowIn.length <= 2 ? formatWorkbench(copy.workflowSetUpInNames, { projects: plugin.workflowIn.join(", ") })
    : pluralWorkbench(copy, "workflowSetUpIn", locale, plugin.workflowIn.length)];
  return ["ok", copy.statusOn];
}

export function PluginCard({ plugin, workbench, locale, state, onOpen, onToggle, onSetup }: {
  plugin: PluginView;
  workbench: WorkbenchCopy;
  locale: string;
  state: CardState;
  onOpen(plugin: PluginView): void;
  onToggle(plugin: PluginView, enabled: boolean): void;
  onSetup(plugin: PluginView): void;
}) {
  const copy = workbench.plugins;
  const name = pluginText(plugin.name, workbench);
  const note = state.notes[plugin.id];
  const pending = state.pending?.id === plugin.id ? state.pending : null;
  const [tone, statusText] = status(plugin, copy, locale, note);
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
      {plugin.turnOn.setup === "memory-consent" ? copy.setupMemory : copy.setupDock}</SettingsButton>;
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
    : plugin.availability.state === "unsupported" ? pluginText(plugin.availability.detail, workbench) : null;
  return (
    <div data-plugin={plugin.id} data-plugin-enabled={plugin.enabled ? "true" : "false"}
      className="group/card relative flex min-w-0 flex-col gap-2.5 rounded-2xl border bg-card p-3 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm has-[[data-card-open]:focus-visible]:ring-2 has-[[data-card-open]:focus-visible]:ring-ring/50">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn(!plugin.enabled && plugin.source !== "agent-native" && "opacity-60")}><PluginIcon plugin={plugin} size="md" /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <button type="button" data-card-open="" onClick={() => onOpen(plugin)}
            className="min-w-0 cursor-pointer truncate text-left font-semibold text-[13px] leading-5 outline-none after:absolute after:inset-0 after:cursor-pointer after:rounded-2xl after:content-['']">{name}</button>
          <span className="truncate text-muted-foreground text-xs">{pluginPublisher(plugin, workbench)}</span>
        </span>
      </div>
      <p className="line-clamp-2 min-h-[2lh] text-pretty text-muted-foreground text-xs leading-[18px]">{pluginText(plugin.summary, workbench) || fallbackSummary(plugin, copy)}</p>
      {line && <p className={cn("text-xs leading-[17px]", note === "reinstall" ? "text-destructive" : note === "busy" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
        data-plugin-note={note ?? (plugin.availability.state === "unsupported" ? "unsupported" : "scoped")}>{line}</p>}
      <div className="mt-auto flex min-h-8 items-center gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs" data-plugin-status={tone}>{statusText}</span>
        {control && <span className="pointer-events-none relative z-10 flex items-center" aria-busy={pending ? true : undefined}>{control}</span>}
      </div>
    </div>
  );
}
