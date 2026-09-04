"use client";

/**
 * [INPUT]: Depends on Project/Chat projections, Projects/History/Bases providers, Memory/settings stores, shared appearance/grants/lifecycle surfaces, routing, and i18n
 * [OUTPUT]: Provides ProjectGeneralSection with basics, unified contextual App authorization/placement management, Base entry, and lifecycle controls
 * [POS]: Project Settings General tab; composes existing owners without creating a second Project state model
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { Archive, Database, FolderX, PanelsTopLeft, Pencil } from "lucide-react";
import type { Project } from "../../../../shared/projects-ipc";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useBasesNavigation } from "@/components/providers/bases-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { SidebarRenameDialog } from "@/components/sidebar/rename/sidebar-rename-dialog";
import { ProjectAppPlacements } from "./apps/project-app-placements";
import {
  ProjectAppearancePanel,
} from "@/components/sidebar/project/appearance/project-appearance-picker";
import {
  ProjectLifecycleDialogs,
  useProjectLifecycle,
} from "@/components/sidebar/project/project-lifecycle";
import {
  SettingsButton,
  SettingsCanvas,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
  SettingsSurface,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings-store";
import { memoryStore } from "@/lib/memory-store";
import { projectMemoryConclusion } from "@/lib/memory-view";
import {
  resolveProjectColor,
  resolveProjectGlyph,
} from "@/lib/project-appearance";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";

export function ProjectGeneralSection({
  project,
  chats,
}: {
  project: Project;
  chats: ChatSummary[];
}) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { renameProject, setProjectAppearance } = useProjects();
  const history = useOptionalHistory();
  const {
    ensure: ensureBase,
    rootBases,
    projectBases,
    projectBasesLoaded,
  } = useBasesNavigation();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const memory = useSyncExternalStore(memoryStore.subscribe, memoryStore.getSnapshot);
  const [renameOpen, setRenameOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [baseBusy, setBaseBusy] = useState(false);

  useEffect(() => {
    settingsStore.ensureLoaded();
    memoryStore.ensureLoaded();
  }, []);

  const historyState = history?.snapshot.projects.find(
    (candidate) => candidate.projectId === project.id
  );
  const memoryConclusion = projectMemoryConclusion({
    memorySettings: settings?.memory ?? null,
    serviceStatus: memory.status,
    delivering: Boolean(historyState?.delivering),
  });
  const projectBase = projectBases.find(
    (base) => base.ownerKey === `project:${project.id}`
  );
  const rootBaseCount = chats.filter((chat) =>
    rootBases.some((base) => base.ownerKey === `chat:${chat.id}`)
  ).length + Number(Boolean(projectBase));
  const lifecycle = useProjectLifecycle(project, {
    chats,
    rootBaseCount,
    hasProjectBase: Boolean(projectBase),
    groupMemory: settings?.memory.sharingMode === "group",
    onLeave: () => {},
  });
  const openBase = async () => {
    setBaseBusy(true);
    try {
      await ensureBase(`project:${project.id}`);
      navigate(`/bases/project/${project.id}`);
    } catch {
      // BasesProvider owns the user-facing failure state.
    } finally {
      setBaseBusy(false);
    }
  };

  return (
    <SettingsCanvas>
      <div className="space-y-8">
        <SettingsSection title={t("projectSettings.general.sectionBasics")}>
          <SettingsList>
            <ProjectIdentityRow
              appearanceOpen={appearanceOpen}
              onAppearanceOpenChange={setAppearanceOpen}
              onAppearance={(appearance) => {
                void setProjectAppearance(project.id, appearance).catch(() => undefined);
              }}
              onRename={() => setRenameOpen(true)}
              project={project}
            />
            <SettingsRow
              htmlFor="project-memory-manage"
              label={t("projectSettings.general.memory")}
              description={
                <>
                  {t(memoryConclusion.copyKey)}
                  {memoryConclusion.delivering && ` · ${t("projectSettings.general.memoryDelivering")}`}
                </>
              }
              control={
                <SettingsButton asChild id="project-memory-manage" variant="outline">
                  <Link to="/settings/memory">{t("projectSettings.general.memoryManage")}</Link>
                </SettingsButton>
              }
            />
            {project.workspaceBinding.kind === "external" && history && (
              <SettingsRow
                htmlFor="project-history-import"
                label={t("projectSettings.general.history")}
                description={t("projectSettings.general.historyHint")}
                control={
                  <SettingsSwitch
                    checked={Boolean(historyState?.enabled)}
                    id="project-history-import"
                    label={t("projectSettings.general.history")}
                    onToggle={(enabled) => void history.setEnabled(project.id, enabled)}
                  />
                }
              />
            )}
          </SettingsList>
        </SettingsSection>

        {/* App Project 的授权归 App 页面，这里只留一句去处；其余情况整段
            （标题、说明、「添加 App」入口）都归 ProjectAppPlacements 自己，
            动作才落得进 SettingsSection 已有的 action 位。 */}
        {project.workspaceBinding.kind === "app" ? (
          <SettingsSection
            description={t("projectSettings.general.appsManagedByApp")}
            title={t("projectSettings.general.appsSection")}
          >
            <SettingsEmpty icon={<PanelsTopLeft />} title={t("projectSettings.general.appsManagedByApp")} hint={t("projectSettings.general.appLifecycleHint")} />
          </SettingsSection>
        ) : (
          <ProjectAppPlacements project={project} />
        )}

        <SettingsSection title={t("projectSettings.general.baseSection")}>
          {!projectBasesLoaded ? (
            <div aria-label={t("projectSettings.general.baseLoading")} className="h-20 animate-pulse rounded-lg bg-muted" role="status" />
          ) : projectBase ? (
            <SettingsList>
              <SettingsRow
                htmlFor="project-base-open"
                label={projectBase.name}
                description={t("projectSettings.general.baseSummary")}
                control={
                  <SettingsButton asChild id="project-base-open" variant="outline">
                    <Link to={`/bases/project/${project.id}`}>{t("projectSettings.general.baseOpen")}</Link>
                  </SettingsButton>
                }
              />
            </SettingsList>
          ) : (
            <SettingsEmpty
              icon={<Database />}
              title={t("projectSettings.general.baseEmpty")}
              hint={
                <SettingsButton className="mt-3" disabled={baseBusy} onClick={() => void openBase()}>
                  {t("projectSettings.general.baseCreate")}
                </SettingsButton>
              }
            />
          )}
        </SettingsSection>

        <SettingsSection title={t("projectSettings.general.danger")}>
          {project.workspaceBinding.kind === "app" ? (
            <SettingsSurface className="px-4 py-3 text-muted-foreground text-sm">
              {t("projectSettings.general.appLifecycleHint")} {" "}
              <Link className="underline underline-offset-2" to="/apps">{t("common.apps")}</Link>
            </SettingsSurface>
          ) : (
            /* ── 危险区的颜色与次序：由「能不能撤销」一条尺子定 ──────
               归档是可回收的（Archive 页能原样捞回来），它就用常规描边；
               移除本机记录之后这台机器上再没有这条记录，红只发给它。红是
               额度，发给可撤销的动作，就再也镇不住不可撤销的那个。

               这也正是两个确认框早就说过的话：归档的确认是中性主按钮，
               移除本地的确认才是 confirmTone="destructive"。触发处从前把
               颜色发反了，等于替确认框把话说重，且与自己的确认框相反。

               次序同尺：越往下越重，最重的一格坐末位，手要多走一段才够
               得着它。 */
            <SettingsList>
              <SettingsRow
                htmlFor="project-archive"
                label={t("projects.archive")}
                description={t("projectSettings.general.archiveHint")}
                control={
                  <SettingsButton id="project-archive" onClick={lifecycle.requestArchive} variant="outline">
                    <Archive />{t("projects.archive")}
                  </SettingsButton>
                }
              />
              {/* 本地移除在此恒可用：路由守卫已排除 missing，本分支已排除
                  app 绑定——canDetachLocalProject 的两个否定项在此都不可能成立。 */}
              <SettingsRow
                htmlFor="project-detach"
                label={t("projects.removeLocal")}
                description={t("projectSettings.general.detachHint")}
                tone="destructive"
                control={
                  <SettingsButton id="project-detach" onClick={lifecycle.requestLocalDetach} variant="destructive">
                    <FolderX />{t("projects.removeLocal")}
                  </SettingsButton>
                }
              />
            </SettingsList>
          )}
        </SettingsSection>
      </div>

      <SidebarRenameDialog
        currentName={project.name}
        description={t("projects.renameDescription")}
        maxLength={100}
        onOpenChange={setRenameOpen}
        onRename={(name) => renameProject(project.id, name)}
        open={renameOpen}
        title={t("projects.renameTitle")}
      />
      <ProjectLifecycleDialogs controller={lifecycle} />
    </SettingsCanvas>
  );
}

function ProjectIdentityRow({
  appearanceOpen,
  onAppearanceOpenChange,
  onAppearance,
  onRename,
  project,
}: {
  appearanceOpen: boolean;
  onAppearanceOpenChange(open: boolean): void;
  onAppearance(appearance: NonNullable<Project["appearance"]>): void;
  onRename(): void;
  project: Project;
}) {
  const { t } = useAppTranslation();
  const glyph = resolveProjectGlyph(project.appearance?.icon, true);
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Popover open={appearanceOpen} onOpenChange={onAppearanceOpenChange}>
          <PopoverTrigger asChild>
            <Button aria-label={t("projectSettings.general.appearanceAria")} size="icon-lg" type="button" variant="outline">
              <glyph.Icon className={resolveProjectColor(project.appearance?.color).text} />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-max">
            <ProjectAppearancePanel appearance={project.appearance} onCommit={onAppearance} onDone={() => onAppearanceOpenChange(false)} />
          </PopoverContent>
        </Popover>
        <div className="min-w-0">
          <p className="font-medium text-sm">{project.name}</p>
          <p className="mt-1 text-muted-foreground text-xs">{t("projectSettings.general.name")}</p>
        </div>
      </div>
      <SettingsButton onClick={onRename} variant="outline">
        <Pencil className="size-4" />{t("projectSettings.general.renameAction")}
      </SettingsButton>
    </div>
  );
}
