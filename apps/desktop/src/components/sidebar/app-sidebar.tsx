"use client";
/**
 * [INPUT]: Depends on React, i18n, Sidebar UI, product stores/providers, shared active App target/origin, navigation, external-link IPC, and router
 * [OUTPUT]: Provides persistent navigation with asChild-stable row typography, pending-residence-safe generation-fenced Apps/global-pin/Project-alias targets, recovery, and status actions
 * [POS]: Sole persistent navigation surface; main.tsx owns its lifetime while active route and App target facts remain centralized in focused resolvers
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Archive,
  Bell,
  ChartNoAxesColumnIncreasing,
  Database,
  Download,
  Info,
  Keyboard,
  LayoutGrid,
  Loader2,
  PackagePlus,
  PanelLeft,
  Plus,
  Settings,
  Search,
  Server,
  SlidersHorizontal,
  BrainCircuit,
  Globe,
  SquarePen,
  TriangleAlert,
  UserPen,
  Wrench,
} from "lucide-react";
import type { ChatSummary } from "../../../shared/chats-ipc";
import type { ChatStorageFailure } from "../../../shared/product-failure";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@ai-chat/ui/components/ui/sidebar";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { ChatThreadItem } from "./chat/chat-thread-item";
import { ProjectSection } from "./project/section/project-section";
import { SidebarActivity } from "./sidebar-activity";
import {
  SidebarActivePathContext,
  useSidebarActivePath,
} from "./active/active-path";
import { SidebarCollapsibleGroup } from "./sidebar-collapsible-group";
import {
  PRODUCT_LOGO_SIZE,
  PRODUCT_LOGO_URLS,
  PRODUCT_NAME,
} from "@/lib/brand";
import { resolvedThemeStore } from "@/lib/theme";
import { isApplePlatform } from "@/lib/platform";
import { memoryStore } from "@/lib/memory-store";
import { memoryNeedsAttention } from "@/lib/memory-attention";
import {
  type AppsSidebarStatus,
  useApps,
} from "@/components/providers/apps-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useBases } from "@/components/providers/bases-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { ownerRoute } from "@/components/bases/chrome/base-header-actions";
import { SaveAsAppDialog } from "@/components/apps/save-as-app-dialog";
import { CommandPalette } from "./search/command-palette";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { ownerFromKey } from "../../../shared/bases-ipc";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type SidebarGroups,
  type SidebarView,
} from "@/lib/sidebar-layout";
import {
  MEMORY_SETTINGS_PATH,
  type SettingsDestination,
  type SettingsOverlaySection,
} from "@/lib/settings-navigation";
import { openExternal } from "@/lib/agent-client";
import { RELEASE_URL, updateStore } from "@/lib/update-client";
import { PinnedApps } from "./apps/pinned-apps";
import { appearsInRootChats } from "../../../shared/placement/sidebar";
import { ChatStorageFailureNotice } from "../chat-storage-failure-notice";
import {
  activeAppId,
  resolveSidebarAppTarget,
  SidebarAppTargetContext,
} from "./active/app-target";
import { useSidebarAppOrigin } from "./active/app-origin";
import { useAppOriginReconciliation } from "./active/use-app-origin-reconciliation";
import { appStudioSurface } from "../../../shared/window-surfaces-ipc";
import { useSurfaceResidence } from "@/lib/window-surfaces-client";
type AppSidebarProps = {
  /* 当前亮着的那一档，覆盖层与路由已在 main.tsx 折成一个值：侧栏不需要
     知道谁走路由、谁走覆盖层，五个档位一律只比这一个值。 */
  activeSettings: SettingsDestination | null;
  sidebarWidth: number;
  onSidebarWidthChange: (width: number) => void;
  groups: SidebarGroups;
  onGroupOpenChange: (group: keyof SidebarGroups, open: boolean) => void;
  view: SidebarView;
  onViewChange: (view: SidebarView) => void;
  onOpenSettings: () => void;
  onSelectSettings: (section: SettingsOverlaySection) => void;
  onOpenSkillsSettings: () => void;
  /* Memory 是真实路由而非覆盖层档位，故与 onSelectSettings 并列而非其一档。 */
  onOpenMemorySettings: () => void;
  onCloseSettings: () => void;
};
const sidebarTypographyClass =
  "[&_[data-slot=sidebar-group-label]]:text-sm [&_[data-sidebar=menu-button]]:h-8 [&_[data-sidebar=menu-button]]:font-normal! [&_[data-sidebar=menu-button]]:text-sm [&_[data-sidebar=menu-button]]:leading-5 [&_[data-sidebar=menu-sub-button]]:h-8 [&_[data-sidebar=menu-sub-button]]:font-normal! [&_[data-sidebar=menu-sub-button]]:text-sm [&_[data-sidebar=menu-sub-button]]:leading-5 [&_[data-sidebar=menu-button]_svg]:[stroke-width:1.5]";
function AppsStatusIndicator({ status }: { status: AppsSidebarStatus }) {
  const { t } = useAppTranslation();
  if (!status) return null;
  const resultDots = {
    error: { className: "bg-destructive", label: t("common.appInstallFailed") },
    success: { className: "bg-blue-500", label: t("common.appInstallSucceeded") },
  } as const;
  return (
    <SidebarMenuBadge className="px-0" aria-live="polite">
      {status === "loading" ? (
        <Spinner
          className="size-3.5 text-muted-foreground"
          aria-label={t("common.appInstalling")}
        />
      ) : (
        <>
          <span
            aria-hidden
            className={`size-2 rounded-full ${resultDots[status].className}`}
          />
          <span className="sr-only">{resultDots[status].label}</span>
        </>
      )}
    </SidebarMenuBadge>
  );
}
function ChatsSection({
  chats,
  warning,
  storageFailures,
  open,
  onOpenChange,
}: {
  chats: ChatSummary[];
  warning: string;
  storageFailures: ChatStorageFailure[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const activePath = useSidebarActivePath();
  const navigate = useNavigate();
  /* 排序口径唯一归 ChatsProvider（createdAt 倒序）：这里只过滤不重排——
     再排一遍只会与它悄悄漂移，Project 子列表已经吃过这个亏。 */
  const rootChats = chats.filter(
    (chat) => appearsInRootChats(chat)
  );
  return (
    <SidebarCollapsibleGroup
      label={t("common.chats")}
      groupName="chats-header"
      open={open}
      onOpenChange={onOpenChange}
      actions={(actionClassName) => (
        <SidebarGroupAction
          className={actionClassName}
          aria-label={t("common.createChat")}
          onClick={() => navigate("/")}
        >
          <Plus />
        </SidebarGroupAction>
      )}
    >
      <SidebarMenu>
        {rootChats.map((chat) => (
          <ChatThreadItem
            key={chat.id}
            chat={chat}
            active={
              chat.context?.kind === "app-use"
                ? activePath.endsWith(`#app-use:${chat.id}`)
                : activePath === `/chat/${chat.id}`
            }
          />
        ))}
      </SidebarMenu>
      {/* 空态与 Projects 同构：一行灰字告诉人这里怎么起头，别让空分组像坏了。
          + 建的是新 chat，故文案对齐「点击 + 开始聊天」。 */}
      {rootChats.length === 0 && storageFailures.length === 0 && (
        <p className="px-2 py-1.5 text-muted-foreground text-xs">
          {t("common.chatsEmpty")}
        </p>
      )}
      {storageFailures.map((failure, index) => (
        <ChatStorageFailureNotice
          key={`${failure.code}:${index}`}
          failure={failure}
        />
      ))}
      {warning && (
        <p role="alert" className="px-2 py-1.5 text-muted-foreground text-xs">
          {warning}
        </p>
      )}
    </SidebarCollapsibleGroup>
  );
}
function BasesSection({
  bases,
  open,
  onOpenChange,
}: {
  bases: ReturnType<typeof useBases>["pinned"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useAppTranslation();
  const activePath = useSidebarActivePath();
  const [saveOwnerKey, setSaveOwnerKey] = useState("");
  const selected = bases.find((base) => base.ownerKey === saveOwnerKey);
  const selectedOwner = selected ? ownerFromKey(selected.ownerKey) : null;
  if (!bases.length) return null;
  return (
    <>
    <SidebarCollapsibleGroup
      label={t("common.bases")}
      groupName="bases-header"
      open={open}
      onOpenChange={onOpenChange}
    >
      <SidebarMenu>
        {bases.map((base) => {
          const owner = ownerFromKey(base.ownerKey);
          return (
            <SidebarMenuItem key={`${base.ownerKey}:${base.ownerInstanceId}`}>
              <SidebarMenuButton
                asChild
                isActive={activePath === ownerRoute(base.ownerKey)}
              >
                <Link to={ownerRoute(base.ownerKey)}>
                  <Database />
                  <span>{base.name}</span>
                </Link>
              </SidebarMenuButton>
              {owner.kind === "chat" && (
                <SidebarMenuAction
                  aria-label={t("common.promoteBaseToApp", { name: base.name })}
                  onClick={() => setSaveOwnerKey(base.ownerKey)}
                  showOnHover
                  title={t("common.promoteBaseToApp", { name: base.name })}
                >
                  <PackagePlus />
                </SidebarMenuAction>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarCollapsibleGroup>
    {selected && selectedOwner?.kind === "chat" && (
      <SaveAsAppDialog
        chatId={selectedOwner.chatId}
        defaultName={selected.name}
        onOpenChange={(next) => {
          if (!next) setSaveOwnerKey("");
        }}
        open
      />
    )}
    </>
  );
}
export function AppSidebar({
  activeSettings,
  sidebarWidth,
  onSidebarWidthChange,
  groups,
  onGroupOpenChange,
  view,
  onViewChange,
  onOpenSettings,
  onSelectSettings,
  onOpenSkillsSettings,
  onOpenMemorySettings,
  onCloseSettings,
}: AppSidebarProps) {
  const { t } = useAppTranslation();
  const { toggleSidebar } = useSidebar();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pinnedRecords, records, sidebarStatus } = useApps();
  const { projects } = useProjects();
  const [searchOpen, setSearchOpen] = useState(false);
  const resolvedTheme = useSyncExternalStore(
    resolvedThemeStore.subscribe,
    resolvedThemeStore.getSnapshot,
    resolvedThemeStore.getSnapshot
  );
  const { chats, warning, storageFailures } = useChats();
  const { pinned } = useBases();
  /* 记忆告警常驻订阅：main 推送已按内容去重，静默时零重渲染。 */
  const memorySnapshot = useSyncExternalStore(
    memoryStore.subscribe,
    memoryStore.getSnapshot
  );
  const memoryStatus = memorySnapshot.status;
  const updateSnapshot = useSyncExternalStore(
    updateStore.subscribe,
    updateStore.getSnapshot
  );
  useEffect(() => {
    memoryStore.ensureLoaded();
    updateStore.ensureLoaded();
  }, []);
  const memoryAttention = memoryNeedsAttention(memoryStatus);
  const memoryBusy = Object.values(memorySnapshot.runtimes).some(
    (runtime) => runtime.phase === "running"
  );
  const openNewChat = useCallback(() => {
    setSearchOpen(false);
    void navigate("/");
  }, [navigate]);
  const openSettings = useCallback(() => {
    setSearchOpen(false);
    onOpenSettings();
  }, [onOpenSettings]);
  useGlobalShortcuts({
    search: () => setSearchOpen((value) => !value),
    newChat: openNewChat,
    settings: openSettings,
    /* ⌘B 从 packages/ui 的内建监听收编至此：走同一张可改绑真值表。 */
    toggleSidebar,
  });
  const selectedUseChat =
    pathname.startsWith("/apps/") && searchParams.get("panel") === "use"
      ? searchParams.get("chatId")
      : null;
  const activePath = activeSettings
    ? ""
    : selectedUseChat
      ? `${pathname}#app-use:${selectedUseChat}`
      : pathname;
  const origin = useSidebarAppOrigin();
  const routedAppId = activeAppId(activePath);
  const routedResidence = useSurfaceResidence(
    routedAppId ? appStudioSurface(routedAppId) : null
  );
  const appTarget = resolveSidebarAppTarget({
    activePath,
    origin,
    residence: routedResidence,
    hasResidenceBridge: Boolean(window.windowSurfaces),
    projects,
    records,
    globalPinnedAppIds: new Set(pinnedRecords.map((record) => record.id)),
  });
  useAppOriginReconciliation({
    activePath,
    settingsOpen: Boolean(activeSettings),
    origin,
    target: appTarget,
  });
  const draftProjectId =
    activePath === "/" ? searchParams.get("projectId") : null;
  /* 显隐与高亮读同一个值：有档位亮着就是在设置里。Settings 导航按需挂载，
     应用面板则始终保留，只在设置期间 hidden。ProjectItem 等局部交互态因此
     不需要一份按实体无限增长的持久化字典，也不会因一次导航被销毁。 */
  const settingsNavigation = activeSettings ? (
    <>
      {/* ====== 设置导航：返回 + General / Agents / Integrations / Archived ====== */}
      <SidebarHeader className="p-0.5">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              autoFocus
              className="cursor-pointer"
              onClick={onCloseSettings}
            >
              <ArrowLeft />
              <span>{t("common.backToApp")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {/* 分组间距归容器：`gap` 在 SidebarContent 上只写一次，三组自然等距。
          若改由各组自己加 margin，等距就成了三处巧合——加第四组时必然破。 */}
      <SidebarContent className="gap-4">
        {/* General 收全局偏好（外观 / 存储位置 / Chat）：不属于某个 agent、也不是
            接进来的外部东西，自成一节；节标题复用 common.settings，与其余三组同构。 */}
        <SidebarGroup className="px-0.5 py-0.25">
          <SidebarGroupLabel className="font-normal">
            {t("common.settings")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "general"}
                  onClick={() => onSelectSettings("general")}
                >
                  <Settings />
                  <span>{t("common.general")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "shortcuts"}
                  onClick={() => onSelectSettings("shortcuts")}
                >
                  <Keyboard />
                  <span>{t("common.keyboardShortcuts")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "about"}
                  onClick={() => onSelectSettings("about")}
                >
                  <Info />
                  <span>{t("settings.about.title")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* Agents 收「关于 agent 的一切」：Backends 是引擎（装 / 登录 / 更新 /
            版本漂移），Personalization 是每个 agent 各自的指令文件，Usage 是按
            agent 分的用量——三者都是 agent 维度，聚成一组比散在 Personal 里更好找。
            Backends 置顶：它是引擎，是「先有它才谈得上其余」的那一档。 */}
        <SidebarGroup className="px-0.5 py-0.25">
          <SidebarGroupLabel className="font-normal">
            {t("common.agents")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "backends"}
                  onClick={() => onSelectSettings("backends")}
                >
                  <Server />
                  <span>{t("common.backends")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "personalization"}
                  onClick={() => onSelectSettings("personalization")}
                >
                  <UserPen />
                  <span>{t("common.personalization")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "usage"}
                  onClick={() => onSelectSettings("usage")}
                >
                  <ChartNoAxesColumnIncreasing />
                  <span>{t("common.usage")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* Personal 是「这台机器上的我」，Integrations 是「接进来的外部东西」。
            Browser 接的是 Chrome 与外部站点的登录态，Memory 接的是一个
            独立进程的本机记忆服务（自建或托管，都不是产品本身）——两者
            都曾站在 Personal 里假装是「我的偏好」，而它们其实是外部依赖：
            会连不上、会版本漂移、会需要重新检测，General 与 Usage 永远不会。
            Memory 排在 Browser 之前：它是唯一带告警角标的一档，需要处置的
            事实不该藏在第二行。 */}
        <SidebarGroup className="px-0.5 py-0.25">
          <SidebarGroupLabel className="font-normal">
            {t("common.integrations")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "tools"}
                  onClick={() => onSelectSettings("tools")}
                >
                  <Wrench />
                  <span>{t("common.tools")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "skills"}
                  onClick={onOpenSkillsSettings}
                >
                  <SlidersHorizontal />
                  <span>{t("common.skills")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "memory"}
                  onClick={onOpenMemorySettings}
                >
                  <BrainCircuit />
                  <span>{t("common.memory")}</span>
                  {(memoryAttention || memoryBusy) && (
                    memoryAttention ? <TriangleAlert
                      aria-label={t("common.memoryAttention")}
                      className="ml-auto size-4 text-amber-600 dark:text-amber-400"
                    /> : <Loader2
                      aria-label={t("memory.runtime.running")}
                      className="ml-auto size-4 text-muted-foreground motion-safe:animate-spin"
                    />
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "browser"}
                  onClick={() => onSelectSettings("browser")}
                >
                  <Globe />
                  <span>{t("common.browser")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {/* 归档自成一档：它不是「一项设置」，是一个存放处。
            与其挤在 Personal 里假装同类，不如让它沉到最底下自己占一档。
            叫 items 而不是 chats：这一页同时收 Chat 与 Project，
            标签一旦说小，用户在列表里看到 Project 就会觉得它在骗人。 */}
        <SidebarGroup className="px-0.5 py-0.25">
          <SidebarGroupLabel className="font-normal">
            {t("common.archived")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="cursor-pointer"
                  isActive={activeSettings === "archive"}
                  onClick={() => onSelectSettings("archive")}
                >
                  <Archive />
                  <span>{t("common.archivedItems")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </>
  ) : null;
  return (
    <SidebarActivePathContext value={activePath}>
      <SidebarAppTargetContext value={appTarget}>
      <Sidebar variant="inset" className={sidebarTypographyClass}>
        {/* macOS 顶部这 40px 拖拽区专为红绿灯预留；Windows 走系统原生标题栏，
            没有红绿灯，这条留白就是凭空的空白，故按平台只在 mac 出现。 */}
        {isApplePlatform() && (
          <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
        )}
        {settingsNavigation}
        <div
          data-sidebar-app-panel
          aria-hidden={activeSettings ? true : undefined}
          className={activeSettings ? "hidden" : "contents"}
        >
          {/* ====== 顶部：产品身份 + 视图切换 + New chat + Apps 入口 ====== */}
          <SidebarHeader className="p-0.5">
            <div className="flex h-12 items-center pr-2 pl-2">
              <img
                data-sidebar-brand-logo
                alt={PRODUCT_NAME}
                className="pointer-events-none h-8 w-auto shrink-0 select-none object-contain object-left"
                decoding="sync"
                draggable={false}
                height={PRODUCT_LOGO_SIZE.height}
                src={PRODUCT_LOGO_URLS[resolvedTheme]}
                width={PRODUCT_LOGO_SIZE.width}
              />
              <button
                type="button"
                aria-label={t("history.search")}
                className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/55 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                onClick={() => setSearchOpen(true)}
              >
                <Search aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label={t("common.toggleActivity")}
                aria-pressed={view === "activity"}
                className={`ml-1 flex size-7 cursor-pointer items-center justify-center rounded-md outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
                  view === "activity"
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/55"
                }`}
                onClick={() =>
                  onViewChange(view === "activity" ? "library" : "activity")
                }
              >
                <Bell aria-hidden className="size-4" />
              </button>
              {/* Windows：折叠钮回到 logo 右侧，与 Search / Activity 并列成三连按钮。
                  mac 的折叠钮浮在红绿灯旁（见 main.tsx），故这颗只在 Windows 出现。 */}
              {!isApplePlatform() && (
                <button
                  type="button"
                  aria-label={t("common.toggleSidebar")}
                  className="ml-1 flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground/55 outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  onClick={toggleSidebar}
                >
                  <PanelLeft aria-hidden className="size-4" />
                </button>
              )}
            </div>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={activePath === "/" && draftProjectId === null}
                >
                  <Link to="/">
                    <SquarePen />
                    <span>{t("common.newChat")}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={
                    activePath === "/apps" || appTarget.kind === "apps"
                  }
                >
                  <Link to="/apps">
                    <LayoutGrid />
                    <span>{t("common.apps")}</span>
                  </Link>
                </SidebarMenuButton>
                <AppsStatusIndicator status={sidebarStatus} />
                <PinnedApps />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          {/* ====== 聊天列表 ====== */}
          <SidebarContent>
            <div
              data-sidebar-library-panel
              aria-hidden={view === "activity" ? true : undefined}
              className={view === "activity" ? "hidden" : "contents"}
            >
              <ProjectSection
                open={groups.projects}
                onOpenChange={(open) => onGroupOpenChange("projects", open)}
              />
              <BasesSection
                bases={pinned}
                open={groups.bases}
                onOpenChange={(open) => onGroupOpenChange("bases", open)}
              />
              <ChatsSection
                chats={chats}
                warning={warning}
                storageFailures={storageFailures}
                open={groups.chats}
                onOpenChange={(open) => onGroupOpenChange("chats", open)}
              />
            </div>
            {view === "activity" && <SidebarActivity />}
          </SidebarContent>
          {/* ====== 底部：Settings 入口（记忆异常时紧随文本挂告警，直达 Memory）。
                  告警是独立兄弟按钮而非 SidebarMenuAction：后者绝对定位在行尾，
                  且自带 hover:text-accent 会把 amber 压成前景黑。 ====== */}
          <SidebarFooter className="p-0.5">
            <SidebarMenu>
              <SidebarMenuItem className="flex items-center">
                <SidebarMenuButton
                  className="w-auto flex-none cursor-pointer"
                  onClick={onOpenSettings}
                >
                  <Settings />
                  <span>{t("common.settings")}</span>
                </SidebarMenuButton>
                {(memoryAttention || memoryBusy) && (
                  <button
                    type="button"
                    aria-label={memoryAttention
                      ? t("common.memoryAttentionOpen")
                      : t("memory.runtime.openRunning")}
                    title={memoryAttention
                      ? t("common.memoryAttentionOpen")
                      : t("memory.runtime.openRunning")}
                    className="flex size-11 touch-manipulation cursor-pointer items-center justify-center rounded-md text-amber-600 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring dark:text-amber-400"
                    onClick={() => void navigate(MEMORY_SETTINGS_PATH)}
                  >
                    {memoryAttention
                      ? <TriangleAlert className="size-4" />
                      : <Loader2 className="size-4 text-muted-foreground motion-safe:animate-spin" />}
                  </button>
                )}
                {["available", "downloading", "installing"].includes(
                  updateSnapshot.phase
                ) && (
                  <button
                    type="button"
                    aria-label={
                      updateSnapshot.phase === "available"
                        ? updateSnapshot.automaticInstall
                          ? t("settings.about.upgrade")
                          : t("settings.about.manualUpgrade")
                        : updateSnapshot.phase === "downloading"
                          ? t("settings.about.downloading", {
                              version:
                                updateSnapshot.availableVersion ??
                                updateSnapshot.currentVersion,
                              percent: Math.round(
                                updateSnapshot.progress?.percent ?? 0
                              ),
                            })
                          : t("settings.about.installing")
                    }
                    disabled={updateSnapshot.phase !== "available"}
                    className="ml-1 flex size-11 shrink-0 touch-manipulation cursor-pointer items-center justify-center rounded-md bg-blue-600 text-white outline-none transition-colors hover:bg-blue-500 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar disabled:cursor-wait disabled:opacity-80 motion-reduce:transition-none dark:bg-blue-500 dark:hover:bg-blue-400"
                    onClick={() => {
                      if (updateSnapshot.automaticInstall) {
                        void updateStore.downloadAndInstall();
                      } else {
                        void openExternal(RELEASE_URL);
                      }
                    }}
                  >
                    {updateSnapshot.phase === "available" ? (
                      <Download aria-hidden className="size-4" />
                    ) : updateSnapshot.phase === "downloading" ? (
                      <span className="text-[10px] font-semibold tabular-nums">
                        {Math.round(updateSnapshot.progress?.percent ?? 0)}%
                      </span>
                    ) : (
                      <Loader2
                        aria-hidden
                        className="size-4 motion-safe:animate-spin"
                      />
                    )}
                  </button>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </div>
        <SidebarRail
          resizable
          width={sidebarWidth}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          onWidthChange={onSidebarWidthChange}
        />
        <CommandPalette
          open={searchOpen}
          onOpenChange={setSearchOpen}
          onNewChat={openNewChat}
          onOpenSettings={openSettings}
        />
      </Sidebar>
      </SidebarAppTargetContext>
    </SidebarActivePathContext>
  );
}
