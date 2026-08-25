"use client";

/**
 * [INPUT]: Depends on I18n, Projects/Chats/History Provider Global Add, ProjectItem, project-sort, controlled folding mode, SidebarCollapsibleGroup and dropdown/sidebar Original language
 * [OUTPUT]: Provides ProjectSection, Adds the global ProjectImportCoordinator, and provides a shared folding group with a sequence, project list and warning; Chat with the list of external source historians Archived in conjunction with the list of external source historians archived in Settings › Archive, and all rights to the sublist are assigned to ProjectItem
 * [POS]: Projects category for components/sidebar/project, placed by AppSidebar above the root Chats category
 */

import { Check, MoreHorizontal, Plus } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ProjectItem } from "./project-item";
import { SidebarCollapsibleGroup } from "../sidebar-collapsible-group";
import { useChats } from "../../providers/chats-provider";
import { useProjects } from "../../providers/projects-provider";
import { sortProjects } from "@/lib/project-sort";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  SidebarGroupAction,
  SidebarMenu,
} from "@ai-chat/ui/components/ui/sidebar";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import { useHistory } from "../../providers/history/history-provider";

export function ProjectSection({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const menu = usePointerOpenedMenu();
  const { chats } = useChats();
  const { projects, sortMode, warning, setSortMode } = useProjects();
  const history = useHistory();
  const chatsOf = (projectId: string) =>
    chats.filter(
      (chat) => chat.projectId === projectId && !chat.effectiveArchived
    );
  /* archived 与 chat 的 effectiveArchived 同律：源生归档（codex archived_sessions）
     与产品侧归档合成一个位，侧栏一律不列；产品侧归档的恢复入口在 Settings › Archive。 */
  const historiesOf = (projectId: string) =>
    history.snapshot.entries.filter(
      (entry) => entry.projectId === projectId && !entry.archived
    );
  /* App Project 的显形由内容推导：安装只是拥有，编辑/使用发出首条消息
     （canonical chat 落地）它才成为一个工作场所。目录 Project 是用户亲手
     创建的，空着也必须在场。 */
  const visibleProjects = projects.filter(
    (project) =>
      !project.archivedAt &&
      (project.workspaceBinding.kind !== "app" ||
        chatsOf(project.id).length > 0)
  );
  const sorted = sortProjects(visibleProjects, chats, sortMode);

  return (
    <SidebarCollapsibleGroup
      label={t("common.projects")}
      groupName="projects-header"
      open={open}
      onOpenChange={onOpenChange}
      actions={(actionClassName) => (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarGroupAction
                {...menu.triggerProps}
                className={`${actionClassName} right-7`}
                aria-label={t("projects.sortAria")}
              >
                <MoreHorizontal />
              </SidebarGroupAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              className="w-40"
              onCloseAutoFocus={menu.onCloseAutoFocus}
            >
              {([
                ["last-updated", "projects.sortLastUpdated"],
                ["manual", "projects.sortManual"],
              ] as const).map(([mode, labelKey]) => (
                <DropdownMenuItem key={mode} onSelect={() => void setSortMode(mode)}>
                  <Check className={sortMode === mode ? "opacity-100" : "opacity-0"} />
                  {t(labelKey)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <SidebarGroupAction
            className={actionClassName}
            aria-label={t("projects.add")}
            onClick={() => void history.addProject()}
          >
            <Plus />
          </SidebarGroupAction>
        </>
      )}
    >
      <SidebarMenu>
        {sorted.map((project) => (
          // 子列表排序归 sortProjectChats 独有：这里再排一遍只会与它悄悄漂移
          <ProjectItem
            key={project.id}
            project={project}
            chats={chatsOf(project.id)}
            histories={historiesOf(project.id)}
            historyState={history.snapshot.projects.find((state) => state.projectId === project.id)}
          />
        ))}
      </SidebarMenu>
      {sorted.length === 0 && (
        <p className="px-2 py-1.5 text-muted-foreground text-xs">
          {t("projects.empty")}
        </p>
      )}
      {[warning, history.warning].filter(Boolean).map((message) => (
        <p key={message} role="alert" className="px-2 py-1.5 text-muted-foreground text-xs">
          {message}
        </p>
      ))}
    </SidebarCollapsibleGroup>
  );
}
