/**
 * [INPUT]: Canonical contribution contracts, shared Settings primitives and localized schema/detail copy.
 * [OUTPUT]: Compact capability rows with keyboard-operated full-width tool disclosures and bounded raw schemas.
 * [POS]: Unified plugin introduction capabilities; never places schemas in a SettingsRow control column.
 */
import { ChevronRight } from 'lucide-react';
import type { PluginContribution } from '@bottega/contracts/plugins/platform';
import { SettingsBadge, SettingsList, SettingsSection } from '@/components/settings/settings-layout';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
import { pluginDetailsCopy } from './copy';
import { PluginSchemaFields } from './schema';

export function PluginContributions({ contributions, locale }: { contributions: readonly PluginContribution[]; locale: string }) {
  const copy = pluginPlatformCopy(locale), labels = pluginDetailsCopy(locale);
  return <SettingsSection title={copy.contributions}><SettingsList>{contributions.map(item => {
    const heading = <span className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-[13px] font-medium wrap-anywhere">{item.name}</span><SettingsBadge tone="muted">{copy[item.kind === 'mode' ? 'modeKind' : item.kind]}</SettingsBadge></span>;
    if (item.kind !== 'tool') return <div key={item.id} data-plugin-contribution={item.id} className="min-w-0 px-4 py-3">{heading}{item.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">{item.description}</p>}</div>;
    return <details key={item.id} data-plugin-contribution={item.id} className="group/tool min-w-0">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{heading}<span data-plugin-contribution-description="" className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground wrap-anywhere group-open/tool:line-clamp-none">{item.description}</span></span>
        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open/tool:rotate-90" />
      </summary>
      <div data-plugin-tool-details="" className="min-w-0 space-y-5 border-t border-border/60 bg-muted/20 px-4 py-4">
        <PluginSchemaFields schema={item.inputSchema} title={labels.input} locale={locale} input />
        {Object.keys(item.outputSchema).length > 0 && <PluginSchemaFields schema={item.outputSchema} title={labels.output} locale={locale} />}
        <details className="group/schema min-w-0" data-plugin-full-schema="">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"><ChevronRight aria-hidden className="size-3.5 group-open/schema:rotate-90" />{labels.schema}</summary>
          <pre tabIndex={0} aria-label={labels.schema} className="mt-3 max-h-72 max-w-full overflow-auto overscroll-contain rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed focus-visible:outline-2 focus-visible:outline-ring">{JSON.stringify({ input: item.inputSchema, output: item.outputSchema }, null, 2)}</pre>
        </details>
      </div>
    </details>;
  })}{!contributions.length && <p className="p-4 text-xs text-muted-foreground">{copy.noContributions}</p>}</SettingsList></SettingsSection>;
}
