/**
 * [INPUT]: Canonical plugin metadata, existing built-in workbench introductions, localized detail copy and Lucide marks.
 * [OUTPUT]: Shared catalog/detail identity, nonempty localized introductions derived from declared capabilities and personal monograms.
 * [POS]: Presentation adapter for unified plugins; official marks require exact official source identity.
 */
import type { WorkbenchCopy } from '@ai-chat/ui/lib/workbench-copy';
import type { UnifiedPluginCatalogItem, UnifiedPluginCatalogSummary } from '@bottega/contracts/plugins/platform';
import { AppWindow, BookOpen, Brain, CloudSun, FolderOpen, Globe, History, MessagesSquare, MonitorPlay, Network, PanelBottom, PanelsTopLeft, PenTool, Puzzle, Search, Table2, Wrench } from 'lucide-react';
import { pluginDetailsCopy } from './copy';

type Plugin = UnifiedPluginCatalogItem | UnifiedPluginCatalogSummary;
const officialMarks = {
  base: Table2, browser: Globe, artifact: PanelsTopLeft, preview: MonitorPlay, skills: Wrench, apps: AppWindow,
  memory: Brain, dock: PanelBottom, sketch: PenTool, host_sections: MessagesSquare, host_subagents: Network,
  host_projects: FolderOpen, host_search: Search, host_history: History, host_skills: BookOpen, host_plugins: Puzzle,
  'bottega-weather': CloudSun,
};

export function pluginPresentation(plugin: Plugin, workbench: WorkbenchCopy, locale: string) {
  const { id, source, description } = plugin.manifest;
  const copy = pluginDetailsCopy(locale);
  const official = source.kind === 'official' && source.format === 'bottega';
  const builtins = workbench.plugins.builtin;
  const builtin = official && (id === 'base' || id === 'memory' || id === 'dock' || id === 'sketch' || id === 'artifact') ? builtins[id] : undefined;
  const introduction = official ? copy.introductions[id as keyof typeof copy.introductions] : undefined;
  const kinds = 'contributionKinds' in plugin.manifest ? plugin.manifest.contributionKinds : plugin.manifest.contributions.map(item => item.kind);
  const primary = (['page', 'widget', 'composer', 'tool', 'mode', 'service'] as const).find(kind => kinds.includes(kind));
  return {
    summary: builtin?.summary || introduction || description?.split(/\n\s*\n/)[0]?.trim() || copy.fallback[primary ?? 'none'],
    description: builtin?.description ?? description,
    publisher: official ? workbench.plugins.publisherBottega : source.kind === 'authored' ? copy.authored : source.kind === 'copy' ? copy.personalCopy : copy.external,
  };
}

export function UnifiedPluginIcon({ plugin, size = 'md' }: { plugin: Plugin; size?: 'md' | 'xl' }) {
  const { id, name, source } = plugin.manifest;
  const Icon = source.kind === 'official' && source.format === 'bottega' ? officialMarks[id as keyof typeof officialMarks] : undefined;
  const initials = Array.from(name.trim().split(/\s+/).map(word => Array.from(word)[0]).join('')).slice(0, 2).join('').toLocaleUpperCase();
  return <span aria-hidden data-plugin-icon={Icon ? id : 'personal'} className={`grid shrink-0 place-items-center bg-muted text-foreground ${size === 'xl' ? 'size-16 rounded-2xl' : 'size-9 rounded-lg'}`}>
    {Icon ? <Icon className={size === 'xl' ? 'size-8' : 'size-[18px]'} /> : <span className={`font-semibold ${size === 'xl' ? 'text-2xl' : 'text-sm'}`}>{initials}</span>}
  </span>;
}
