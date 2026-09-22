"use client";
/**
 * [INPUT]: Depends on React, i18n, Sidebar UI, product providers, shared WorkspaceNavigation/SettingsNavigation and ComputerSwitcher, active App targets, footer affordances, cloud projections and the Sidebar notice dialog.
 * [OUTPUT]: Adapts native data and actions to the shared complete sidebar, mounts the account's computer strip with this computer first, creates a new Chat on the computer being viewed and stands its controls down in place while that computer sleeps, and preserves generation-fenced targets, feedback and Settings navigation.
 * [POS]: Sole persistent navigation surface; main.tsx owns its lifetime while active route and App target facts remain centralized in focused resolvers
 */
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  Archive,
  ChartNoAxesColumnIncreasing,
  Database,
  FlaskConical,
  Info,
  RefreshCw,
  Keyboard,
  Loader2,
  PackagePlus,
  Plus,
  Settings,
  Server,
  SlidersHorizontal,
  BrainCircuit,
  Globe,
  TriangleAlert,
  UserPen,
  Wrench,
} from "lucide-react";
import type { ChatSummary } from "../../../shared/chats-ipc";
import type { ChatStorageFailure } from "../../../shared/product-failure";
import {
  SidebarGroupAction,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@ai-chat/ui/components/ui/sidebar";
import {
  SettingsNavigation,
  type SettingsNavigationGroup,
} from "@ai-chat/ui/components/settings/navigation";
import { ComputerSwitcher } from "@ai-chat/ui/components/account/computer-switcher";
import { WorkspaceNavigation } from "@ai-chat/ui/components/workspace/navigation/frame";
import type { NavigationSectionModel } from "@ai-chat/ui/components/workspace/navigation/section";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useProjectSection } from "./project/section/project-section";
import { CloudSidebarProvider, useCloudSidebar } from "./cloud/context";
import { switchableComputers } from "@/lib/cloud/computers/scope";
import { useViewedComputerBlock } from "@/lib/cloud/computers/creation-block";
import { SidebarNotices } from "./feedback/sidebar-notices";
import { ChatNavigationRows } from "./cloud/list";
import { mergeChatRows } from "./cloud/order";
import { ChatReorderList } from "./reorder/chat-reorder-list";
import { SidebarActivity } from "./sidebar-activity";
import { SidebarActivePathContext } from "./active/active-path";
import { resolvedThemeStore } from "@/lib/theme";
import { isApplePlatform } from "@/lib/platform";
import { memoryStore } from "@/lib/memory-store";
import { memoryNeedsAttention } from "@/lib/memory-attention";
import {
  type AppsSidebarStatus,
  useApps,
} from "@/components/providers/apps-provider";
import { useChats } from "@/components/providers/chats-provider";
import { useBasesNavigation } from "@/components/providers/bases-provider";
import { useProjects } from "@/components/providers/projects-provider";
import { ownerRoute } from "@/components/bases/chrome/base-header-actions";
import { SaveAsAppDialog } from "@/components/apps/dialogs/save-as-app";
import { CommandPalette } from "./search/command-palette";
import { useGlobalShortcuts } from "@/lib/shortcuts";

import { ownerFromKey } from "@ai-chat/base-ui/model/owner-key";
import { type SidebarGroups, type SidebarView } from "@/lib/sidebar-layout";
import {
  MEMORY_SETTINGS_PATH,
  type SettingsDestination,
  type SettingsOverlaySection,
} from "@/lib/settings-navigation";
import { PinnedApps } from "./apps/pinned-apps";
import { SidebarUpdateButton } from "./sidebar-update-button";
import { appearsInRootChats } from "../../../shared/placement/sidebar";
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
function AppsStatusIndicator({ status }: { status: AppsSidebarStatus }) {
  const { t } = useAppTranslation();
  if (!status) return null;
  const resultDots = {
    error: { className: "bg-destructive", label: t("common.appInstallFailed") },
    success: {
      className: "bg-blue-500",
      label: t("common.appInstallSucceeded"),
    },
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
function useChatsSection({
  chats,
  chatsLoading,
  storageFailures,
  open,
  onOpenChange,
}: {
  chats: ChatSummary[];
  chatsLoading: boolean;
  storageFailures: ChatStorageFailure[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const { mirrors, facts, loading, error, scope } = useCloudSidebar();
  const [cloudLimit, setCloudLimit] = useState(50);
  const navigate = useNavigate();
  /* A new Chat is created on the computer whose sidebar is on screen, so the control stands down in place with
     that computer's own sentence rather than quietly making the Chat here. */
  const blocked = useViewedComputerBlock(scope, i18n.language);
  const rows = mergeChatRows(
    scope.local ? chats.filter(appearsInRootChats) : [],
    mirrors.filter(
      (head) =>
        head.chat.classification.projectId === null &&
        head.chat.classification.conversationKind === "ordinary",
    ),
    facts,
  );
  const pending = (chatsLoading || loading) && rows.length === 0 && !error;
  return {
    label: t("common.chats"),
    open,
    onOpenChange,
    actions: (actionClassName) => (
      <SidebarGroupAction
        className={`${actionClassName}${blocked ? " opacity-50" : ""}`}
        aria-label={t("common.createChat")}
        aria-disabled={blocked ? true : undefined}
        title={blocked ?? undefined}
        onClick={() => {
          if (!blocked) navigate("/");
        }}
      >
        <Plus />
      </SidebarGroupAction>
    ),
    pending,
    loadingLabel: t("common.loadingView"),
    empty:
      rows.length === 0 && !loading && !error && storageFailures.length === 0,
    emptyLabel: t("common.chatsEmpty"),
    content: (
      <SidebarMenu>
        <ChatReorderList rows={rows}>
          <ChatNavigationRows rows={rows.slice(0, cloudLimit)} />
        </ChatReorderList>
        {rows.length > cloudLimit && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() => setCloudLimit((value) => value + 50)}
            >
              {t("projects.showMore")}
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    ),
  } satisfies NavigationSectionModel;
}
function useBasesSection({
  bases,
  open,
  onOpenChange,
  activePath,
}: {
  bases: ReturnType<typeof useBasesNavigation>["rootBases"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activePath: string;
}) {
  const { t } = useAppTranslation();
  const [saveOwnerKey, setSaveOwnerKey] = useState("");
  const selected = bases.find((base) => base.ownerKey === saveOwnerKey);
  const selectedOwner = selected ? ownerFromKey(selected.ownerKey) : null;
  return {
    section: {
      label: t("common.bases"),
      open,
      onOpenChange,
      empty: bases.length === 0,
      content: (
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
                    aria-label={t("common.promoteBaseToApp", {
                      name: base.name,
                    })}
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
      ),
    } satisfies NavigationSectionModel,
    dialogs: selected && selectedOwner?.kind === "chat" && (
      <SaveAsAppDialog
        chatId={selectedOwner.chatId}
        defaultName={selected.name}
        onOpenChange={(next) => {
          if (!next) setSaveOwnerKey("");
        }}
        open
      />
    ),
  };
}
export function AppSidebar(props: AppSidebarProps) {
  return (
    <CloudSidebarProvider>
      <AppSidebarContent {...props} />
    </CloudSidebarProvider>
  );
}
function AppSidebarContent({
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
  useEffect(() => {
    const open = () => onViewChange("activity");
    window.addEventListener("bottega:open-activity", open);
    return () => window.removeEventListener("bottega:open-activity", open);
  }, [onViewChange]);
  const { t, i18n } = useAppTranslation();
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
    resolvedThemeStore.getSnapshot,
  );
  const { chats, loading: chatsLoading, storageFailures } = useChats();
  const { rootBases } = useBasesNavigation();
  const { scope } = useCloudSidebar();
  const createBlocked = useViewedComputerBlock(scope, i18n.language);
  const projectSection = useProjectSection({
    open: groups.projects,
    onOpenChange: (open) => onGroupOpenChange("projects", open),
  });
  const chatsSection = useChatsSection({
    chats,
    chatsLoading,
    storageFailures,
    open: groups.chats,
    onOpenChange: (open) => onGroupOpenChange("chats", open),
  });
  /* 记忆告警常驻订阅：main 推送已按内容去重，静默时零重渲染。 */
  const memorySnapshot = useSyncExternalStore(
    memoryStore.subscribe,
    memoryStore.getSnapshot,
  );
  const memoryStatus = memorySnapshot.status;
  useEffect(() => {
    memoryStore.ensureLoaded();
  }, []);
  const memoryAttention = memoryNeedsAttention(memoryStatus);
  const memoryBusy = Object.values(memorySnapshot.runtimes).some(
    (runtime) => runtime.phase === "running",
  );
  /* The draft answers for itself: it targets the viewed computer and says so, so the palette and the shortcut
     open it even while that computer sleeps instead of silently coming home to this one. */
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
    routedAppId ? appStudioSurface(routedAppId) : null,
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
  const basesSection = useBasesSection({
    bases: rootBases,
    open: groups.bases,
    onOpenChange: (open) => onGroupOpenChange("bases", open),
    activePath,
  });
  /* 显隐与高亮读同一个值：有档位亮着就是在设置里。Settings 导航按需挂载，
     应用面板则始终保留，只在设置期间 hidden。ProjectItem 等局部交互态因此
     不需要一份按实体无限增长的持久化字典，也不会因一次导航被销毁。 */
  const settingItem = (
    id: SettingsOverlaySection,
    label: string,
    icon: ReactNode,
  ) => ({
    id,
    label,
    icon,
    onSelect: () => onSelectSettings(id),
  });
  const settingsGroups: SettingsNavigationGroup[] = [
    {
      label: t("common.settings"),
      items: [
        settingItem("general", t("common.general"), <Settings />),
        ...(window.cloud
          ? [settingItem("account", t("cloud.syncSettings"), <RefreshCw />)]
          : []),
        settingItem("shortcuts", t("common.keyboardShortcuts"), <Keyboard />),
        settingItem("lab", t("common.lab"), <FlaskConical />),
        settingItem("about", t("settings.about.title"), <Info />),
      ],
    },
    {
      label: t("common.agents"),
      items: [
        settingItem("backends", t("common.backends"), <Server />),
        settingItem(
          "personalization",
          t("common.personalization"),
          <UserPen />,
        ),
        settingItem(
          "usage",
          t("common.usage"),
          <ChartNoAxesColumnIncreasing />,
        ),
      ],
    },
    {
      label: t("common.integrations"),
      items: [
        settingItem("tools", t("common.tools"), <Wrench />),
        {
          id: "skills",
          label: t("common.skills"),
          icon: <SlidersHorizontal />,
          onSelect: onOpenSkillsSettings,
        },
        {
          id: "memory",
          label: t("common.memory"),
          icon: <BrainCircuit />,
          onSelect: onOpenMemorySettings,
          badge: memoryAttention ? (
            <TriangleAlert
              aria-label={t("common.memoryAttention")}
              className="ml-auto size-4 text-amber-600 dark:text-amber-400"
            />
          ) : memoryBusy ? (
            <Loader2
              aria-label={t("memory.runtime.running")}
              className="ml-auto size-4 text-muted-foreground motion-safe:animate-spin"
            />
          ) : undefined,
        },
        settingItem("browser", t("common.browser"), <Globe />),
      ],
    },
    {
      label: t("common.archived"),
      items: [settingItem("archive", t("common.archivedItems"), <Archive />)],
    },
  ];
  const settingsNavigation = activeSettings ? (
    <SettingsNavigation
      backLabel={t("common.backToApp")}
      onBack={onCloseSettings}
      active={activeSettings}
      groups={settingsGroups}
    />
  ) : null;
  return (
    <SidebarActivePathContext value={activePath}>
      <SidebarAppTargetContext value={appTarget}>
        <WorkspaceNavigation
          width={sidebarWidth}
          onWidthChange={onSidebarWidthChange}
          theme={resolvedTheme}
          chrome={
            isApplePlatform() && (
              <div className="h-10 shrink-0 [-webkit-app-region:drag]" />
            )
          }
          replacement={settingsNavigation}
          showToggle={!isApplePlatform()}
          toggleLabel={t("common.toggleSidebar")}
          search={{
            label: t("history.search"),
            onClick: () => setSearchOpen(true),
          }}
          activity={{
            label: t("common.toggleActivity"),
            active: view === "activity",
            onClick: () =>
              onViewChange(view === "activity" ? "library" : "activity"),
            content: <SidebarActivity />,
          }}
          newChat={{
            label: t("common.newChat"),
            active: activePath === "/" && draftProjectId === null,
            render: (children) =>
              createBlocked ? (
                /* aria-disabled rather than disabled: the row keeps its pointer events, which is what carries
                   the sentence to the cursor. */
                <button
                  type="button"
                  aria-disabled="true"
                  title={createBlocked}
                  className="cursor-default opacity-50"
                >
                  {children}
                </button>
              ) : (
                <Link to="/">{children}</Link>
              ),
          }}
          apps={{
            label: t("common.apps"),
            active: activePath === "/apps" || appTarget.kind === "apps",
            render: (children) => <Link to="/apps">{children}</Link>,
          }}
          appsExtras={
            <>
              <AppsStatusIndicator status={sidebarStatus} />
              <PinnedApps />
            </>
          }
          settings={{
            label: t("common.settings"),
            render: (children) => (
              <button type="button" onClick={onOpenSettings}>
                {children}
              </button>
            ),
          }}
          sections={{
            projects: projectSection,
            bases: basesSection.section,
            chats: chatsSection,
          }}
          /* This computer is always the first tab; the rest keep the account's own order. Below two computers the
             strip renders nothing, so a desktop that is the only computer looks exactly as it did. */
          computers={
            <ComputerSwitcher
              computers={switchableComputers(scope)}
              selected={scope.viewed?.machineIdHash ?? null}
              onSelect={scope.select}
              locale={i18n.language}
              copy={{
                label: t("cloud.computers.label"),
                online: t("cloud.online"),
                offline: t("cloud.offline"),
                offlineSince: t("cloud.computers.offlineSince"),
              }}
            />
          }
          footerActions={
            <>
              {(memoryAttention || memoryBusy) && (
                <SidebarMenuButton
                  type="button"
                  aria-label={
                    memoryAttention
                      ? t("common.memoryAttentionOpen")
                      : t("memory.runtime.openRunning")
                  }
                  title={
                    memoryAttention
                      ? t("common.memoryAttentionOpen")
                      : t("memory.runtime.openRunning")
                  }
                  className="relative w-8 flex-none touch-manipulation touch-target-44 cursor-pointer justify-center overflow-visible"
                  onClick={() => void navigate(MEMORY_SETTINGS_PATH)}
                >
                  {memoryAttention ? (
                    <TriangleAlert className="size-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Loader2 className="size-4 text-muted-foreground motion-safe:animate-spin" />
                  )}
                </SidebarMenuButton>
              )}
              <SidebarUpdateButton
                onOpenAbout={() => onSelectSettings("about")}
              />
            </>
          }
        >
          {basesSection.dialogs}
          <CommandPalette
            open={searchOpen}
            onOpenChange={setSearchOpen}
            onNewChat={openNewChat}
            onOpenSettings={openSettings}
          />
        </WorkspaceNavigation>
        <SidebarNotices />
      </SidebarAppTargetContext>
    </SidebarActivePathContext>
  );
}
