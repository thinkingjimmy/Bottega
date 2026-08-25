"use client";

/**
 * [INPUT]: Depends on React, routing, Universal Memory sharing Mode, Projects/Bases/History Provider, Project/ProductChat/ForeignHistory/App agreement and sidebar/ConfirmationDialog
 * [OUTPUT]: Provides ProjectItem, read-only History createdAt of Product Chat, history refresh/switch, non-destructive local detach/condition archive confirmation, Memory re-binding, Project App authorization, split page with Base fixed first row
 * [POS]: Project line units in components/sidebar/project, consumed by ProjectSection; Project Base is the same legal sidebar menu sub as the Unified Subject, and the external source line does not receive rename/archive/Base product action
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ChevronDown,
  Database,
  FolderCog,
  FolderX,
  Archive,
  MoreHorizontal,
  Pencil,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { ForeignHistorySummary, ProjectHistoryImportState } from "../../../../shared/history-import-ipc";
import type {
  Project,
  ProjectLocalDetachReason,
  ProjectMemoryRebindMode,
} from "../../../../shared/projects-ipc";
import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppRecord,
} from "../../../../shared/apps-ipc";
import { ChatThreadItem } from "../chat/chat-thread-item";
import { HistoryThreadItem } from "../history/history-thread-item";
import { useSidebarActivePath } from "../sidebar-active-path";
import { ProjectAppearancePicker } from "./project-appearance-picker";
import { SidebarRowMark, SidebarRowTag, sidebarSubRowClass } from "../sidebar-row";
import { useProjects } from "../../providers/projects-provider";
import { useBases } from "../../providers/bases-provider";
import { draftRoute } from "@/lib/draft-route";
import { settingsStore } from "@/lib/settings-store";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  AppDialogBody,
  AppDialogContent,
  ConfirmationDialog,
} from "@ai-chat/ui/components/ui/app-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@ai-chat/ui/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import { usePointerOpenedMenu } from "@ai-chat/ui/hooks/use-pointer-opened-menu";
import { archiveTargets } from "@/lib/archive-client";
import { grantApp, listApps, revokeAppGrant, setAppGrantState } from "@/lib/apps-client";
import { errorMessage } from "@/lib/errors";
import { useOptionalHistory } from "../../providers/history/history-provider";

/* 显现通道用 :has(:focus-visible) 而非 focus-within：鼠标点过折叠触发器或行内按钮后
   focus 就留在那儿，focus-within 会让浮层永久钉住——那说明的是「点过」而非「正在看」。 */
const projectRowActionClass =
  "pointer-events-none cursor-pointer opacity-0 text-sidebar-foreground/35 peer-hover/menu-button:text-sidebar-foreground/35 group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 group-has-[:focus-visible]/project-row:pointer-events-auto group-has-[:focus-visible]/project-row:opacity-100 hover:bg-transparent hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:text-sidebar-foreground aria-expanded:pointer-events-auto aria-expanded:opacity-100 aria-expanded:text-sidebar-foreground";

export const canReleaseMissingProject = (
  project: Pick<Project, "missing" | "dir">
) => project.missing && project.dir === "";

export const canChooseProjectWorkspace = (
  project: Pick<Project, "missing" | "dir" | "workspaceBinding">
) =>
  project.workspaceBinding.kind !== "app" &&
  !canReleaseMissingProject(project);

export const canDetachLocalProject = (
  project: Pick<Project, "missing" | "dir" | "workspaceBinding">
) =>
  project.workspaceBinding.kind !== "app" &&
  !canReleaseMissingProject(project);

export function localDetachArchiveReasons(input: {
  hasProjectBase: boolean;
  groupMemory: boolean;
}): ProjectLocalDetachReason[] {
  return [
    ...(input.hasProjectBase ? (["project-base"] as const) : []),
    ...(input.groupMemory ? (["group-memory"] as const) : []),
  ];
}

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
const appRoleRank = (chat: ChatSummary) =>
  chat.appRole === "use" ? 0 : chat.appRole === "edit" ? 1 : 2;
const sameRank = () => 0;

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
export const PROJECT_CHAT_PAGE_SIZE = 5;

export function sortProjectChats(
  project: Pick<Project, "workspaceBinding">,
  chats: ChatSummary[]
) {
  const rank =
    project.workspaceBinding.kind === "app" ? appRoleRank : sameRank;
  return [...chats].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      right.createdAt - left.createdAt ||
      left.id.localeCompare(right.id)
  );
}

type ProjectSidebarRow =
  | { kind: "chat"; createdAt: number; id: string; chat: ChatSummary }
  | { kind: "history"; createdAt: number; id: string; history: ForeignHistorySummary };

export function sortProjectRows(
  project: Pick<Project, "workspaceBinding">,
  chats: ChatSummary[],
  histories: ForeignHistorySummary[]
): ProjectSidebarRow[] {
  const rows: ProjectSidebarRow[] = [
    ...chats.map((chat) => ({ kind: "chat" as const, createdAt: chat.createdAt, id: chat.id, chat })),
    ...histories.map((history) => ({ kind: "history" as const, createdAt: history.createdAt, id: history.opaqueId, history })),
  ];
  const rank = (row: ProjectSidebarRow) =>
    project.workspaceBinding.kind === "app" && row.kind === "chat"
      ? appRoleRank(row.chat)
      : project.workspaceBinding.kind === "app" ? 2 : 0;
  return rows.sort(
    (left, right) =>
      rank(left) - rank(right) ||
      right.createdAt - left.createdAt ||
      left.id.localeCompare(right.id)
  );
}

/** Provider 已把失败投影为 warning；菜单边界只负责消费拒绝并恢复 busy。 */
export async function settleMissingProjectRelease(
  release: () => Promise<unknown>,
  settle: () => void
) {
  try {
    await release();
  } catch {
    // warning 的唯一 owner 是 ProjectsProvider。
  } finally {
    settle();
  }
}

/** chooser 取消返回 null 也属于正常完成；Provider 已独占错误提示。 */
export async function settleWorkspaceChoice(
  choose: () => Promise<unknown>,
  settle: () => void
) {
  try {
    await choose();
  } catch {
    // warning 的唯一 owner 是 ProjectsProvider。
  } finally {
    settle();
  }
}

export function ProjectMemoryRebindChoices({
  projectId,
  mode,
  onChange,
}: {
  projectId: string;
  mode: ProjectMemoryRebindMode;
  onChange: (mode: ProjectMemoryRebindMode) => void;
}) {
  const { t } = useAppTranslation();
  return (
    <fieldset className="space-y-2">
      <label className="flex cursor-pointer gap-3 rounded-lg border p-3">
        <input
          type="radio"
          name={`project-rebind-${projectId}`}
          checked={mode === "retain"}
          onChange={() => onChange("retain")}
        />
        <span>
          <span className="block font-medium text-sm">
            {t("memory.rebind.retainTitle")}
          </span>
          <span className="mt-1 block text-muted-foreground text-xs">
            {t("memory.rebind.retainDetail")}
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer gap-3 rounded-lg border p-3">
        <input
          type="radio"
          name={`project-rebind-${projectId}`}
          checked={mode === "new"}
          onChange={() => onChange("new")}
        />
        <span>
          <span className="block font-medium text-sm">
            {t("memory.rebind.newTitle")}
          </span>
          <span className="mt-1 block text-muted-foreground text-xs">
            {t("memory.rebind.newDetail")}
          </span>
        </span>
      </label>
    </fieldset>
  );
}

export function ProjectWorkspaceMenuEntry({
  project,
  busy,
  onChoose,
}: {
  project: Pick<Project, "missing" | "dir" | "workspaceBinding">;
  busy: boolean;
  onChoose: () => void;
}) {
  const { t } = useAppTranslation();
  if (!canChooseProjectWorkspace(project)) return null;
  return (
    <DropdownMenuItem disabled={busy} onSelect={onChoose}>
      <FolderCog />
      {t(
        project.workspaceBinding.kind === "none"
          ? "projects.chooseWorkspace"
          : "projects.changeWorkspace"
      )}
    </DropdownMenuItem>
  );
}

export function ProjectItem({
  project,
  chats,
  histories = [],
  historyState,
}: {
  project: Project;
  chats: ChatSummary[];
  histories?: ForeignHistorySummary[];
  historyState?: ProjectHistoryImportState;
}) {
  const { t } = useAppTranslation();
  const {
    renameProject,
    setProjectAppearance,
    chooseWorkspaceBinding,
    detachLocalProject,
    releaseMissingProject,
  } = useProjects();
  const { pinned, projectBases } = useBases();
  const history = useOptionalHistory();
  const { settings } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const navigate = useNavigate();
  /* 两个问题，两个答案，别混用：activePath 答「哪一行该亮」（设置盖着时
     没有一行该亮），pathname 答「用户此刻真的站在哪条路由上」——归档要
     把人从死路由上挪走，那件事与侧栏亮不亮无关，盖着也得做。 */
  const activePath = useSidebarActivePath();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(true);
  /* 展开到第几页是「这一次浏览」的状态，不是 Project 的属性，故不持久化。
     这个数活在折叠区之外，收起带不走它，归零只能在 onOpenChange 上显式说出来。 */
  const [chatLimit, setChatLimit] = useState(PROJECT_CHAT_PAGE_SIZE);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [localDetachOpen, setLocalDetachOpen] = useState(false);
  const [localDetachReasons, setLocalDetachReasons] = useState<
    ProjectLocalDetachReason[]
  >([]);
  const [operationError, setOperationError] = useState("");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  /* 安全默认 = 开始新的 Project Memory（PRD §4.2）：误点确认时旧记忆
     不会被带进一个完全不同的 workspace；沿用须显式选择。 */
  const [workspaceMode, setWorkspaceMode] =
    useState<ProjectMemoryRebindMode>("new");
  const [appsOpen, setAppsOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const memoryUsesProjectScope = settings?.memory.sharingMode === "group";
  const menu = usePointerOpenedMenu();
  /* 展开事实收成一处：折叠区与行首字形读同一个值，不各算一遍。 */
  const expanded = open && !project.missing;
  const active =
    activePath === "/" && searchParams.get("projectId") === project.id;
  const missingRecord = project.dir === "";
  const tooltip = missingRecord
    ? t("projects.missingRecord")
    : t("projects.missingFolder", { dir: project.dir });
  const pinnedBaseCount = chats.filter((chat) =>
    pinned.some((base) => base.ownerKey === `chat:${chat.id}`)
  ).length + Number(
    pinned.some((base) => base.ownerKey === `project:${project.id}`)
  );
  const projectBase = projectBases.find(
    (base) => base.ownerKey === `project:${project.id}`
  );
  /* Base 固定首行不参与分页：它是这个 Project 的场所而非其中一次对话，
     被「再显示 5 个」推走就等于说它也是一条 chat。
     归档几条后 chatLimit 会大于总数，slice 自己兜住：restChats 归零，
     按钮随之消失——不需要为「列表变短」再写一条分支。 */
  const sortedRows = sortProjectRows(project, chats, histories);
  const listedRows = sortedRows.slice(0, chatLimit);
  const restChats = sortedRows.length - listedRows.length;

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await renameProject(project.id, name.trim());
      setRenameOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const leaveProjectSurface = (archiveMembers: boolean) => {
    const projectBaseRoute = pathname === `/bases/project/${project.id}`;
    const memberChatRoute = chats.some(
      (chat) => pathname === `/chat/${chat.id}`
    );
    if (active || projectBaseRoute || (archiveMembers && memberChatRoute)) {
      navigate("/");
    }
  };

  const archive = async () => {
    setBusy(true);
    setOperationError("");
    try {
      await archiveTargets([{ kind: "project", id: project.id }]);
      leaveProjectSurface(true);
      setArchiveOpen(false);
      setLocalDetachOpen(false);
    } catch (cause) {
      setOperationError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const detachLocal = async () => {
    if (localDetachReasons.length) {
      await archive();
      return;
    }
    setBusy(true);
    setOperationError("");
    try {
      const result = await detachLocalProject(project.id);
      if (result.status === "archive-required") {
        setLocalDetachReasons(result.reasons);
        return;
      }
      leaveProjectSurface(false);
      setLocalDetachOpen(false);
    } catch (cause) {
      setOperationError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const requestLocalDetach = () => {
    setOperationError("");
    setLocalDetachReasons(
      localDetachArchiveReasons({
        hasProjectBase: Boolean(projectBase),
        groupMemory: memoryUsesProjectScope,
      })
    );
    setLocalDetachOpen(true);
  };

  return (
    <Collapsible
      asChild
      open={expanded}
      onOpenChange={(next) => {
        if (project.missing) return;
        /* 折叠即遗忘：一次展开是一次浏览，关上这次浏览就结束了。 */
        if (!next) setChatLimit(PROJECT_CHAT_PAGE_SIZE);
        setOpen(next);
      }}
    >
      <SidebarMenuItem>
        <div className="group/project-row relative">
          {/* 字形提出按钮外做同级绝对定位：button 套 button 是非法 HTML，
              且点击会冒泡回 CollapsibleTrigger——同级让这层隔离是结构性的，
              不靠一句记得写的 stopPropagation。
              也不改成 flex 并排：那会让行底色从 x=28px 才开始，
              hover 与 active 两态都在行首留一道没高亮的缺口。
              top-1 left-1 的 size-6 盒内居中 16px 字形 = (8px, 8px)，与旧 p-2 逐像素相同。
              missing 时仍可点：外观是渲染端元数据，不需要文件夹真实存在，
              禁用只会在行首留一个 24px 的死洞。 */}
          <ProjectAppearancePicker
            appearance={project.appearance}
            className="absolute top-1 left-1"
            dimmed={project.missing}
            expanded={expanded}
            onCommit={(next) => void setProjectAppearance(project.id, next)}
            projectName={project.name}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <CollapsibleTrigger asChild disabled={project.missing}>
                <SidebarMenuButton
                  isActive={active}
                  className={`pl-8 group-hover/project-row:bg-sidebar-accent group-hover/project-row:text-sidebar-accent-foreground group-has-[:focus-visible]/project-row:bg-sidebar-accent group-has-[:focus-visible]/project-row:text-sidebar-accent-foreground ${project.missing ? "text-muted-foreground opacity-65" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">
                    {project.name}
                  </span>
                  {project.missing && <TriangleAlert className="ml-auto text-destructive" />}
                </SidebarMenuButton>
              </CollapsibleTrigger>
            </TooltipTrigger>
            {project.missing && <TooltipContent side="right">{tooltip}</TooltipContent>}
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction
                {...menu.triggerProps}
                className={`${projectRowActionClass} ${project.missing ? "" : "right-7"}`}
                aria-label={t("projects.moreActions", { name: project.name })}
              >
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="start"
              className="w-max min-w-0"
              onCloseAutoFocus={menu.onCloseAutoFocus}
            >
              {!project.missing && (
                <DropdownMenuItem
                  onSelect={() => {
                    setName(project.name);
                    setRenameOpen(true);
                  }}
                >
                  <Pencil />
                  {t("projects.rename")}
                </DropdownMenuItem>
              )}
              <ProjectWorkspaceMenuEntry
                project={project}
                busy={busy}
                onChoose={() => {
                  if (!memoryUsesProjectScope) {
                    setBusy(true);
                    void settleWorkspaceChoice(
                      () => chooseWorkspaceBinding(project.id, "retain"),
                      () => setBusy(false)
                    );
                    return;
                  }
                  setWorkspaceMode("retain");
                  setWorkspaceOpen(true);
                }}
              />
              {project.workspaceBinding.kind !== "app" && !project.missing && (
                <DropdownMenuItem
                  onSelect={() => void history?.setEnabled(project.id, !historyState?.enabled)}
                >
                  <RefreshCw />
                  {t(historyState?.enabled ? "history.disableProject" : "history.enableProject")}
                </DropdownMenuItem>
              )}
              {project.workspaceBinding.kind !== "app" && !project.missing && (
                  <DropdownMenuItem onSelect={() => setAppsOpen(true)}>
                    <PanelsTopLeft />
                    {t("projects.grants.entry")}
                  </DropdownMenuItem>
                )}
              {canReleaseMissingProject(project) && (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => {
                    setBusy(true);
                    void settleMissingProjectRelease(
                      () => releaseMissingProject(project.id),
                      () => setBusy(false)
                    );
                  }}
                >
                  <Undo2 />
                  {t("projects.moveChatsToRoot")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {canDetachLocalProject(project) && (
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={requestLocalDetach}
                >
                  <FolderX />
                  {t("projects.removeLocal")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                variant="destructive"
                disabled={busy}
                onSelect={() => {
                  setOperationError("");
                  setArchiveOpen(true);
                }}
              >
                <Archive />
                {t("projects.archive")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {!project.missing && (
            <SidebarMenuAction
              className={projectRowActionClass}
              aria-label={t("projects.newChatIn", { name: project.name })}
              onClick={() => navigate(draftRoute(project.id))}
            >
              <Plus />
            </SidebarMenuAction>
          )}
          {/* delivering：已确认的 Memory Grant 正在后台逐 turn 交付。复用刷新
              位与转圈语言——都是「本行历史活动进行中」，只有 aria 语义分流。 */}
          {historyState?.enabled && (historyState.hasChanges || historyState.refreshing || historyState.delivering) && (
            <SidebarMenuAction
              className={`${projectRowActionClass} right-14`}
              aria-label={t(historyState.delivering ? "history.deliveringMemory" : "history.refreshProject")}
              disabled={historyState.refreshing || historyState.delivering}
              onClick={() => void history?.refreshProject(project.id)}
            >
              <RefreshCw className={historyState.refreshing || historyState.delivering ? "animate-spin motion-reduce:animate-none" : ""} />
            </SidebarMenuAction>
          )}
        </div>

        <CollapsibleContent>
          <SidebarMenuSub className="mx-0 w-full translate-x-0 gap-px border-l-0 px-0">
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
            {listedRows.map((row) => row.kind === "chat" ? (
              <ChatThreadItem
                key={row.id}
                chat={row.chat}
                active={activePath === `/chat/${row.id}`}
                badge={project.workspaceBinding.kind === "app" && row.chat.appRole === "edit" ? t("projects.editBadge") : undefined}
                variant="sub"
              />
            ) : (
              <HistoryThreadItem key={row.id} history={row.history} active={activePath === `/history/${row.id}`} />
            ))}
            {restChats > 0 && (
              /* 站在列表里当一行，而不是浮在列表外当一个控件：它的位置
                 就是「下面还有」这句话本身。
                 字形与上方每一行共用同一个 `SidebarRowMark`——`SidebarMenuSubButton`
                 的 `[&>svg]` 会强行把直系 svg 涂成 accent 深色，隔一层它就够不着，
                 尺寸也由槽一并裁决，标题因此与上方所有 chat 标题同起一列。弱前景色
                 说明这一行不是其中一员，是通往其中的门。 */
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  asChild
                  className={`${sidebarSubRowClass} cursor-pointer text-sidebar-foreground/55`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      setChatLimit(
                        (current) => current + PROJECT_CHAT_PAGE_SIZE
                      )
                    }
                  >
                    <SidebarRowMark>
                      <ChevronDown aria-hidden />
                    </SidebarRowMark>
                    <span>{t("projects.showMore")}</span>
                  </button>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>

        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent>
            <form onSubmit={rename}>
              <DialogHeader>
                <DialogTitle>{t("projects.renameTitle")}</DialogTitle>
                <DialogDescription>
                  {t("projects.renameDescription")}
                </DialogDescription>
              </DialogHeader>
              <Input
                autoFocus
                className="my-4"
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("projects.archiveTitle")}</DialogTitle>
              <DialogDescription>
                {t("projects.archiveDescription", {
                  name: project.name,
                  chats: chats.length,
                })}
                {pinnedBaseCount > 0 &&
                  ` ${t("projects.archivePinned", { bases: pinnedBaseCount })}`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setArchiveOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button disabled={busy} onClick={() => void archive()}>
                {t("projects.archive")}
              </Button>
            </DialogFooter>
            {operationError && (
              <p className="mt-3 text-destructive text-sm" role="alert">
                {operationError}
              </p>
            )}
          </DialogContent>
        </Dialog>
        {/* main 若在确认瞬间才发现 Base/共享 Memory，必须结束旧的 Remove
            语义再开一张 Archive 问句。key 强制重挂，焦点随之回到 Cancel；
            只换文案会让焦点停在红按钮上，按一次 Enter 就把二次确认吃掉。 */}
        <ConfirmationDialog
          key={localDetachReasons.length ? "archive-instead" : "remove-local"}
          open={localDetachOpen}
          title={t(
            localDetachReasons.length
              ? "projects.archiveInsteadTitle"
              : "projects.removeLocalTitle",
            { name: project.name }
          )}
          description={
            <>
              {t(
                localDetachReasons.length === 2
                  ? "projects.archiveInsteadBoth"
                  : localDetachReasons[0] === "project-base"
                    ? "projects.archiveInsteadBase"
                    : localDetachReasons[0] === "group-memory"
                      ? "projects.archiveInsteadMemory"
                      : "projects.removeLocalDescription"
              )}
              {operationError && (
                <span className="mt-3 block text-destructive" role="alert">
                  {operationError}
                </span>
              )}
            </>
          }
          confirmLabel={t(
            localDetachReasons.length
              ? "projects.archiveInsteadConfirm"
              : "projects.removeLocal"
          )}
          confirmTone="destructive"
          busy={busy}
          showCloseButton
          contentClassName="sm:max-w-[26.25rem] [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:text-muted-foreground [&_[data-slot=dialog-description]]:mt-1 [&_[data-slot=dialog-footer]>button:last-child]:px-4"
          onOpenChange={(next) => {
            setLocalDetachOpen(next);
            if (!next) setOperationError("");
          }}
          onConfirm={() => void detachLocal()}
        />
        <Dialog open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("memory.rebind.dialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("memory.rebind.dialogDescription")}
              </DialogDescription>
            </DialogHeader>
            <ProjectMemoryRebindChoices
              projectId={project.id}
              mode={workspaceMode}
              onChange={setWorkspaceMode}
            />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setWorkspaceOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setWorkspaceOpen(false);
                  void settleWorkspaceChoice(
                    () => chooseWorkspaceBinding(project.id, workspaceMode),
                    () => setBusy(false)
                  );
                }}
              >
                {t("memory.rebind.chooseFolder")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ProjectAppGrantsDialog
          key={`${project.id}:${project.grantRevision}`}
          onOpenChange={setAppsOpen}
          open={appsOpen}
          project={project}
        />
      </SidebarMenuItem>
    </Collapsible>
  );
}

function ProjectAppGrantsDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const [apps, setApps] = useState<AppRecord[]>([]);
  const [grants, setGrants] = useState(project.grants);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  useEffect(() => {
    if (!open) return;
    void listApps()
      .then((snapshot) =>
        setApps(
          snapshot.apps.filter(
            (app) => app.state === "ready" && app.generationBinding.active
          )
        )
      )
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : t("projects.grants.listFailed")
        )
      );
  }, [open, t]);

  const commit = async (
    app: AppRecord,
    data: "none" | "read" | "row-write",
    agentDelegation: AppCapabilityGrant["agentDelegation"]
  ) => {
    setBusyId(app.id);
    setError("");
    try {
      const result = await grantApp({
        target: { kind: "project", projectId: project.id },
        appId: app.id,
        requestedDataLevel: data,
        requestedAgentDelegation: agentDelegation,
      });
      setGrants(result.grants);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("projects.grants.grantFailed")
      );
    } finally {
      setBusyId("");
    }
  };

  const revoke = async (appId: string) => {
    setBusyId(appId);
    setError("");
    try {
      const result = await revokeAppGrant(
        { kind: "project", projectId: project.id },
        appId
      );
      setGrants(result.grants);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("projects.grants.revokeFailed")
      );
    } finally {
      setBusyId("");
    }
  };

  const disable = async (appId: string) => {
    setBusyId(appId);
    setError("");
    try {
      const result = await setAppGrantState({
        appId,
        target: { kind: "project", projectId: project.id },
        state: "disabled",
      });
      setGrants(result.grants);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("projects.grants.disableFailed")
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 表面/正文分工照 AppDialog 解剖：曾是 DialogContent 自己 `max-h-[80vh]
          overflow-y-auto`——一个盒子同时当「有形状的边界」和「能滚的窗口」，
          于是系统滚动条骑在 1.35rem 圆角上，像挂在弹窗外面。表面只当形状，
          滚动归 AppDialogBody 这唯一的主人。 */}
      <AppDialogContent className="sm:max-w-xl">
        <DialogHeader className="shrink-0 gap-0 text-left">
          <DialogTitle>{t("projects.grants.title")}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("projects.grants.description")}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="mt-4 shrink-0 text-destructive text-sm">{error}</p>
        )}
        <AppDialogBody className="mt-4 space-y-3">
          {apps.map((app) => {
            const record = grants.find((item) => item.appId === app.id);
            const grant = record && isPositiveAppGrant(record) ? record : undefined;
            const disabled = Boolean(record && !isPositiveAppGrant(record));
            const busy = busyId === app.id;
            const noData = app.domainIdentity?.kind === "no-data";
            return (
              <section className="rounded-lg border p-3" key={app.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{app.manifest?.name ?? app.displayName}</p>
                    <p className="text-muted-foreground text-xs">
                      {disabled
                        ? t("projects.grants.disabledInherit")
                        : t("projects.grants.summary", {
                            level:
                              grant?.data?.level ??
                              t("projects.grants.dataNone"),
                            delegation: t(
                              grant?.agentDelegation.fileRead ||
                                grant?.agentDelegation.useData
                                ? "projects.grants.delegationOn"
                                : "projects.grants.delegationOff"
                            ),
                          })}
                    </p>
                  </div>
                  {grant && (
                    <Button disabled={busy} onClick={() => void revoke(app.id)} size="sm" variant="ghost">
                      {t("projects.grants.revoke")}
                    </Button>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!noData && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void commit(app, "read", grant?.agentDelegation ?? { fileRead: false, useData: false })
                      }
                      size="sm"
                      variant="outline"
                    >
                      {t("projects.grants.allowRead")}
                    </Button>
                  )}
                  {!noData && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void commit(
                          app,
                          "row-write",
                          grant?.agentDelegation ?? { fileRead: false, useData: false }
                        )
                      }
                      size="sm"
                      variant="outline"
                    >
                      {t("projects.grants.allowRowWrite")}
                    </Button>
                  )}
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void commit(
                        app,
                        grant?.data?.level ?? "none",
                        grant?.agentDelegation.fileRead || grant?.agentDelegation.useData
                          ? { fileRead: false, useData: false }
                          : { fileRead: true, useData: Boolean(grant?.data) }
                      )
                    }
                    size="sm"
                    variant="outline"
                  >
                    {t(
                      grant?.agentDelegation.fileRead ||
                        grant?.agentDelegation.useData
                        ? "projects.grants.delegationDisable"
                        : "projects.grants.delegationEnable"
                    )}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() => void disable(app.id)}
                    size="sm"
                    variant={disabled ? "destructive" : "outline"}
                  >
                    {t(
                      disabled
                        ? "projects.grants.disabledExplicit"
                        : "projects.grants.disableInherit"
                    )}
                  </Button>
                </div>
              </section>
            );
          })}
          {!apps.length && (
            <p className="py-6 text-center text-muted-foreground text-sm">
              {t("projects.grants.empty")}
            </p>
          )}
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  );
}
