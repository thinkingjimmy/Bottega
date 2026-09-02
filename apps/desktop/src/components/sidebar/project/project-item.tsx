"use client";

/**
 * [INPUT]: Depends on React/routing, Memory settings, Projects/Apps/Bases/History providers, active App target, App Editor intents, Project/Chat contracts, shared system-file-manager copy, lifecycle modules, and Sidebar primitives
 * [OUTPUT]: Provides ProjectItem with pointer-explicit local expansion, Base→Pinned Apps→Chat ordering, sorting, Editor navigation, Settings, native directory reveal, uniform row-action states, and archive helpers
 * [POS]: Project row coordinator consumed by ProjectSection; reusable state machines live in sibling modules
 */

import { useState, useSyncExternalStore } from "react";
import {
  useAppTranslation,
  useSystemFileManagerRevealLabel,
} from "@/components/providers/i18n-provider";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ChevronDown,
  Database,
  FolderOpen,
  FolderX,
  EyeOff,
  Archive,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import type { ChatSummary } from "../../../../shared/chats-ipc";
import type { ProjectHistoryImportState } from "../../../../shared/history-import-ipc";
import type { Project } from "../../../../shared/projects-ipc";
import { ChatThreadItem } from "../chat/chat-thread-item";
import {
  SidebarRenameDialog,
  useSidebarRenameMenu,
} from "../rename/sidebar-rename-dialog";
import { useSidebarActivePath } from "../active/active-path";
import { useSidebarArchiveFeedback } from "../archive/archive-feedback";
import { ProjectAppearancePicker } from "./appearance/project-appearance-picker";
import { SidebarRowMark, SidebarRowTag, sidebarSubRowClass } from "../sidebar-row";
import { useProjects } from "../../providers/projects-provider";
import { useBases } from "../../providers/bases-provider";
import { draftRoute, projectSettingsRoute } from "@/lib/draft-route";
import { settingsStore } from "@/lib/settings-store";
import { restoreArchiveTargets } from "@/lib/archive-client";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@ai-chat/ui/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
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
import { useOptionalHistory } from "../../providers/history/history-provider";
import {
  ProjectLifecycleDialogs,
  useProjectLifecycle,
} from "./project-lifecycle";
import { hideAppEditor, openAppEditor } from "@/lib/apps-client";
import { productDestinationRoute } from "@/lib/product-navigation";
import { ProjectPinnedApps } from "./project-pinned-apps";
import { useSidebarAppTarget } from "../active/app-target";

export { localDetachArchiveReasons } from "./project-lifecycle";

/* 显现通道用 :has(:focus-visible) 而非 focus-within：鼠标点过折叠触发器或行内按钮后
   focus 就留在那儿，focus-within 会让浮层永久钉住——那说明的是「点过」而非「正在看」。
   刷新一旦开始就会 disabled，但禁用按钮仍然匹配 :hover；若不在组合态覆盖，
   它会独自变深，伪装成当前可点的主动作。禁用态回归与 More/新建相同的弱对比。 */
const projectRowActionClass =
  "pointer-events-none cursor-pointer opacity-0 text-sidebar-foreground/35 peer-hover/menu-button:text-sidebar-foreground/35 group-hover/project-row:pointer-events-auto group-hover/project-row:opacity-100 group-has-[:focus-visible]/project-row:pointer-events-auto group-has-[:focus-visible]/project-row:opacity-100 hover:bg-transparent hover:text-sidebar-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:text-sidebar-foreground aria-expanded:pointer-events-auto aria-expanded:opacity-100 aria-expanded:text-sidebar-foreground disabled:cursor-default disabled:hover:text-sidebar-foreground/35 disabled:focus-visible:text-sidebar-foreground/35";

export const canReleaseMissingProject = (
  project: Pick<Project, "missing" | "dir">
) => project.missing && project.dir === "";

export const canRevealProject = (
  project: Pick<Project, "missing" | "dir">
) => !project.missing && project.dir !== "";

export const canDetachLocalProject = (
  project: Pick<Project, "missing" | "dir" | "workspaceBinding">
) =>
  project.workspaceBinding.kind !== "app" &&
  !canReleaseMissingProject(project);

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

/** Provider 独占失败投影；菜单只消费拒绝，避免浮出 unhandled Promise。 */
export async function settleProjectReveal(reveal: () => Promise<unknown>) {
  try {
    await reveal();
  } catch {
    // warning 的唯一 owner 是 ProjectsProvider。
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
  const { t } = useAppTranslation();
  const revealLabel = useSystemFileManagerRevealLabel();
  const {
    renameProject,
    setProjectAppearance,
    revealProject,
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
  const appTarget = useSidebarAppTarget();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [open, setOpen] = useState(true);
  /* 展开到第几页是「这一次浏览」的状态，不是 Project 的属性，故不持久化。
     这个数活在折叠区之外，收起带不走它，归零只能在 onOpenChange 上显式说出来。 */
  const [chatLimit, setChatLimit] = useState(PROJECT_CHAT_PAGE_SIZE);
  const [renameOpen, setRenameOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const memoryUsesProjectScope = settings?.memory.sharingMode === "group";
  const renameMenu = useSidebarRenameMenu(() => setRenameOpen(true));
  /* 展开事实收成一处：折叠区与行首字形读同一个值，不各算一遍。 */
  const expanded = open && !project.missing;
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
  const sortedChats = sortProjectChats(project, chats);
  const listedChats = sortedChats.slice(0, chatLimit);
  const restChats = sortedChats.length - listedChats.length;

  const leaveProjectSurface = (archiveMembers: boolean) => {
    const projectBaseRoute = pathname === `/bases/project/${project.id}`;
    const memberChatRoute = chats.some(
      (chat) => pathname === `/chat/${chat.id}`
    );
    if (active || projectBaseRoute || (archiveMembers && memberChatRoute)) {
      navigate("/");
    }
  };

  const showArchiveFeedback = useSidebarArchiveFeedback();

  const lifecycle = useProjectLifecycle(project, {
    chats,
    pinnedBaseCount,
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
                  className={`cursor-pointer pl-8 group-hover/project-row:bg-sidebar-accent group-hover/project-row:text-sidebar-accent-foreground group-has-[:focus-visible]/project-row:bg-sidebar-accent group-has-[:focus-visible]/project-row:text-sidebar-accent-foreground ${project.missing ? "text-muted-foreground opacity-65" : ""}`}
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
                {...renameMenu.triggerProps}
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
              onCloseAutoFocus={renameMenu.onMenuCloseAutoFocus}
            >
              {!project.missing && (
                <>
                  <DropdownMenuItem onSelect={renameMenu.requestOpen}>
                    <Pencil />
                    {t("projects.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate(projectSettingsRoute(project.id))}>
                    <Settings />
                    {t("projectSettings.entry")}
                  </DropdownMenuItem>
                </>
              )}
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
              {project.workspaceBinding.kind === "external" && !project.missing && (
                <DropdownMenuItem
                  onSelect={() => void history?.setEnabled(project.id, !historyState?.enabled)}
                >
                  <RefreshCw />
                  {t(historyState?.enabled ? "history.disableProject" : "history.enableProject")}
                </DropdownMenuItem>
              )}
              {canReleaseMissingProject(project) && (
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => {
                    setActionBusy(true);
                    void settleMissingProjectRelease(
                      () => releaseMissingProject(project.id),
                      () => setActionBusy(false)
                    );
                  }}
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
              {appEditorId && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      setActionBusy(true);
                      void hideAppEditor(appEditorId)
                        .then(() => leaveProjectSurface(true))
                        .catch((cause) => {
                          console.error("Failed to hide App Edit Project", cause);
                        })
                        .finally(() => setActionBusy(false));
                    }}
                  >
                    <EyeOff />
                    {t("projects.hideAppProject")}
                  </DropdownMenuItem>
                </>
              )}
              {canDetachLocalProject(project) && (
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
            </DropdownMenuContent>
          </DropdownMenu>

          {!project.missing && (
            <SidebarMenuAction
              className={projectRowActionClass}
              aria-label={t("projects.newChatIn", { name: project.name })}
              onClick={() => void newProjectChat()}
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
            <ProjectPinnedApps expanded={expanded} project={project} />
            {listedChats.map((chat) => (
              <ChatThreadItem
                key={chat.id}
                chat={chat}
                active={activePath === `/chat/${chat.id}`}
                badge={project.workspaceBinding.kind === "app" && chat.appRole === "edit" ? t("projects.editBadge") : undefined}
                variant="sub"
              />
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
      </SidebarMenuItem>
    </Collapsible>
  );
}
