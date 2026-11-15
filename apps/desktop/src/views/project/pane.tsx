"use client";

/**
 * [INPUT]: Depends on the ProjectSettingsPane navigation state, Projects provider, pane sections, Project Skills, and i18n
 * [OUTPUT]: Provides ProjectSettingsPane — the 440px right column hosting one-scroll Project Settings with focus scrolling and Escape close
 * [POS]: Main-layout third pane; hidden (not unmounted) while the global Settings overlay is open; full width below 900px
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { useProjectSettingsPane } from "@/components/providers/navigation/project-settings-pane";
import {
  ProjectPaneAppsSection,
  ProjectPaneBaseSection,
  ProjectPaneGeneralSection,
  ProjectPaneInstructionsRow,
} from "@/components/settings/project/pane-sections";
import { ProjectSkillsSettings } from "@/components/settings/project/skills/settings";
import { projectAlive } from "@/lib/chat/drafts/draft-route";
import { cn } from "@ai-chat/ui/lib/utils";

export function ProjectSettingsPane({ hidden }: { hidden?: boolean }) {
  const { t } = useAppTranslation();
  const navigation = useProjectSettingsPane();
  const { projects } = useProjects();
  const pane = navigation?.pane ?? null;
  const rootRef = useRef<HTMLElement>(null);
  const project = projects.find((candidate) => candidate.id === pane?.projectId);

  /* 焦点段是一次性的导航意图：消费掉就清，避免下次开窗又把人拽回旧段。 */
  const focus = pane?.focus;
  useEffect(() => {
    if (!focus || !project) return;
    rootRef.current
      ?.querySelector(`[data-pane-section="${focus}"]`)
      ?.scrollIntoView({ block: "start" });
  }, [focus, project]);

  /* The project can leave while the pane is open (archive, removal); an open
     pane over a dead project is a stale destination, so close it. */
  const gone = pane !== null && projects.length > 0 && (!project || !projectAlive(project));
  useEffect(() => {
    if (gone) navigation?.close();
  }, [gone, navigation]);

  if (!pane || !project || !projectAlive(project)) return null;

  return (
    <aside
      aria-label={t("projectSettings.title", { name: project.name })}
      className={cn(
        "@container min-w-0 shrink-0 border-border border-l bg-background",
        "max-[900px]:absolute max-[900px]:inset-y-0 max-[900px]:right-0 max-[900px]:z-20 max-[900px]:w-full",
        hidden ? "hidden" : "flex w-[440px] flex-col"
      )}
      data-project-settings-pane=""
      onKeyDown={(event) => {
        /* Portaled dialogs (Rename, Add Skills) live outside this DOM subtree but
           still bubble synthetic events through the React tree; only close on a
           real in-pane Escape. */
        if (event.key === "Escape" && rootRef.current?.contains(event.target as Node)) {
          navigation?.close();
        }
      }}
      ref={rootRef}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-border border-b px-4">
        <h2 className="min-w-0 truncate font-heading font-semibold text-base leading-6">
          {project.name}
        </h2>
        <button
          aria-label={t("common.close")}
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => navigation?.close()}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-5">
        <div data-pane-section="general">
          <ProjectPaneGeneralSection project={project} />
        </div>
        <div data-pane-section="instructions">
          <ProjectPaneInstructionsRow project={project} />
        </div>
        <div data-pane-section="apps">
          <ProjectPaneAppsSection project={project} />
        </div>
        <div data-pane-section="base">
          <ProjectPaneBaseSection project={project} />
        </div>
        <div data-pane-section="skills">
          <ProjectSkillsSettings packageFilter={pane.packageFilter} project={project} />
        </div>
      </div>
    </aside>
  );
}
