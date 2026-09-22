"use client";

/**
 * [INPUT]: Shared ProjectRowMenu, React/routing, Memory settings, Projects/Apps/Bases/History providers, active App target, App Editor intents, Project/Chat contracts, shared system-file-manager copy, lifecycle modules and the shared complete Project row
 * [OUTPUT]: Provides ProjectItem with pointer-explicit local expansion, Base, pinned App and native/mirror Chat ordering, sorting, Editor navigation, Settings, native directory reveal, unbound folder binding, the remote row's globe glyph and owning-computer badge with every directory item withheld, a new Chat created on the owning computer while it is awake, unpinning a borrowed row, uniform row-action states, and archive helpers
 * [POS]: Project row coordinator consumed by ProjectSection; reusable state machines live in sibling modules
 */

import { useState, useSyncExternalStore } from "react";
import {
  WorkspaceProjectItem,
  useWorkspaceProjectDisclosure,
} from "@ai-chat/ui/components/workspace/navigation/project";
import { WorkspaceNavigationMore } from "@ai-chat/ui/components/workspace/navigation/item";
import {
  useAppTranslation,
  useSystemFileManagerRevealLabel,
} from "@/components/providers/i18n-provider";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Database,
  FolderOpen,
  FolderPlus,
  FolderX,
  Globe,
  EyeOff,
  Archive,
  PinOff,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { ProjectHistoryImportState } from "../../../../shared/history-import-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import { ChatNavigationRows } from "../cloud/list";
import { mergeChatRows } from "../cloud/order";
import { ChatReorderList } from "../reorder/chat-reorder-list";
import { useCloudSidebar } from "../cloud/context";
import { compareChats } from "@ai-chat/cloud-protocol/chats/order";
import { computerOnline } from "@ai-chat/cloud-protocol";
import { ProjectOrigin, isRemoteProjectRow, remoteRowComputer } from "../cloud/project-origin";
import { executionCopy } from "@ai-chat/chat-ui/execution-copy";
import {
  SidebarRenameDialog,
  useSidebarRenameMenu,
} from "../rename/sidebar-rename-dialog";
import { useSidebarActivePath } from "../active/active-path";
import { useSidebarArchiveFeedback } from "../archive/archive-feedback";
import { ProjectRowMenu, projectRowActionClass } from "@ai-chat/ui/components/workspace/actions/project";
import { ProjectAppearancePicker } from "./appearance/project-appearance-picker";
import { SidebarRowTag, sidebarSubRowClass } from "@ai-chat/ui/components/workspace/row";
import { useProjects } from "../../providers/projects-provider";
import { useBasesNavigation } from "../../providers/bases-provider";
import { draftRoute, projectSettingsRoute } from "@/lib/draft-route";
import { settingsStore } from "@/lib/settings-store";
import { restoreArchiveTargets } from "@/lib/archive-client";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import { useOptionalHistory } from "../../providers/history/history-provider";
import {
  ProjectLifecycleDialogs,
  useProjectLifecycle,
} from "./project-lifecycle";
import { ProjectRescueDialog } from "./rescue/dialog";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { hideAppEditor, openAppEditor } from "@/lib/apps-client";
import { chooseProjectFolder } from "@/lib/projects-client";
import { productDestinationRoute } from "@/lib/product-navigation";
import { ProjectPinnedApps } from "./project-pinned-apps";
import { useSidebarAppTarget } from "../active/app-target";

export { localDetachArchiveReasons } from "./project-lifecycle";

export const canReleaseMissingProject = (
  project: Pick<Project, "missing" | "dir" | "cloud">,
) => project.missing && project.dir === "" && !project.cloud?.needsLocalFolder;

export const canRevealProject = (project: Pick<Project, "missing" | "dir">) =>
  !project.missing && project.dir !== "";

/* A restored Project keeps every chat and every setting; the only thing this computer lost is the
   folder. Offering that one action is the whole affordance — release and archive stay where they are. */
export const isUnboundProject = (project: Pick<Project, "workspaceBinding">) =>
  project.workspaceBinding.kind === "unbound";

export const canDetachLocalProject = (
  project: Pick<Project, "missing" | "dir" | "workspaceBinding">,
) =>
  project.workspaceBinding.kind !== "app" && !canReleaseMissingProject(project);

/* ── Project 子列表按创建序，不按活动序 ────────────────────────────
 * Project 里的 chat 是这个项目下的工作清单，位置该是钉死的。按 updatedAt
 * 排意味着你回一句三周前的老会话，它就窜到最上面——清单每天长得不一样，
 * 肌肉记忆当场失效。createdAt 在它诞生那一刻就定死，此后永不改写。
 *
 * 「最近聊过什么」由 Activity 视图独家回答，那里继续按活动时间排；
 * 根级 Chats 与 Project 子列表同守创建序（Sidebar 位置恒定），同一条
 * chat 在两种视图里排序键不同不是矛盾，是两个问题。
 *
 * App Project 的 Use/Edit 分档压过创建序：那是角色不是偏好，
 * 找 Use chat 的人不该先在时间流里翻。非 App Project 恒同档，
 * 于是两种 Project 共用同一个比较器，不必分叉出两条 return。
 * ────────────────────────────────────────────────────────── */
/* ── 分页是浏览的节流，不是清单的第二种顺序 ──────────────────────
 * 一个跑了半年的 Project 能攒下几十条 chat。全铺开时它把下面所有 Project、
 * Bases 与根级 Chats 一起顶出视野——那一刻侧栏答的已不是「我要去哪」，
 * 而是「我这个项目一共聊过多少次」，而后者从来不是导航要回答的问题。
 *
 * 「最新的 5 个」= sortProjectChats 的头 5 个，不另立顺序。上面那段已经
 * 论证过子列表按 createdAt 倒序，故头部本就是最新的；App Project 的
 * use/edit 分档继续压过时间，因为那是角色不是新旧——找 Use chat 的人
 * 不该因为它建得早就被分页藏起来。分页若自带一套「新旧」，就会与用户
 * 眼前那个顺序悄悄漂移，而两种顺序必有一种在撒谎。
 *
 * 只增不减：不做 show less。收起的动作早就存在，就是收起这个 Project；
 * 再造一个只收半截列表的按钮，等于给同一件事两个说法。
 * ────────────────────────────────────────────────────────── */

export function sortProjectChats(
  project: Pick<Project, "workspaceBinding">,
  chats: ChatSummary[],
) {
  return [...chats].sort((left, right) =>
    compareChats(
      {
        ...left,
        kind:
          left.appRole === "use"
            ? "app-use"
            : left.appRole === "edit"
              ? "app-edit"
              : "ordinary",
      },
      {
        ...right,
        kind:
          right.appRole === "use"
            ? "app-use"
            : right.appRole === "edit"
              ? "app-edit"
              : "ordinary",
      },
      { appProject: project.workspaceBinding.kind === "app" },
    ),
  );
}

/** The provider shows popup feedback; the menu consumes the rejected promise. */
export async function settleProjectReveal(reveal: () => Promise<unknown>) {
  try {
    await reveal();
  } catch {
    // ProjectsProvider has already shown the failure.
  }
}

export function ProjectItem({
  project,
  chats,
  historyState,
}: {
  project: Project;
  chats: ChatSummary[];
  historyState?: ProjectHistoryImportState;
}) {
  const { t, i18n } = useAppTranslation();
  const revealLabel = useSystemFileManagerRevealLabel();
  const {
    renameProject,
    setProjectAppearance,
    revealProject,
    releaseMissingProject,
  } = useProjects();
  const { rootBases, projectBases } = useBasesNavigation();
  const history = useOptionalHistory();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
  );
  const navigate = useNavigate();
  /* 两个问题，两个答案，别混用：activePath 答「哪一行该亮」（设置盖着时
     没有一行该亮），pathname 答「用户此刻真的站在哪条路由上」——归档要
     把人从死路由上挪走，那件事与侧栏亮不亮无关，盖着也得做。 */
  const activePath = useSidebarActivePath();
  const appTarget = useSidebarAppTarget();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const disclosure = useWorkspaceProjectDisclosure();
  const { open, limit: chatLimit } = disclosure;
  /* 展开到第几页是「这一次浏览」的状态，不是 Project 的属性，故不持久化。
     这个数活在折叠区之外，收起带不走它，归零只能在 onOpenChange 上显式说出来。 */
  const [renameOpen, setRenameOpen] = useState(false);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const memoryUsesProjectScope = settings?.memory.sharingMode === "group";
  const renameMenu = useSidebarRenameMenu(() => setRenameOpen(true));
  const cloud = useCloudSidebar();
  /* 展开事实收成一处：折叠区与行首字形读同一个值，不各算一遍。
     Two facts, never one: `needsLocalFolder` is about this computer and `remoteRow` about another. A Project
     whose folder this computer does not know still offers to bind one; a row that belongs to another computer
     has no folder to talk about at all — no path, no picker, no unavailability. */
  const needsLocalFolder = Boolean(project.cloud?.needsLocalFolder),
    remoteRow = isRemoteProjectRow(cloud.scope, project),
    owningComputer = remoteRow ? remoteRowComputer(cloud.scope, project) : null,
    unavailable = project.missing && !needsLocalFolder;
  const unbound = isUnboundProject(project),
    needsFolder = unbound && !unavailable && !remoteRow;
  const remoteApp = needsLocalFolder && project.workspaceBinding.kind === "app";
  /* A pinned row always keeps its menu, even when the row is one the App rules would otherwise leave menuless:
     the hand that pinned it has to be able to take it back out. */
  const pinnedRow = cloud.scope.pinnedHere(project.id);
  /* A Chat created under another computer's Project is created on that computer, so the folder facts of this one
     have no say — but that computer has to be awake to take it, and an App Project is run by an App that lives
     over there. The row withholds the `+` rather than greying it: everything else it cannot honour is withheld
     the same way, and the group's own `+` is the control that stays put and says why. */
  const ownerAwake = Boolean(owningComputer && computerOnline(owningComputer, cloud.scope.now));
  const canCreateChat = remoteRow
    ? ownerAwake && project.workspaceBinding.kind !== "app"
    : !project.missing && !needsLocalFolder && !unbound;
  const expanded = open && !unavailable;
  const ownerCopy = executionCopy(i18n.language);
  const active =
    (activePath === "/" && searchParams.get("projectId") === project.id) ||
    activePath === projectSettingsRoute(project.id) ||
    (appTarget.kind === "project-app" &&
      appTarget.projectId === project.id &&
      !expanded);
  const missingRecord = project.dir === "";
  const appEditorId =
    project.workspaceBinding.kind === "app"
      ? project.workspaceBinding.appId
      : null;
  const tooltip = unavailable
    ? missingRecord
      ? t("projects.missingRecord")
      : t("projects.missingFolder", { dir: project.dir })
    : t("projects.unbound.tooltip");
  const rootBaseCount =
    chats.filter((chat) =>
      rootBases.some((base) => base.ownerKey === `chat:${chat.id}`),
    ).length +
    Number(rootBases.some((base) => base.ownerKey === `project:${project.id}`));
  const projectBase = projectBases.find(
    (base) => base.ownerKey === `project:${project.id}`,
  );
  /* Base 固定首行不参与分页：它是这个 Project 的场所而非其中一次对话，
     被「再显示 5 个」推走就等于说它也是一条 chat。
     归档几条后 chatLimit 会大于总数，slice 自己兜住：restChats 归零，
     按钮随之消失——不需要为「列表变短」再写一条分支。 */
  const sortedChats = mergeChatRows(
    chats,
    cloud.mirrors.filter(
      (head) => head.chat.classification.projectId === project.id,
    ),
    cloud.facts,
    { appProject: project.workspaceBinding.kind === "app" },
  );
  const listedChats = sortedChats.slice(0, chatLimit);
  const restChats = sortedChats.length - listedChats.length;

  const leaveProjectSurface = (archiveMembers: boolean) => {
    const projectBaseRoute = pathname === `/bases/project/${project.id}`;
    const memberChatRoute = chats.some(
      (chat) => pathname === `/chat/${chat.id}`,
    );
    if (active || projectBaseRoute || (archiveMembers && memberChatRoute)) {
      navigate("/");
    }
  };

  const showArchiveFeedback = useSidebarArchiveFeedback();

  const lifecycle = useProjectLifecycle(project, {
    chats,
    rootBaseCount,
    hasProjectBase: Boolean(projectBase),
    groupMemory: memoryUsesProjectScope,
    onLeave: leaveProjectSurface,
    onArchived: () =>
      showArchiveFeedback({
        kind: "project",
        id: project.id,
        undo: () =>
          restoreArchiveTargets([{ kind: "project", id: project.id }]),
      }),
  });
  const busy = actionBusy || lifecycle.busy;
  const newProjectChat = async () => {
    if (project.workspaceBinding.kind !== "app") {
      navigate(draftRoute(project.id));
      return;
    }
    const destination = await openAppEditor({
      appId: project.workspaceBinding.appId,
      requestId: crypto.randomUUID(),
      mode: "new",
    });
    navigate(productDestinationRoute(destination));
  };

  return (
    <WorkspaceProjectItem
      name={project.name}
      open={expanded}
      active={active}
      disabled={unavailable}
      onOpenChange={(next) => {
        if (!unavailable) disclosure.onOpenChange(next);
      }}
      mark={
        <span className="relative flex size-6 items-center justify-center">
          {/* Colour and icon are a record write, so a remote row keeps its picker: the owning computer
              reconciles the change when it wakes, exactly as it does for a rename. */}
          <ProjectAppearancePicker
            appearance={project.appearance}
            dimmed={unavailable}
            expanded={expanded}
            onCommit={(next) => void setProjectAppearance(project.id, next)}
            projectName={project.name}
            readOnly={remoteApp}
          />
          {/* The corner glyph is what tells the two kinds of Project apart at a glance; the badge on the right
              names the computer. It sits on the icon, so it must not take the picker's clicks. */}
          {remoteRow && (
            <Globe
              role="img"
              aria-label={ownerCopy.runningOn.replace("{device}", owningComputer?.name ?? ownerCopy.computer)}
              className="-right-0.5 -bottom-0.5 pointer-events-none absolute size-2.5 rounded-full bg-sidebar text-sidebar-foreground/55"
            />
          )}
        </span>
      }
      details={
        <>
          {" "}
          <ProjectOrigin project={project} />
          {unavailable && (
            <TriangleAlert className="ml-auto text-destructive" />
          )}
          {/* Muted, not destructive: nothing is broken or lost, the Project is simply waiting
                      for a folder — the same weight as the row actions it sits among. */}
          {needsFolder && (
            <FolderPlus
              role="img"
              aria-label={t("projects.unbound.badge")}
              className="ml-auto text-muted-foreground"
            />
          )}
        </>
      }
      tooltip={unavailable || needsFolder ? tooltip : undefined}
      actions={
        <>
          {" "}
          {(!remoteApp || pinnedRow) && (
            <ProjectRowMenu
              copy={{ more: t("projects.moreActions", { name: project.name }), rename: t("projects.rename"), settings: t("projectSettings.entry") }}
              renameMenu={renameMenu}
              editable={!unavailable && !remoteApp}
              className={canCreateChat ? "right-7" : ""}
              onSettings={() => navigate(projectSettingsRoute(project.id))}
            >
                {canRevealProject(project) && (
                  <DropdownMenuItem
                    onSelect={() =>
                      void settleProjectReveal(() => revealProject(project.id))
                    }
                  >
                    <FolderOpen />
                    {revealLabel}
                  </DropdownMenuItem>
                )}
                {project.workspaceBinding.kind === "external" &&
                  !project.missing && (
                    <DropdownMenuItem
                      onSelect={() =>
                        void history?.setEnabled(
                          project.id,
                          !historyState?.enabled,
                        )
                      }
                    >
                      <RefreshCw />
                      {t(
                        historyState?.enabled
                          ? "history.disableProject"
                          : "history.enableProject",
                      )}
                    </DropdownMenuItem>
                  )}
                {needsFolder && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      setActionBusy(true);
                      void chooseProjectFolder(project.id)
                        .catch((cause) =>
                          toast.error(
                            t("projects.unbound.chooseFailed", {
                              message: errorMessage(cause),
                            }),
                          ),
                        )
                        .finally(() => setActionBusy(false));
                    }}
                  >
                    <FolderPlus />
                    {t("projects.unbound.chooseFolder")}
                  </DropdownMenuItem>
                )}
                {canReleaseMissingProject(project) && !remoteRow && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => setRescueOpen(true)}
                  >
                    <Undo2 />
                    {t("projects.moveChatsToRoot")}
                  </DropdownMenuItem>
                )}
                {/* ── 收尾两格：分割线是条目的影子，不是独立的一行 ──────
                  谁渲染，谁头上就跟着一条线。从前那条线硬写在外面，于是
                  App Project（两格都不渲染）的菜单尾巴上吊着一条没有下文
                  的分割线——那是把「线」当成了位置而不是关系。

                  归档可回收，用常规色；移除本机记录不可撤销，红只给它，
                  并且坐末位：菜单越往下越重，与 Project 设置的危险区同一
                  把尺子。 */}
                {project.workspaceBinding.kind !== "app" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={lifecycle.requestArchive}
                    >
                      <Archive />
                      {t("projects.archive")}
                    </DropdownMenuItem>
                  </>
                )}
                {appEditorId && !needsLocalFolder && !remoteRow && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() => {
                        setActionBusy(true);
                        void hideAppEditor(appEditorId)
                          .then(() => leaveProjectSurface(true))
                          .catch((cause) => {
                            console.error(
                              "Failed to hide App Edit Project",
                              cause,
                            );
                          })
                          .finally(() => setActionBusy(false));
                      }}
                    >
                      <EyeOff />
                      {t("projects.hideAppProject")}
                    </DropdownMenuItem>
                  </>
                )}
                {pinnedRow && (
                  <>
                    <DropdownMenuSeparator />
                    {/* Unpinning is this computer's arrangement and nothing else: the Project, its Chats and its
                        folder stay exactly as they are on the computer that owns them. */}
                    <DropdownMenuItem onSelect={() => cloud.scope.unpin(project.id)}>
                      <PinOff />
                      {t("projects.pin.unpin")}
                    </DropdownMenuItem>
                  </>
                )}
                {canDetachLocalProject(project) && !remoteRow && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={busy}
                      onSelect={lifecycle.requestLocalDetach}
                    >
                      <FolderX />
                      {t("projects.removeLocal")}
                    </DropdownMenuItem>
                  </>
                )}
            </ProjectRowMenu>
          )}
          {canCreateChat && (
            <SidebarMenuAction
              data-project-row-action="new"
              className={projectRowActionClass}
              aria-label={t("projects.newChatIn", { name: project.name })}
              onClick={() => void newProjectChat()}
            >
              <Plus />
            </SidebarMenuAction>
          )}
          {/* delivering：已确认的 Memory Grant 正在后台逐 turn 交付。复用刷新
              位与转圈语言——都是「本行历史活动进行中」，只有 aria 语义分流。 */}
          {historyState?.enabled &&
            (historyState.hasChanges ||
              historyState.refreshing ||
              historyState.delivering) && (
              <SidebarMenuAction
                className={`${projectRowActionClass} right-14`}
                aria-label={t(
                  historyState.delivering
                    ? "history.deliveringMemory"
                    : "history.refreshProject",
                )}
                disabled={historyState.refreshing || historyState.delivering}
                onClick={() => void history?.refreshProject(project.id)}
              >
                <RefreshCw
                  className={
                    historyState.refreshing || historyState.delivering
                      ? "animate-spin motion-reduce:animate-none"
                      : ""
                  }
                />
              </SidebarMenuAction>
            )}
        </>
      }
      dialogs={
        <>
          {" "}
          <SidebarRenameDialog
            open={renameOpen}
            currentName={project.name}
            title={t("projects.renameTitle")}
            description={t("projects.renameDescription")}
            maxLength={100}
            onOpenChange={setRenameOpen}
            onRename={(name) => renameProject(project.id, name)}
            onCloseAutoFocus={renameMenu.onDialogCloseAutoFocus}
          />
          <ProjectLifecycleDialogs controller={lifecycle} />
          {rescueOpen && (
            <ProjectRescueDialog
              projectId={project.id}
              release={() => releaseMissingProject(project.id)}
              onOpenChange={setRescueOpen}
            />
          )}
        </>
      }
    >
      {projectBase && (
        <SidebarMenuSubItem className="w-full">
          <SidebarMenuSubButton
            asChild
            className={sidebarSubRowClass}
            isActive={activePath === `/bases/project/${project.id}`}
          >
            {/* tag 一旦入列，基类的 [&>span:last-child]:truncate 就落到了 tag 上，
                      标题的截断必须显式接回，否则长名字会把 tag 顶出行外。 */}
            <Link to={`/bases/project/${project.id}`}>
              <Database />
              <span className="min-w-0 flex-1 truncate">
                {projectBase.name}
              </span>
              <SidebarRowTag>{t("projects.baseTag")}</SidebarRowTag>
            </Link>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )}
      <ProjectPinnedApps expanded={expanded} project={project} />
      {/* 拖动重排的邻居来自完整的 sortedChats：落在可见页末尾时，下一位是被分页藏起来的那条。 */}
      <ChatReorderList
        rows={sortedChats}
        appProject={project.workspaceBinding.kind === "app"}
      >
        <ChatNavigationRows
          rows={listedChats}
          project
          editBadge={
            project.workspaceBinding.kind === "app"
              ? t("projects.editBadge")
              : undefined
          }
        />
      </ChatReorderList>
      {restChats > 0 && (
        <WorkspaceNavigationMore
          nested
          label={t("projects.showMore")}
          onClick={disclosure.showMore}
        />
      )}
    </WorkspaceProjectItem>
  );
}
