/**
 * [INPUT]: Depends on the Apps provider presets and records, the shared store presentation, localized preset copy, DropdownMenu/Button primitives and the plugin authoring draft entry.
 * [OUTPUT]: Provides AppsAddMenu (Install from GitHub / Build with your Agent), AppsStarterStore (featured banner and starter grid for an empty catalog) and AppsMoreToTry (uninstalled presets under installed Apps).
 * [POS]: views/apps Mac App Store presentation composed by apps-list.tsx; installs stay with PresetInstallDialog and AddAppDialog.
 */
import { useRef } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, GitBranch, Plus, Sparkles } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useApps } from "@/components/providers/content/apps-provider";
import { localizedPreset } from "@/components/apps/install/preset-app-shelf";
import { StoreFeature, StoreGrid, StorePill, StoreRow, StoreSection } from "@/components/apps/cards/store";
import { pluginAuthoringDraft } from "@/lib/plugin-platform/authoring";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import type { PresetAppSummary } from "../../../shared/ipc/apps/apps-ipc";

const PRESET_TINT: Record<string, string> = { "expense-tracker": "#cdebd6", "fitness-log": "#fde2c8" };

/** Starts the existing plugin authoring draft; the first message in that Chat creates the App source. */
function useBuildWithAgent() {
  const navigate = useNavigate(), busy = useRef(false);
  return () => {
    if (busy.current) return; busy.current = true;
    void pluginAuthoringDraft({}, effectiveLocale()).then(route => navigate(route)).finally(() => { busy.current = false; });
  };
}

/** Header Add holds only what the page does not list: new sources. Presets are added from the page itself. */
export function AppsAddMenu({ onInstallFromGitHub }: { onInstallFromGitHub(): void }) {
  const { t } = useAppTranslation(), build = useBuildWithAgent();
  // Non-modal and opened on the next frame: the dialog must own focus and Escape, not the closing menu layer.
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button aria-label={t("apps.addApp")} size="lg" variant="outline" className="gap-1.5 px-3 text-sm"><Plus />{t("apps.addApp")}<ChevronDown className="size-3.5 opacity-60" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-max min-w-64">
      <DropdownMenuItem onSelect={() => requestAnimationFrame(onInstallFromGitHub)} className="items-start py-2"><GitBranch className="mt-0.5" /><span><span className="block font-medium">{t("apps.catalog.addFromGithub")}</span><span className="block text-xs text-muted-foreground">{t("apps.catalog.addFromGithubHint")}</span></span></DropdownMenuItem>
      <DropdownMenuItem onSelect={build} className="items-start py-2"><Sparkles className="mt-0.5" /><span><span className="block font-medium">{t("apps.catalog.build")}</span><span className="block text-xs text-muted-foreground">{t("apps.catalog.buildHint")}</span></span></DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

function PresetRow({ preset, onSelect }: { preset: PresetAppSummary; onSelect(preset: PresetAppSummary): void }) {
  const { t } = useAppTranslation(), copy = localizedPreset(t, preset.id);
  return <StoreRow data-preset-id={preset.id} icon={preset.icon} tint={PRESET_TINT[preset.id]} title={copy.name} subtitle={copy.description}
    action={<StorePill aria-label={t("apps.presetInstallNamed", { name: copy.name })} onClick={() => onSelect(preset)}>{t("apps.catalog.get")}</StorePill>} />;
}

/** Empty catalog: one featured starter explains an App by example; the starter grid and the GitHub path follow. */
export function AppsStarterStore({ onSelect, onInstallFromGitHub }: { onSelect(preset: PresetAppSummary): void; onInstallFromGitHub(): void }) {
  const { t } = useAppTranslation(), { presets } = useApps();
  const featured = presets[0], copy = featured && localizedPreset(t, featured.id);
  return <div data-apps-store="empty">
    {featured && copy && <StoreFeature tint={PRESET_TINT[featured.id]} title={t("apps.catalog.feature", { name: copy.name })} description={`${copy.description} ${t("apps.emptyLead")}`}
      art={<span className="store-icon">{featured.icon}</span>}
      action={<StorePill tone="solid" aria-label={t("apps.presetInstallNamed", { name: copy.name })} onClick={() => onSelect(featured)}>{t("apps.catalog.get")}</StorePill>} />}
    <StoreSection title={t("apps.catalog.starter")}>
      <StoreGrid>
        {presets.map(preset => <PresetRow key={preset.id} preset={preset} onSelect={onSelect} />)}
        <StoreRow dashed icon={<GitBranch />} title={t("apps.catalog.githubTitle")} subtitle={t("apps.catalog.githubSubtitle")}
          action={<StorePill tone="plain" onClick={onInstallFromGitHub}>{t("apps.catalog.pasteLink")}</StorePill>} />
      </StoreGrid>
    </StoreSection>
  </div>;
}

/** Installed catalog: presets the user has not installed yet, in the same store rows. */
export function AppsMoreToTry({ onSelect }: { onSelect(preset: PresetAppSummary): void }) {
  const { t } = useAppTranslation(), { presets, apps } = useApps();
  const installed = new Set(apps.map(app => app.record.presetId).filter(Boolean));
  const remaining = presets.filter(preset => !installed.has(preset.id));
  if (!remaining.length) return null;
  return <StoreSection title={t("apps.catalog.more")}>
    <StoreGrid>{remaining.map(preset => <PresetRow key={preset.id} preset={preset} onSelect={onSelect} />)}</StoreGrid>
  </StoreSection>;
}
