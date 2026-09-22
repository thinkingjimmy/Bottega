"use client";

/**
 * [INPUT]: Depends on i18n, Projects/Chats/History providers' global-add actions and pending flight, the viewed-computer scope and its pin set, ProjectItem, ProjectPendingRow, the pinning affordance, project-sort, the shared useDelayed gate, controlled collapse state, WorkspaceNavigationSection, ProjectSortMenu and sidebar primitives
 * [OUTPUT]: Provides the native Project section model and a shared presentation wrapper, scoped to the viewed computer and widened by the Projects pinned into its own tab, with ordered Chat metadata, the two-item add action, the rows a pinned Project leaves behind once its owner deletes or archives it, and the pending Project placeholder that stands in its future slot once an add has outlasted 300ms.
 * [POS]: Projects category for components/sidebar/project, placed by AppSidebar above the root Chats category
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import { useCloudSidebar } from "../../cloud/context";
import { ProjectItem } from "../project-item";
import { ProjectPendingRow } from "./project-pending-row";
import { PinnedProjectRow, ProjectAddAction, pinnedTombstones, usePinnedProjectLabels } from "./pinned-remote";
import {
  WorkspaceNavigationSection,
  type NavigationSectionModel,
} from "@ai-chat/ui/components/workspace/navigation/section";
import { workspaceProjectVisible } from "@ai-chat/ui/components/workspace/navigation/project";
import { useChats } from "../../../providers/chats-provider";
import { useProjects } from "../../../providers/projects-provider";
import { sortProjects } from "@/lib/project-sort";
import { ProjectSortMenu } from "@ai-chat/ui/components/workspace/actions/sort";
import { SidebarMenu } from "@ai-chat/ui/components/ui/sidebar";
import { useDelayed } from "@ai-chat/ui/hooks/use-delayed";
import { useHistory } from "../../../providers/history/history-provider";
import { useApps } from "../../../providers/apps-provider";
import {
  appearsAsAppProject,
  appearsInAppProject,
} from "../../../../../shared/placement/sidebar";

export function useProjectSection({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const { chats } = useChats();
  const cloud = useCloudSidebar();
  const { projects, sortMode, loading, setSortMode } = useProjects();
  const { records: apps } = useApps();
  const history = useHistory();
  usePinnedProjectLabels(cloud.scope, projects);
  const chatsOf = (projectId: string) => {
    if (!cloud.scope.local) return [];
    const project = projects.find((candidate) => candidate.id === projectId);
    return chats.filter((chat) =>
      project?.workspaceBinding.kind === "app"
        ? chat.context?.kind === "app-edit" &&
          appearsInAppProject(chat) &&
          chat.context.projectId === projectId
        : chat.projectId === projectId && !chat.effectiveArchived,
    );
  };
  /* App Project 的显形由内容推导：安装只是拥有，编辑/使用发出首条消息
     （canonical chat 落地）它才成为一个工作场所。目录 Project 是用户亲手
     创建的，空着也必须在场。 */
  /* A Project belongs to the computer that published it; one that was never published belongs to this one. A
     pinned Project is the one exception, and it is not an exception to ownership: it stays the owner's Project
     and is only borrowed into this tab. */
  const ownedProjects = projects.filter(
    (project) =>
      cloud.scope.owns(project.cloud?.sourceDeviceId ?? cloud.deviceId) ||
      cloud.scope.pinnedHere(project.id),
  );
  const visibleProjects = ownedProjects.filter((project) =>
    workspaceProjectVisible(
      {
        ...project,
        appId:
          project.workspaceBinding.kind === "app"
            ? project.workspaceBinding.appId
            : null,
      },
      cloud.mirrors.some(
        (head) => head.chat.classification.projectId === project.id,
      ) ||
        appearsAsAppProject(
          apps.find(
            (app) =>
              project.workspaceBinding.kind === "app" &&
              app.id === project.workspaceBinding.appId,
          )?.editor ?? {
            editorActivatedAt: null,
            editorHiddenAt: null,
            editorRevision: 0,
          },
        ),
    ),
  );
  /* Skeletons only stand in for an empty list: a later refresh must never
     pull rows the user is already looking at. */
  const pending = loading && visibleProjects.length === 0;
  /* 选定文件夹后的那次添加先站进列表：绝大多数扫描几十毫秒就结束，行以转正态
     直接出现；只有等待真的超过门槛，占位行才显形，且显形后空态句子让位。 */
  const showPending = useDelayed(300, Boolean(history.pendingProject));
  /* "Deleted over there" is only knowable once this computer's own list is in; until then a pinned row that is
     not in it yet is simply not drawn. */
  const tombstones = pinnedTombstones(cloud.scope, projects, !loading);
  const sorted = sortProjects(
    visibleProjects,
    [
      ...chats,
      ...cloud.heads.map((head) => ({
        projectId: head.chat.classification.projectId,
        updatedAt: head.chat.updatedAt,
      })),
    ],
    sortMode,
  );

  return {
    label: t("common.projects"),
    open,
    onOpenChange,
    actions: (actionClassName) => (
      <>
        <ProjectSortMenu value={sortMode} onValueChange={mode => void setSortMode(mode).catch(() => {})}
          copy={{ label: t("projects.sortAria"), recent: t("projects.sortLastUpdated"), manual: t("projects.sortManual") }}
          className={`${actionClassName} right-7`} />
        <ProjectAddAction className={actionClassName} />
      </>
    ),
    pending,
    loadingLabel: t("common.loadingView"),
    empty: sorted.length === 0 && tombstones.length === 0 && !showPending,
    emptyLabel: t("projects.empty"),
    content: (
      <SidebarMenu>
        {showPending && history.pendingProject && (
          <ProjectPendingRow pending={history.pendingProject} />
        )}
        {sorted.map((project) => (
          // 子列表排序归 sortProjectChats 独有：这里再排一遍只会与它悄悄漂移
          <ProjectItem
            key={project.id}
            project={project}
            chats={chatsOf(project.id)}
            historyState={history.snapshot.projects.find(
              (state) => state.projectId === project.id,
            )}
          />
        ))}
        {/* A pinned Project its owner has retired keeps its place at the end of the group: inert, named, and
            holding the one action that removes it from here. */}
        {tombstones.map(({ entry, project }) => (
          <PinnedProjectRow key={entry.id} entry={entry} project={project} />
        ))}
      </SidebarMenu>
    ),
  } satisfies NavigationSectionModel;
}
export function ProjectSection(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <WorkspaceNavigationSection
      groupName="projects-header"
      {...useProjectSection(props)}
    />
  );
}
