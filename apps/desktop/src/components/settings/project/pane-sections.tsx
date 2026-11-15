"use client";

/**
 * [INPUT]: Depends on Project projections, Projects/Bases/History providers, memory/settings stores, shared identity/appearance rows, project personalization client, routing, and i18n
 * [OUTPUT]: Provides the Project Settings pane sections — General (identity, Memory, History import), Instructions row, Apps, and Base — as SettingsSection blocks
 * [POS]: Project Settings pane content; composes existing owners, lifecycle actions stay on the Project row menu
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { Database, PanelsTopLeft } from "lucide-react";
import type { Project } from "../../../../shared/ipc/workspace/projects-ipc";
import type { ProjectInstructionsFile } from "../../../../shared/ipc/settings/personalization-ipc";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useBasesNavigation } from "@/components/providers/content/bases-provider";
import { useOptionalHistory } from "@/components/providers/history/history-provider";
import { SidebarRenameDialog } from "@/components/sidebar/rename/sidebar-rename-dialog";
import { ProjectAppPlacements } from "./apps/project-app-placements";
import {
  ProjectAppearancePanel,
} from "@/components/sidebar/project/appearance/project-appearance-picker";
import {
  SettingsButton,
  SettingsEmpty,
  SettingsList,
  SettingsRow,
  SettingsSection,
} from "@/components/settings/settings-layout";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { memoryStore } from "@/lib/memory/memory-store";
import { projectMemoryConclusion } from "@/lib/memory/memory-view";
import {
  hasProjectPersonalizationBridge,
  listProjectInstructions,
} from "@/lib/projects/project-personalization-client";
import {
  resolveProjectColor,
  resolveProjectGlyph,
} from "@ai-chat/ui/components/workspace/navigation/appearance";
import { ProjectIdentityRow as SharedProjectIdentityRow } from "@ai-chat/ui/components/settings/project/identity";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";

export function ProjectPaneGeneralSection({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const { renameProject, setProjectAppearance } = useProjects();
  const history = useOptionalHistory();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const memory = useSyncExternalStore(memoryStore.subscribe, memoryStore.getSnapshot);
  const [renameOpen, setRenameOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);

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

  return (
    <SettingsSection title={t("projectSettings.pane.generalSection")}>
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
              <SettingsButton
                disabled={history.importingProjectId !== null || Boolean(historyState?.refreshing)}
                id="project-history-import"
                onClick={() => void history.importProject(project)}
                variant="outline"
              >
                {t("history.addWithHistory")}
              </SettingsButton>
            }
          />
        )}
      </SettingsList>
      <SidebarRenameDialog
        currentName={project.name}
        description={t("projects.renameDescription")}
        maxLength={100}
        onOpenChange={setRenameOpen}
        onRename={(name) => renameProject(project.id, name)}
        open={renameOpen}
        title={t("projects.renameTitle")}
      />
    </SettingsSection>
  );
}

export function ProjectPaneInstructionsRow({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [file, setFile] = useState<ProjectInstructionsFile | null>(null);
  const [failed, setFailed] = useState(false);
  const noWorkspace = project.workspaceBinding.kind === "none";
  const bridge = hasProjectPersonalizationBridge();

  useEffect(() => {
    if (!bridge || noWorkspace) return;
    let live = true;
    void listProjectInstructions(project.id)
      .then((snapshot) => {
        if (!live) return;
        setFile(snapshot.files.find((candidate) => candidate.fileId === "agents") ?? snapshot.files[0] ?? null);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [bridge, noWorkspace, project.id]);

  const lines = file?.content?.split("\n").length;
  const description = failed
    ? t("projectSettings.instructions.saveFailed")
    : noWorkspace
      ? t("projectSettings.instructions.noWorkspace")
      : !bridge
        ? t("projectSettings.instructions.bridgeMissing")
        : file
          ? t("projectSettings.pane.instructionsMeta", { file: file.displayPath, count: lines ?? 0 })
          : t("projectSettings.instructions.loading");

  return (
    <SettingsSection title={t("projectSettings.pane.instructionsSection")}>
      <SettingsList>
        <SettingsRow
          htmlFor="project-instructions-edit"
          label={t("projectSettings.instructions.section")}
          description={description}
          control={
            <SettingsButton
              disabled={failed || noWorkspace || !bridge || !file}
              id="project-instructions-edit"
              onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}/instructions`)}
              variant="outline"
            >
              {t("projectSettings.pane.instructionsEdit")}
            </SettingsButton>
          }
        />
      </SettingsList>
    </SettingsSection>
  );
}

/* App Project 的授权归 App 页面，这里只留一句去处；其余情况整段
   （标题、说明、「添加 App」入口）都归 ProjectAppPlacements 自己，
   动作才落得进 SettingsSection 已有的 action 位。 */
export function ProjectPaneAppsSection({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  if (project.workspaceBinding.kind === "app") {
    return (
      <SettingsSection
        description={t("projectSettings.general.appsManagedByApp")}
        title={t("projectSettings.general.appsSection")}
      >
        <SettingsEmpty icon={<PanelsTopLeft />} title={t("projectSettings.general.appsManagedByApp")} hint={t("projectSettings.general.appLifecycleHint")} />
      </SettingsSection>
    );
  }
  return <ProjectAppPlacements project={project} />;
}

export function ProjectPaneBaseSection({ project }: { project: Project }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const { createProjectBase, projectBases, projectBasesLoaded } = useBasesNavigation();
  const [baseBusy, setBaseBusy] = useState(false);
  const projectBase = projectBases.find(
    (base) => base.ownerKey === `project:${project.id}`
  );
  const openBase = async () => {
    setBaseBusy(true);
    try {
      await createProjectBase(project.id);
      navigate(`/bases/project/${project.id}`);
    } catch {
      // BasesProvider owns the user-facing failure state.
    } finally {
      setBaseBusy(false);
    }
  };
  return (
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
    <SharedProjectIdentityRow name={project.name} label={t("projectSettings.general.name")} renameLabel={t("projectSettings.general.renameAction")} onRename={onRename}
      appearance={
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
      } />
  );
}
