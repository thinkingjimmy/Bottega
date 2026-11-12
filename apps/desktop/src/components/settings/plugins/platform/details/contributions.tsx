/**
 * [INPUT]: Canonical plugin manifests and tool ownership, global Settings defaults, live backend support, and shared Settings and disclosure primitives.
 * [OUTPUT]: Provides PluginContributions with official tool switches, localized tool summaries and full-width schema disclosures.
 * [POS]: The Contributions section of the unified plugin detail; global defaults use the existing Settings store.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronRight } from "lucide-react";
import type { PluginContribution, PluginToolContribution, UnifiedPluginManifest } from "@bottega/contracts/plugins/platform";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-chat/ui/components/ui/collapsible";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsBadge, SettingsList, SettingsSection, SettingsSwitch } from "@/components/settings/settings-layout";
import { BackendSupportNote, useToolBackendFacts } from "@/components/settings/tools/backend-support";
import { builtinToolCopy } from "@/components/settings/tools/builtin-tool-copy";
import { pluginPlatformCopy } from "@/lib/plugin-platform/copy";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { toolSpec } from "../../../../../../shared/plugin-tools";
import {
  projectEffectiveState,
  resolveBuiltinBackendSupportMatrix,
  type ToolBackendRuntimeFacts,
} from "../../../../../../shared/tools/tool-support";
import { pluginDetailsCopy } from "./copy";
import { PluginSchemaFields } from "./schema";

type ContributionsProps = { contributions: readonly PluginContribution[]; locale: string };
type ToolPreferences = {
  toolIds: ReadonlySet<string>;
  disabledTools: readonly string[] | undefined;
  backends: readonly ToolBackendRuntimeFacts[];
  error: string;
};

export function PluginContributions({ manifest, locale }: { manifest: UnifiedPluginManifest; locale: string }) {
  const { id, source, contributions } = manifest;
  const toolIds = new Set<string>();
  if (source.kind === "official" && source.format === "bottega") {
    for (const item of contributions) {
      if (item.kind === "tool" && !item.exactIssued && toolSpec(item.id)?.pluginId === id) {
        toolIds.add(item.id);
      }
    }
  }

  return toolIds.size > 0
    ? <ManagedContributions contributions={contributions} locale={locale} toolIds={toolIds} />
    : <ContributionList contributions={contributions} locale={locale} />;
}

function ManagedContributions({ contributions, locale, toolIds }: ContributionsProps & { toolIds: ReadonlySet<string> }) {
  const { settings, error } = useSyncExternalStore(settingsStore.subscribe, settingsStore.getSnapshot);
  const backends = useToolBackendFacts();
  useEffect(() => {
    settingsStore.ensureLoaded();
  }, []);

  return <ContributionList
    contributions={contributions}
    locale={locale}
    preferences={{ toolIds, disabledTools: settings?.disabledBuiltinTools, backends, error }}
  />;
}

function ContributionList({ contributions, locale, preferences }: ContributionsProps & { preferences?: ToolPreferences }) {
  const { t } = useAppTranslation();
  const copy = pluginPlatformCopy(locale);
  return (
    <SettingsSection
      title={copy.contributions}
      description={preferences && t("settings.tools.builtin.globalDescription")}
      alert={preferences?.error}
    >
      <SettingsList>
        {contributions.map(item => item.kind === "tool" ? (
          <ToolContribution
            key={item.id}
            item={item}
            locale={locale}
            preferences={preferences?.toolIds.has(item.id) ? preferences : undefined}
          />
        ) : (
          <div key={item.id} data-plugin-contribution={item.id} className="min-w-0 px-4 py-3">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium wrap-anywhere">{item.name}</span>
              <SettingsBadge tone="muted">{copy[item.kind === "mode" ? "modeKind" : item.kind]}</SettingsBadge>
            </span>
            {item.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere">{item.description}</p>}
          </div>
        ))}
        {!contributions.length && <p className="p-4 text-xs text-muted-foreground">{copy.noContributions}</p>}
      </SettingsList>
    </SettingsSection>
  );
}

function ToolContribution({ item, locale, preferences }: {
  item: PluginToolContribution;
  locale: string;
  preferences?: ToolPreferences;
}) {
  const { t } = useAppTranslation();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const copy = pluginPlatformCopy(locale);
  const schemaCopy = pluginDetailsCopy(locale);
  const summary = preferences ? builtinToolCopy(item.id, t, locale) : undefined;
  const label = summary?.label ?? item.name;
  const disabledTools = preferences?.disabledTools;
  const enabled = disabledTools !== undefined && !disabledTools.includes(item.id);
  const support = preferences ? resolveBuiltinBackendSupportMatrix(item.id, preferences.backends) : [];
  const unavailable = enabled && projectEffectiveState(enabled, support) === "unavailable";
  const switchId = `plugin-tool-${item.id}`;
  const availabilityId = `${switchId}-availability`;
  const failure = t("settings.tools.builtin.saveFailed");

  async function save(next: boolean) {
    setSaving(true);
    setSaveFailed(false);
    const saved = await settingsStore.update(current => ({
      disabledBuiltinTools: next
        ? current.disabledBuiltinTools.filter(toolId => toolId !== item.id)
        : [...new Set([...current.disabledBuiltinTools, item.id])],
    }), failure, { errorScope: "local" });
    setSaveFailed(!saved);
    setSaving(false);
  }

  return (
    <Collapsible data-plugin-contribution={item.id} className="min-w-0" open={expanded} onOpenChange={setExpanded}>
      <div data-plugin-tool-header="" className="flex items-start">
        <CollapsibleTrigger aria-label={label} className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none">
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium wrap-anywhere">{label}</span>
              {summary
                ? label !== item.name && <code className="font-mono text-[11px] text-muted-foreground wrap-anywhere">{item.name}</code>
                : <SettingsBadge tone="muted">{copy.tool}</SettingsBadge>}
            </span>
            <span data-plugin-contribution-description="" className={cn(
              "mt-1 text-xs leading-relaxed text-muted-foreground wrap-anywhere",
              expanded ? "block" : "line-clamp-2",
            )}>
              {expanded ? item.description : summary?.hint || item.description}
            </span>
          </span>
          <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", expanded && "rotate-90")} />
        </CollapsibleTrigger>
        {preferences && <div className="shrink-0 py-3.5 pr-4">
          <SettingsSwitch
            id={switchId}
            label={label}
            describedBy={unavailable ? availabilityId : undefined}
            checked={enabled}
            disabled={disabledTools === undefined || saving}
            onToggle={next => void save(next)}
          />
        </div>}
      </div>
      {unavailable && <p id={availabilityId} className="px-4 pb-3 text-xs text-muted-foreground">
        {t("settings.tools.builtin.effective.unavailable")}
      </p>}
      {saveFailed && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{failure}</p>}
      <CollapsibleContent data-plugin-tool-details="" className="min-w-0 space-y-5 border-t border-border/60 bg-muted/20 px-4 py-4">
        <BackendSupportNote support={support} />
        <PluginSchemaFields schema={item.inputSchema} title={schemaCopy.input} locale={locale} input />
        {Object.keys(item.outputSchema).length > 0 && <PluginSchemaFields schema={item.outputSchema} title={schemaCopy.output} locale={locale} />}
        <details className="group/schema min-w-0" data-plugin-full-schema="">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-3.5 group-open/schema:rotate-90" />
            {schemaCopy.schema}
          </summary>
          <pre tabIndex={0} aria-label={schemaCopy.schema} className="mt-3 max-h-72 max-w-full overflow-auto overscroll-contain rounded-md border bg-background p-3 font-mono text-[11px] leading-relaxed focus-visible:outline-2 focus-visible:outline-ring">
            {JSON.stringify({ input: item.inputSchema, output: item.outputSchema }, null, 2)}
          </pre>
        </details>
      </CollapsibleContent>
    </Collapsible>
  );
}
