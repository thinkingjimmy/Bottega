"use client";

/**
 * [INPUT]: Depends on i18n, the viewed-computer scope and its pin set, the history provider, the shared menu/row primitives, the default Project glyph and the lazy ./pin-picker dialog.
 * [OUTPUT]: Provides ProjectAddAction (the group's two-item `+`, which loads ./pin-picker when asked), pinnedTombstones and PinnedProjectRow for a pinned Project its owner has deleted or archived, and usePinnedProjectLabels.
 * [POS]: The pinning affordance for components/sidebar/project/section; a pin is a per-profile arrangement of this computer's tab and writes nothing to the owner, the cloud or any folder.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { FolderPlus, Pin, PinOff, Plus, Globe } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useHistory } from "@/components/providers/history/history-provider";
import type { Project } from "../../../../../shared/projects-ipc";
import type { ComputerScope } from "@/lib/cloud/computers/scope";
import type { PinnedRemoteProject } from "@/lib/cloud/computers/preferences";
import { useCloudSidebar } from "../../cloud/context";
import { resolveProjectGlyph } from "@ai-chat/ui/components/workspace/navigation/appearance";
import { WorkspaceProjectItem } from "@ai-chat/ui/components/workspace/navigation/project";
import { ProjectRowMenu } from "@ai-chat/ui/components/workspace/actions/project";
import { useSidebarRenameMenu } from "@ai-chat/ui/components/workspace/actions/rename";
import { SidebarRowTag } from "@ai-chat/ui/components/workspace/row";
import { SidebarGroupAction } from "@ai-chat/ui/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";

/* The picker is a dialog nobody has opened: it loads with the choice to open it, like every other sidebar dialog. */
const PinPicker = lazy(() => import("./pin-picker").then(module => ({ default: module.PinPicker })));

/**
 * A pinned Project whose owner has archived it, or deleted it outright — the mirror record is then gone and the
 * pin's own label is all that is left of it. The row stays either way: it was put there by hand, and only the
 * hand that put it there takes it away.
 */
export function pinnedTombstones(scope: ComputerScope, projects: readonly Project[], loaded: boolean) {
  if (!scope.local || !loaded) return [];
  return scope.pinned
    .map(entry => ({ entry, project: projects.find(project => project.id === entry.id) }))
    .filter(({ project }) => !project || Boolean(project.archivedAt));
}

/** The owner renames and the pinned row follows; the name is only ever read back once the Project is gone. */
export function usePinnedProjectLabels(scope: ComputerScope, projects: readonly Project[]) {
  useEffect(() => {
    for (const entry of scope.pinned) {
      const project = projects.find(item => item.id === entry.id);
      if (project) scope.describe({ id: entry.id, name: project.name, deviceId: project.cloud?.sourceDeviceId ?? null });
    }
  }, [scope, projects]);
}

export function PinnedProjectRow({ entry, project }: { entry: PinnedRemoteProject; project?: Project }) {
  const { t } = useAppTranslation();
  const { scope } = useCloudSidebar();
  /* The menu's focus arbiter is shared with rename; this row has no dialog to hand focus to. */
  const menu = useSidebarRenameMenu(() => {});
  const glyph = resolveProjectGlyph(project?.appearance?.icon, false);
  const computer = scope.computers.find(item => item.installations.some(install => install.deviceId === entry.deviceId));
  const device = computer?.name ?? scope.viewed?.name ?? "";
  const archived = Boolean(project?.archivedAt);
  return (
    <WorkspaceProjectItem
      name={project?.name ?? entry.name ?? t("projects.missingName")}
      open={false}
      onOpenChange={() => {}}
      active={false}
      disabled
      mark={
        <span aria-hidden className="relative flex size-6 items-center justify-center text-sidebar-foreground/55 [&>svg]:size-4 [&>svg]:[stroke-width:1.5]">
          <glyph.Icon />
          <Globe className="-right-0.5 -bottom-0.5 pointer-events-none absolute size-2.5 rounded-full bg-sidebar text-sidebar-foreground/55" />
        </span>
      }
      details={<SidebarRowTag>{t(archived ? "projects.pin.archived" : "projects.pin.deleted")}</SidebarRowTag>}
      tooltip={t(archived ? "projects.pin.archivedOn" : "projects.pin.deletedOn", { device })}
      actions={
        <ProjectRowMenu
          copy={{ more: t("projects.moreActions", { name: entry.name }), rename: t("projects.rename"), settings: t("projectSettings.entry") }}
          renameMenu={menu}
          editable={false}
          onSettings={() => {}}
        >
          <DropdownMenuItem onSelect={() => scope.unpin(entry.id)}>
            <PinOff />
            {t("projects.pin.unpin")}
          </DropdownMenuItem>
        </ProjectRowMenu>
      }
    >
      {null}
    </WorkspaceProjectItem>
  );
}

/**
 * One computer is not a choice here either: with nowhere to pin from, the `+` stays the single button it has
 * always been and adds a folder on this computer.
 */
export function ProjectAddAction({ className }: { className?: string }) {
  const { t } = useAppTranslation();
  const { scope } = useCloudSidebar();
  const history = useHistory();
  const [pickerOpen, setPickerOpen] = useState(false);
  const menu = useSidebarRenameMenu(() => setPickerOpen(true));
  const addLocal = () => {
    /* A folder chosen here is this computer's, so the strip comes home to the tab it will appear in. */
    scope.selectLocal();
    void history.addProject();
  };
  if (scope.computers.length < 2) {
    return (
      <SidebarGroupAction data-project-section-action="new" className={className} aria-label={t("projects.add")} onClick={addLocal}>
        <Plus />
      </SidebarGroupAction>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction {...menu.triggerProps} type="button" data-project-section-action="new" className={className} aria-label={t("projects.add")}>
            <Plus />
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-max min-w-0" onCloseAutoFocus={menu.onMenuCloseAutoFocus}>
          <DropdownMenuItem onSelect={addLocal}><FolderPlus />{t("projects.pin.local")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={menu.requestOpen}><Pin />{t("projects.pin.remote")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pickerOpen && (
        <Suspense fallback={null}>
          <PinPicker open onOpenChange={setPickerOpen} onCloseAutoFocus={menu.onDialogCloseAutoFocus} />
        </Suspense>
      )}
    </>
  );
}
