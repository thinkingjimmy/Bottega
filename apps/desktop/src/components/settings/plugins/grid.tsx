/**
 * [INPUT]: Depends on React, lucide icons, the shared Input / Select / Button, Settings layout primitives, workbench-copy, the card and
 *           the plugin view.
 * [OUTPUT]: Provides PluginGrid — the toolbar (search fills the left; status sits against sort)
 *           over the card grid: grouped by Bottega features / Providers / Extensions / Agent native plugins when sorted by
 *           category, flat otherwise; and an empty state that clears search and filters — plus pluginFilters / PluginFilters for tests.
 * [POS]: T-P3's page body (canvas: status filter chosen over tabs; closed plugins stay in place). The page owns the data, the
 *        switch and navigation; this file only filters and lays out.
 */
import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { type WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { SettingsButton } from "@/components/settings/settings-layout";
import type { PluginView } from "@ai-chat/cloud-protocol/contracts/plugins/catalog";
import { PluginCard, type CardState } from "./card";
import { pluginText } from "./copy";

export type PluginFilters = Readonly<{ query: string;
  status: "all" | "on" | "off" | "attention"; sort: "group" | "name" | "recent" }>;
const NO_FILTERS: PluginFilters = { query: "", status: "all", sort: "group" };
const GROUPS = [["feature", "groupFeature"], ["provider", "groupProvider"], ["package", "groupPackage"], ["agent-native", "groupNative"]] as const;
const groupOf = (plugin: PluginView) => plugin.source === "builtin" ? plugin.kind : plugin.source;
const needsAttention = (plugin: PluginView, notes: CardState["notes"]) => Boolean(notes[plugin.id])
  || plugin.availability.state === "unsupported" || (plugin.enabled && plugin.availability.state === "blocked");

/** The visible plugins for these filters, in display order. */
export function pluginFilters(plugins: readonly PluginView[], filters: PluginFilters, workbench: WorkbenchCopy, locale: string, notes: CardState["notes"] = {}) {
  const query = filters.query.trim().toLocaleLowerCase(locale);
  const rows = plugins.filter(plugin => (filters.status === "all" || (filters.status === "on" ? plugin.enabled : filters.status === "off" ? !plugin.enabled : needsAttention(plugin, notes)))
    && (!query || `${pluginText(plugin.name, workbench)} ${pluginText(plugin.summary, workbench)}`.toLocaleLowerCase(locale).includes(query)));
  if (filters.sort === "name") return [...rows].sort((a, b) => pluginText(a.name, workbench).localeCompare(pluginText(b.name, workbench), locale));
  if (filters.sort === "recent") return [...rows].sort((a, b) => (b.turnedOffAt ?? 0) - (a.turnedOffAt ?? 0));
  return rows;
}

function Filter<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(value: T): void }) {
  return (
    <Select value={value} onValueChange={next => onChange(next as T)}>
      <SelectTrigger size="lg" className="shrink-0" aria-label={label} data-plugin-filter={label}><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([option, text]) => <SelectItem key={option} value={option}>{text}</SelectItem>)}</SelectContent>
    </Select>
  );
}

export function PluginGrid({ plugins, workbench, locale, state, onOpen, onToggle, onSetup }: {
  plugins: readonly PluginView[];
  workbench: WorkbenchCopy;
  locale: string;
  state: CardState;
  onOpen(plugin: PluginView): void;
  onToggle(plugin: PluginView, enabled: boolean): void;
  onSetup(plugin: PluginView): void;
}) {
  const copy = workbench.plugins;
  const [filters, setFilters] = useState<PluginFilters>(NO_FILTERS);
  const deferred = useDeferredValue(filters);
  const set = <K extends keyof PluginFilters>(key: K) => (value: PluginFilters[K]) => setFilters(current => ({ ...current, [key]: value }));
  const visible = useMemo(() => pluginFilters(plugins, deferred, workbench, locale, state.notes), [plugins, deferred, workbench, locale, state.notes]);
  const sections = deferred.sort === "group"
    ? GROUPS.map(([group, title]) => ({ key: group, title: copy[title], items: visible.filter(plugin => groupOf(plugin) === group) })).filter(section => section.items.length)
    : [{ key: "all", title: null, items: visible }];
  const card = (plugin: PluginView) => (
    <PluginCard key={plugin.id} plugin={plugin} workbench={workbench} state={state} onOpen={onOpen} onToggle={onToggle} onSetup={onSetup} />
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={copy.title}>
        <div className="relative min-w-48 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" className="h-8 pl-8" placeholder={copy.searchLabel} aria-label={copy.searchLabel}
            value={filters.query} onChange={event => set("query")(event.target.value)} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Filter label={copy.statusLabel} value={filters.status} onChange={set("status")}
            options={[["all", copy.statusAll], ["on", copy.statusOn], ["off", copy.statusOff], ["attention", copy.statusAttention]]} />
          <Filter label={copy.sortLabel} value={filters.sort} onChange={set("sort")}
            options={[["group", copy.sortGroup], ["name", copy.sortName], ["recent", copy.sortRecent]]} />
        </div>
      </div>
      {sections.map(section => (
        <section key={section.key} className="flex flex-col gap-2.5" aria-label={section.title ?? copy.title} data-plugin-group={section.key}>
          {section.title && <h2 className="font-semibold text-foreground/80 text-xs">{section.title} <span className="font-normal text-muted-foreground">{section.items.length}</span></h2>}
          <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3">{section.items.map(card)}</div>
        </section>
      ))}
      {!visible.length && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center" data-plugin-empty="">
          <Search aria-hidden className="size-5 text-muted-foreground" />
          <p className="font-semibold text-sm">{plugins.length ? copy.emptyTitle : copy.emptyAll}</p>
          {plugins.length > 0 && <SettingsButton variant="outline" onClick={() => setFilters(NO_FILTERS)}>{copy.clearFilters}</SettingsButton>}
        </div>
      )}
    </div>
  );
}
