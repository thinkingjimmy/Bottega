/**
 * [INPUT]: Depends on Library-first Skills IPC/client, shared Skill rows/search/toolbar/import controller, compact batch/empty components, i18n, the shared Extensions surface, and Settings primitives
 * [OUTPUT]: Provides `/settings/skills` with name/description/source rows, one enabled switch, main-authored actions, deletion-only confirmation, budget facts, and a positionally identical Skills/Extensions acquisition toolbar
 * [POS]: Sole global Skills management surface; renderer submits intents and contains no Agent-home, projection, native-target, or Codex-special logic
 */

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Sparkles } from "lucide-react";
import { useSearchParams } from "react-router";
import { PageShell } from "@/components/page-shell";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  SettingsAlert,
  SettingsCanvas,
  SettingsList,
} from "@/components/settings/settings-layout";
import { SkillBatchBar } from "@/components/settings/skills/skill-batch-bar";
import { SkillEmptyState } from "@/components/settings/skills/skill-empty-state";
import { SkillImportDialog } from "@/components/settings/skills/skill-import-dialog";
import { SkillLibraryRow } from "@/components/settings/skills/skill-library-row";
import { SkillSearch } from "@/components/settings/skills/skill-search";
import { SkillsToolbar } from "@/components/settings/skills/controls/toolbar";
import { useSkillImport } from "@/components/settings/skills/controls/use-skill-import";
import {
  skillBytesText,
  skillErrorText,
  skillReasonText,
} from "@/components/settings/skills/skill-text";
import {
  applyUnifiedSkillPlan,
  importAllDiscoveredSkills,
  listUnifiedSkills,
  onUnifiedSkillsChanged,
  previewUnifiedSkillIntents,
} from "@/lib/unified-skills-client";
import { ExtensionsContent } from "@/views/settings-extensions";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tabs,
  TabsContent,
} from "@ai-chat/ui/components/ui/tabs";
import type {
  ManagedSkillIntentInput,
  ManagedSkillLibraryItem,
  ManagedSkillPlanPreview,
  UnifiedSkillsSnapshot,
} from "../../shared/unified-skills-ipc";

let cachedSnapshot: UnifiedSkillsSnapshot | null = null;

export function SkillsSettingsView() {
  const { t } = useAppTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "extensions" ? "extensions" : "skills";
  const packageIdentity = params.get("package");
  const [snapshot, setSnapshot] = useState(cachedSnapshot);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<ManagedSkillPlanPreview | null>(null);
  const [mutationBusy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [extensionsActionHost, setExtensionsActionHost] = useState<HTMLDivElement | null>(
    null
  );
  const skillImport = useSkillImport({ snapshot, onImported: setSnapshot });
  const busy = mutationBusy || skillImport.busy;

  useEffect(() => {
    cachedSnapshot = snapshot;
  }, [snapshot]);

  useEffect(() => {
    let live = true;
    void listUnifiedSkills()
      .then((value) => live && setSnapshot(value))
      .catch((cause) => live && setError(skillErrorText(t, cause)));
    const offChanged = onUnifiedSkillsChanged((value) => {
      if (live) setSnapshot(value);
    });
    return () => {
      live = false;
      offChanged();
    };
    // Translation changes must not restart subscriptions or clear selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(skillErrorText(t, cause));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (plan: ManagedSkillPlanPreview) => {
    setSnapshot(await applyUnifiedSkillPlan({
      planId: plan.planId,
      planDigest: plan.planDigest,
      authorityToken: plan.authorityToken,
    }));
    setPendingDelete(null);
  };

  const submit = async (intents: readonly ManagedSkillIntentInput[]) => {
    if (!intents.length) return;
    const plan = await previewUnifiedSkillIntents(intents);
    if (plan.consent.length) setPendingDelete(plan);
    else await apply(plan);
  };

  const importAll = async () => {
    setSnapshot(await importAllDiscoveredSkills());
  };

  const library = snapshot?.library ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const shown = library.filter((skill) =>
    (!packageIdentity || skill.source.installIdentity === packageIdentity) &&
    (!needle || `${skill.name} ${skill.displayName} ${skill.description}`
      .toLocaleLowerCase()
      .includes(needle))
  );
  const selectedRows = library.filter((skill) => selected.has(skill.ref));
  const scanning = Boolean(snapshot && !snapshot.candidates.revision);
  const readOnly = snapshot?.availability.kind !== "ready";
  const budget = snapshot
    ? t("settings.skills.budget", {
        count: snapshot.enabledLibraryCount,
        size: skillBytesText(snapshot.enabledLibraryPromptBytes),
      })
    : "";

  const rowEnabled = (skill: ManagedSkillLibraryItem, enabled: boolean) =>
    run(() => submit([{ type: "set-enabled", skillRef: skill.ref, enabled }]));
  const rowDelete = (skill: ManagedSkillLibraryItem) =>
    run(() => submit([{ type: "delete", skillRef: skill.ref }]));
  const batch = (action: "enable" | "disable" | "delete") => run(() => {
    const intents = selectedRows.flatMap((skill): ManagedSkillIntentInput[] => {
      if (action === "delete") {
        return skill.allowedActions.includes("delete")
          ? [{ type: "delete", skillRef: skill.ref }]
          : [];
      }
      if (!skill.allowedActions.includes(action)) return [];
      return [{
        type: "set-enabled",
        skillRef: skill.ref,
        enabled: action === "enable",
      }];
    });
    return submit(intents);
  });
  return (
    <Tabs
      className="h-full min-h-0 gap-0"
      onValueChange={(value) => setParams({ tab: value }, { replace: true })}
      value={tab}
    >
      <PageShell
        actions={(
          <Button
            aria-label={t("settings.skills.refresh")}
            disabled={busy}
            onClick={() => void run(async () => setSnapshot(await listUnifiedSkills(true)))}
            size="icon-lg"
            variant="ghost"
          >
            <RefreshCw className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
          </Button>
        )}
        icon={<Sparkles />}
        title={t("common.skills")}
      >
        <SettingsCanvas>
          <SkillsToolbar actionHostRef={setExtensionsActionHost}>
            {tab === "skills" && (
              <Button
                disabled={busy || readOnly}
                onClick={() => void skillImport.openDialog()}
                size="lg"
              >
                <Plus />
                {t("settings.skills.importTitle")}
              </Button>
            )}
          </SkillsToolbar>
          <TabsContent className="mt-0 space-y-4" value="skills">
            {error && <SettingsAlert>{error}</SettingsAlert>}
            {snapshot?.availability.kind === "read-only" && (
              <SettingsAlert tone="warn">
                {t("settings.skills.readOnly")}: {skillReasonText(t, snapshot.availability.reason)}
              </SettingsAlert>
            )}
            {snapshot && snapshot.personalLibraryEmpty ? (
              <SkillEmptyState
                busy={busy || readOnly}
                onChooseFolder={() => void skillImport.openDialog("local-folder")}
                onImportAll={() => void run(importAll)}
                scanning={scanning}
                sources={snapshot.sources}
              />
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <p className="text-muted-foreground text-xs">{budget}</p>
                  <SkillSearch onChange={setQuery} value={query} />
                </div>
                {shown.length ? (
                  <SettingsList>
                    {shown.map((skill) => (
                      <SkillLibraryRow
                        busy={busy || readOnly}
                        key={skill.ref}
                        onDelete={() => void rowDelete(skill)}
                        onEnabled={(enabled) => void rowEnabled(skill, enabled)}
                        onGotoPackage={() => setParams({
                          tab: "extensions",
                          ...(skill.source.installIdentity
                            ? { package: skill.source.installIdentity }
                            : {}),
                        })}
                        onSelected={(value) => setSelected((current) => {
                          const next = new Set(current);
                          if (value) next.add(skill.ref);
                          else next.delete(skill.ref);
                          return next;
                        })}
                        selected={selected.has(skill.ref)}
                        skill={skill}
                      />
                    ))}
                  </SettingsList>
                ) : (
                  <p className="py-12 text-center text-muted-foreground text-sm">
                    {t("settings.skills.noMatches")}
                  </p>
                )}
                {selectedRows.length > 0 && (
                  <SkillBatchBar
                    busy={busy || readOnly}
                    canDisable={selectedRows.some((skill) => skill.allowedActions.includes("disable"))}
                    canDelete={selectedRows.some((skill) => skill.allowedActions.includes("delete"))}
                    canEnable={selectedRows.some((skill) => skill.allowedActions.includes("enable"))}
                    onDelete={() => void batch("delete")}
                    onDisable={() => void batch("disable")}
                    onDone={() => setSelected(new Set())}
                    onEnable={() => void batch("enable")}
                    selected={selectedRows.length}
                  />
                )}
              </>
            )}
          </TabsContent>
          <TabsContent className="mt-0" value="extensions">
            <ExtensionsContent
              packageIdentity={packageIdentity}
              toolbarActionHost={extensionsActionHost}
            />
          </TabsContent>
        </SettingsCanvas>
      </PageShell>
      <SkillImportDialog {...skillImport.dialogProps} />
      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("settings.skills.confirmDeleteAction")}
        confirmTone="destructive"
        description={t("settings.skills.confirmDeleteBody", {
          count: pendingDelete?.deletionActions ?? 0,
        })}
        onConfirm={() => pendingDelete && void run(() => apply(pendingDelete))}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDelete(null);
        }}
        open={Boolean(pendingDelete)}
        title={t("settings.skills.confirmDeleteTitle")}
      />
    </Tabs>
  );
}
