/**
 * [INPUT]: Depends on React DOM/lazy/Suspense, router, global styles, business providers, window context, surface migration, shared feedback toasts, ArchiveCelebrationHost, SketchHost, startup marks, and the build-gated cloud account lifecycle.
 * [OUTPUT]: Composes persistent providers with system typography, window-level feedback hosts before route effects, task-panel access, App recovery, two-step onboarding without the Memory copy section, settings navigation (including background-surface requests, build-flagged Agent configs and Plugins, named plugin details and legacy Memory/Dock aliases), route-independent ProductApp sketch and archive celebration hosts, and the catalog-loaded/product-loading/gate-open startup milestones.
 * [POS]: Renderer bootstrap and sole top-level provider/router/window-role composition boundary
 */
import { SettingsNavigationContext } from "@/components/providers/navigation/context";
import { ArchiveCelebrationHost } from "@/components/sidebar/archive/archive-celebration";
import { CompatibilityUpdateDialog } from "@/components/apps/compatibility/update-dialog";
import { onSetupEvent } from "./lib/settings/setup/setup-client";
import type { AgentBackendId } from "../shared/ipc/agent/agent-ipc";


import {
  lazy,
  startTransition,
  StrictMode,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { panelChromeClassName } from "@/components/page-shell";
import { AppI18nProvider, useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { AppsProvider } from "@/components/providers/content/apps-provider";
import { ChatsProvider } from "@/components/providers/chats-provider";
import { BackgroundQueueHost } from "@/components/chat/runtime/background/queue-runner-host";
import { installDurableDrafts } from "@/lib/chat-composer/durable/durable";
import { BasesProvider } from "@/components/providers/content/bases-provider";
import { ArchiveProvider } from "@/components/providers/content/archive-provider";
import { ProjectsProvider } from "@/components/providers/projects-provider";
import { HistoryProvider } from "@/components/providers/history/history-provider";
import {
  SetupProvider,
  useSetup,
} from "@/components/providers/setup-provider";
import {
  SidebarTrigger,
} from "@ai-chat/ui/components/ui/sidebar";
import { WorkspaceProvider as SidebarProvider, WorkspaceInset as SidebarInset } from "@ai-chat/ui/components/workspace/shell";
import { FeedbackToaster, Toaster, toast } from "@ai-chat/ui/components/ui/sonner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { SketchHost } from "./components/chat/sketch/host/host";
import { ChatRoute } from "@/views/chat/chat";
import { isApplePlatform } from "@/lib/platform/platform";
import {
  PRODUCT_MARK_SIZE,
  PRODUCT_MARK_URL,
  PRODUCT_NAME,
} from "@ai-chat/ui/components/workspace/brand";
import { initialAppLanguage } from "@/lib/settings/client/settings-client";
import { effectiveLocale, setEffectiveLocale } from "@/lib/appearance/i18n-locale";
import { loadSection, type CatalogSection } from "../shared/i18n/sections";
import { loadCatalog } from "../shared/i18n/catalogs";
import { initializeTheme, resolvedThemeStore } from "@/lib/appearance/theme";
import {
  activeSettingsSection,
  settingsExitTarget,
  settingsRouteSection,
  MEMORY_SETTINGS_PATH,
  SKILLS_SETTINGS_PATH,
  OPEN_SETTINGS_EVENT,
  type OpenSettingsRequest,
  type PluginTarget,
  type SettingsOverlaySection,
} from "@/lib/settings/navigation/settings-navigation";
import { settingsStore } from "@/lib/settings/store/settings-store";
import { markStartup } from "@/lib/platform/startup-marks";
import { presenceStore } from "@/lib/clients/presence-client";
import { useGlobalShortcuts } from "@/lib/navigation/shortcuts/shortcuts";
import { resolvePanelBinding } from "../shared/shortcuts/bindings";
import {
  commitSidebarLayout,
  readSidebarLayout,
  type SidebarGroups,
  type SidebarView,
} from "@/lib/navigation/sidebar/sidebar-layout";
import { cn } from "@ai-chat/ui/lib/utils";
import { MessageRendererProvider } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { CHAT_FENCE_RENDERERS } from "@/components/charts/chart-fence-renderers";
import "@ai-chat/ui/globals.css";
import "@ai-chat/chat-ui/model-styles.css";
// 组件级 css 统一在入口引入：node --test 的 tsx loader 无 css 处理，组件内 import 会炸 DOM 测试
import "@/components/sidebar/sidebar-row.css";
import { AppWindowShell } from "@/components/apps/use/app-window-shell";
import { workbenchUiEnabled } from "@ai-chat/ui/lib/workbench-flag";
import { useOpenConfirmationRoute } from "@/components/bases/workflow/bridge";
import {
  installWindowSurfaceRuntime,
  windowContext,
} from "@/lib/platform/window-surfaces-client";
import { panelSlotStore } from "@/components/chat/side-panel/panel-slot-store";

const AppDetailView = lazy(() =>
  import("@/views/apps/app-detail").then((module) => ({
    default: module.AppDetailView,
  }))
);
/* A page that reads a lazy copy section loads it with its own chunk, so its first render already has the copy (no raw key,
   no extra frame). */
const withSection = <T,>(page: Promise<T>, section: CatalogSection) =>
  Promise.all([page, loadSection(section, effectiveLocale())]).then(([module]) => module);
const OnboardingView = lazy(() =>
  import("@/views/onboarding").then((module) => ({
    default: module.OnboardingView,
  }))
);
const AppsListView = lazy(() =>
  import("@/views/apps/apps-list").then((module) => ({
    default: module.AppsListView,
  }))
);
const BaseDetailView = lazy(() =>
  import("@/views/bases/base-detail").then((module) => ({
    default: module.BaseDetailView,
  }))
);
declare const __BOTTEGA_CLOUD_CONFIG__: object | null;
const AccountSettingsView = __BOTTEGA_CLOUD_CONFIG__ ? lazy(() => import("@/views/settings-account").then(module => ({ default: module.AccountSettingsView }))) : null;
const GeneralSettingsView = lazy(() =>
  import("@/views/settings/general/settings-general").then((module) => ({
    default: module.GeneralSettingsView,
  }))
);
const UpdatesSettingsView = lazy(() =>
  import("@/views/settings/updates/settings-updates").then((module) => ({
    default: module.UpdatesSettingsView,
  }))
);
const CommunitySettingsView = lazy(() =>
  import("@/views/settings/community/settings-community").then((module) => ({
    default: module.CommunitySettingsView,
  }))
);
const ShortcutsSettingsView = lazy(() =>
  import("@/views/settings/shortcuts/settings-shortcuts").then((module) => ({
    default: module.ShortcutsSettingsView,
  }))
);
/* Workbench pages exist only with the flag (E-01): no chunk is kept in the flag-off build. */
const PluginsSettingsView = workbenchUiEnabled ? lazy(() =>
  import("@/views/settings/plugins/settings-plugins").then((module) => ({
    default: module.PluginsSettingsView,
  }))
) : null;
/* Workbench pages exist only with the flag (E-01): no chunk is kept in the flag-off build. */
const AgentConfigsSettingsView = workbenchUiEnabled ? lazy(() =>
  import("@/views/settings/agent-configs/settings-agent-configs").then((module) => ({
    default: module.AgentConfigsSettingsView,
  }))
) : null;
const ProvidersSettingsView = lazy(() =>
  import("@/views/settings/providers/settings-providers").then((module) => ({
    default: module.ProvidersSettingsView,
  }))
);
const PersonalizationSettingsView = lazy(() =>
  import("@/views/settings/personalization/settings-personalization").then((module) => ({
    default: module.PersonalizationSettingsView,
  }))
);
const MemorySettingsView = lazy(() =>
  withSection(import("@/views/settings/memory/settings-memory"), "memory").then((module) => ({
    default: module.MemorySettingsView,
  }))
);
const BrowserSettingsView = lazy(() =>
  import("@/views/settings/browser/settings-browser").then((module) => ({
    default: module.BrowserSettingsView,
  }))
);
const ToolsSettingsView = lazy(() =>
  import("@/views/settings/tools/settings-tools").then((module) => ({
    default: module.ToolsPanel,
  }))
);
const SkillsSettingsView = lazy(() =>
  import("@/views/settings/skills/settings-skills").then((module) => ({
    default: module.SkillsSettingsView,
  }))
);
const UsageSettingsView = lazy(() =>
  import("@/views/settings/usage/settings-usage").then((module) => ({
    default: module.UsageSettingsView,
  }))
);
const DockSettingsView = lazy(() =>
  withSection(import("@/views/settings/dock/settings-dock"), "systemDock").then((module) => ({
    default: module.DockSettingsView,
  }))
);
const ArchiveSettingsView = lazy(() =>
  import("@/views/settings/archive/settings-archive").then((module) => ({
    default: module.ArchiveSettingsView,
  }))
);
const ProjectSettingsView = lazy(() =>
  withSection(import("@/views/project/project-settings"), "memory").then((module) => ({
    default: module.ProjectSettingsView,
  }))
);

function ViewLoading() {
  const { t } = useAppTranslation();
  return (
    <div
      aria-live="polite"
      className="grid h-full min-h-0 place-items-center bg-background"
      role="status"
    >
      <span className="sr-only">{t("common.loadingView")}</span>
      <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}

function ProductLoading() {
  const { t } = useAppTranslation();
  useEffect(() => markStartup("product-loading"), []);
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid h-svh place-items-center bg-background"
      role="status"
    >
      <span className="sr-only">{t("common.loadingView")}</span>
      <div className="flex flex-col items-center gap-5">
        <img
          alt={PRODUCT_NAME}
          className="pointer-events-none h-14 w-auto select-none"
          draggable={false}
          height={PRODUCT_MARK_SIZE.height}
          src={PRODUCT_MARK_URL}
          width={PRODUCT_MARK_SIZE.width}
        />
        <div
          aria-hidden="true"
          className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground motion-reduce:animate-none"
        />
      </div>
    </div>
  );
}

function ProductApp() {
  const { t } = useAppTranslation();
  const setup = useSetup();
  const location = useLocation();
  const navigate = useNavigate();
  useOpenConfirmationRoute(navigate);
  const legacyMemorySettings = workbenchUiEnabled && location.pathname === MEMORY_SETTINGS_PATH;
  const [settingsSection, setSettingsSection] =
    useState<SettingsOverlaySection | null>(legacyMemorySettings ? "plugins" : null);
  const settingsReturnFocus = useRef<HTMLElement | null>(null);
  /* 从某个 Agent 的额度卡进 Usage，就该落在那个 Agent 的 tab 上；其它入口不带偏好。 */
  const [usageAgent, setUsageAgent] = useState<AgentBackendId | null>(null);
  /* Settings › Plugins: the plugin whose detail page is open (T-P4); null is the grid. */
  const [pluginTarget, setPluginTarget] = useState<PluginTarget | null>(legacyMemorySettings ? { id: "memory", view: "settings" } : null);
  const [settingsLocation, setSettingsLocation] = useState(location);
  const settingsOrigin = useRef(location);
  const [settingsOverlayReturn, setSettingsOverlayReturn] = useState<{ pathname: string; key?: string } | null>(null);
  if (settingsLocation !== location) {
    setSettingsLocation(location);
    setSettingsOverlayReturn(null);
    const expected = settingsOverlayReturn;
    const returning = expected && (expected.key ? expected.key === location.key : expected.pathname === location.pathname);
    if (!returning) {
      setSettingsSection(legacyMemorySettings ? "plugins" : null);
      if (legacyMemorySettings) setPluginTarget({ id: "memory", view: "settings" });
    }
  }
  const [sidebarLayout, setSidebarLayout] = useState(readSidebarLayout);
  const sidebarLayoutRef = useRef(sidebarLayout);

  /* 覆盖层盖在路由之上，谁在上面谁就是当前档；侧栏只收这一个值。 */
  const activeSettings = activeSettingsSection(
    settingsSection,
    location.pathname
  );
  const inSettingsRoute = settingsRouteSection(location.pathname) !== null;

  /* 换目的地与走人共用同一个动作：把正站着的设置路由退掉。判据仍由
     settingsExitTarget 单点给出，两处都不许自己重推一遍规则。 */
  const leaveSettingsRoute = () => {
    const exit = settingsExitTarget(location.pathname, location.key);
    if (exit === -1) void navigate(-1);
    else if (exit) void navigate(exit);
  };

  /* 覆盖层档位不换路由，所以进去之前必须先退掉可能站着的设置路由——
     否则路由停在 /settings/memory 上不走，Memory 便永远亮着；而每次
     再进 Memory 又会往历史里多压一格设置，「Back to app」于是退回另
     一格设置。设置目的地在任一时刻只有一格，在历史里也只占一格。 */
  const selectSettings = (section: SettingsOverlaySection) => {
    const exit = settingsExitTarget(location.pathname, location.key);
    setSettingsOverlayReturn(exit === -1
      ? settingsOrigin.current
      : exit ? { pathname: exit } : null);
    leaveSettingsRoute();
    const dockPlugin = section === "dock" && workbenchUiEnabled;
    setSettingsSection(dockPlugin ? "plugins" : section);
    setUsageAgent(null);
    setPluginTarget(dockPlugin ? { id: "dock", view: "settings" } : null);
    settingsStore.ensureLoaded();
  };

  /* Background surfaces ask for a Settings section by window event; it lands through the same
     selectSettings as the sidebar. The effect event always runs the latest closure, so the
     listener is registered once instead of on every render. */
  const openRequestedSettings = useEffectEvent(({ section, agent, plugin, pluginView }: OpenSettingsRequest) => {
    selectSettings(section);
    if (section === "usage") setUsageAgent(agent ?? null);
    if (section === "plugins") setPluginTarget(plugin ? { id: plugin, view: pluginView ?? "about" } : null);
  });
  useEffect(() => {
    const open = (event: Event) => openRequestedSettings((event as CustomEvent<OpenSettingsRequest>).detail);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);

  /* Registered once, like the Settings listener above (F-46): the effect event reads the latest setup. */
  const onSetup = useEffectEvent((event: Parameters<Parameters<typeof onSetupEvent>[0]>[0]) => {
    if (event.type === "open-agent-setup") setup.openOnboarding("agent");
  });
  useEffect(() => onSetupEvent(event => onSetup(event)), []);

  // The route owns reset timing; this ref only remembers where the person came from.
  useEffect(() => {
    if (!inSettingsRoute) settingsOrigin.current = location;
  }, [location, inSettingsRoute]);

  /* A signed-out desktop never polls the service; opening Settings is one of the three moments it checks (C-28). */
  const settingsOpen = inSettingsRoute || settingsSection !== null;
  useEffect(() => { if (settingsOpen) void window.cloud?.settingsOpened().catch(() => {}); }, [settingsOpen]);

  const closeSettings = () => {
    setSettingsOverlayReturn(null);
    setSettingsSection(null);
    leaveSettingsRoute();
    const trigger = settingsReturnFocus.current;
    settingsReturnFocus.current = null;
    requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); });
  };

  /* 进 Memory 是「换一个设置目的地」，不是「离开设置」——它此前借用
     onCloseSettings 来清覆盖层，于是同一个回调背了两种意图；出口一旦
     变成真的会走人，这种借用立刻就成了误伤。
     已经站在设置路由上就 replace：设置叠在设置之上没有任何意义，历史
     里只留一格，退出去才必然是回到应用而不是另一页设置。

     startTransition 不是性能调味料，是原子性：清覆盖层与换路由是同一个
     真相的两个载体，必须落在同一次提交里。裸写时前者是紧急更新、而
     HashRouter 把 location 包进了 transition，React 于是先单独提交前者
     ——那一帧 settingsSection 已空、location 还旧，activeSettings 算出
     null，整个侧栏当场翻回 app 分支再翻回来，肉眼就是「闪一下」。
     同一意图的两个载体分两次提交，撕裂是必然而非偶然。 */
  const openMemorySettings = () => {
    if (workbenchUiEnabled) {
      selectSettings("plugins");
      setPluginTarget({ id: "memory", view: "settings" });
      return;
    }
    setSettingsOverlayReturn(null);
    settingsStore.ensureLoaded();
    startTransition(() => {
      setSettingsSection(null);
      void navigate(MEMORY_SETTINGS_PATH, { replace: inSettingsRoute });
    });
  };

  const openSkillsSettings = () => {
    setSettingsOverlayReturn(null);
    settingsStore.ensureLoaded();
    startTransition(() => {
      setSettingsSection(null);
      void navigate(SKILLS_SETTINGS_PATH, { replace: inSettingsRoute });
    });
  };

  const applySidebarLayout = (patch: Partial<typeof sidebarLayout>) => {
    const next = commitSidebarLayout(sidebarLayoutRef.current, patch);
    sidebarLayoutRef.current = next;
    setSidebarLayout(next);
  };

  const setSidebarOpen = (open: boolean) => {
    const current = sidebarLayoutRef.current;
    if (current.open !== open) applySidebarLayout({ open });
  };

  const setSidebarWidth = (width: number) => {
    const current = sidebarLayoutRef.current;
    if (current.width !== width) applySidebarLayout({ width });
  };

  const setSidebarView = (view: SidebarView) => {
    const current = sidebarLayoutRef.current;
    if (current.view !== view) applySidebarLayout({ view });
  };

  const setSidebarGroupOpen = (group: keyof SidebarGroups, open: boolean) => {
    const current = sidebarLayoutRef.current;
    if (current.groups[group] === open) return;
    applySidebarLayout({
      groups: { ...current.groups, [group]: open },
    });
  };

  /* The milestone is the product shell itself, so only the "app" phase counts:
     onboarding is another waiting room, not the thing startup is measured to. */
  useEffect(() => {
    if (setup.onboarding.phase === "app") markStartup("gate-open");
  }, [setup.onboarding.phase]);

  /* Router 上移到 onboarding 之上：引导里的「去设置记忆」是一次
     真实导航，不该被一个早退分支挡在路由树之外。
     判据只有 onboarding-gate 一处：事实未齐先停在品牌 Loading，
     Chat Home 与 Agent 任缺其一才进入引导，启动不再借旧判决闪错页。 */
  if (setup.onboarding.phase === "loading") return <ProductLoading />;

  if (setup.onboarding.phase === "onboarding") {
    return (
      <Suspense fallback={<ProductLoading />}>
        <OnboardingView />
      </Suspense>
    );
  }

  return (
    <SettingsNavigationContext.Provider value={{ openUsage: (trigger, agent) => { settingsReturnFocus.current = trigger; selectSettings("usage"); setUsageAgent(agent ?? null); }, openAgents: () => selectSettings("providers"), openUpdates: () => selectSettings("updates"), openAccount: () => selectSettings("account") }}>
    <AppsProvider>
      <HistoryProvider>
        <ProjectsProvider>
          <ChatsProvider>
            <BasesProvider>
              <ArchiveProvider>
                <MessageRendererProvider value={CHAT_FENCE_RENDERERS}>
                  <TooltipProvider>
                    <SketchHost />
                    <BackgroundQueueHost />
                    <ArchiveCelebrationHost />
                    {/* 覆盖层开着就不挂：Settings 正是补齐缺口的地方，
                        General 那页本来就逐条列着它们并各带动作。站在配置页
                        上还飘一句「去配置」是噪音；更实际的是它 fixed 在右下
                        角、z-50 压过一切，而 Personalization 的保存钮此刻正
                        落在同一个角上——窄窗口下它会把那颗按钮整个盖住。 */}
                    {/* ⌘B 收进中央注册表（可改绑），内建监听器必须交权：
                        两处并存会各自 preventDefault，改绑后旧键还活着。 */}
                    <SidebarProvider
                      keyboardShortcut={false}
                      open={sidebarLayout.open}
                      onOpenChange={setSidebarOpen}
                      style={
                        {
                          "--sidebar-width": `${sidebarLayout.width}px`,
                        } as CSSProperties
                      }

                    >
                      <AppSidebar
                        activeSettings={activeSettings}
                        sidebarWidth={sidebarLayout.width}
                        onSidebarWidthChange={setSidebarWidth}
                        groups={sidebarLayout.groups}
                        onGroupOpenChange={setSidebarGroupOpen}
                        view={sidebarLayout.view}
                        onViewChange={setSidebarView}
                        onOpenSettings={() => selectSettings("general")}
                        onSelectSettings={selectSettings}
                        pluginTarget={pluginTarget}
                        onSelectPlugin={pluginId => { selectSettings("plugins"); setPluginTarget(pluginId ? { id: pluginId, view: "settings" } : null); }}
                        onOpenSkillsSettings={openSkillsSettings}
                        onOpenMemorySettings={openMemorySettings}
                        onCloseSettings={closeSettings}
                      />
                      <SidebarTrigger
                        aria-label={t("common.toggleSidebar")}
                        size="icon-lg"
                        className={cn(
                          "fixed top-2 z-50 cursor-pointer rounded-md [-webkit-app-region:no-drag]",
                          /* macOS 折叠钮浮在红绿灯旁且常驻；Windows 无红绿灯，折叠改由侧栏
                             内联的三连按钮承担，这颗浮层退成「展开」专用——仅折叠态出现在真正的左上角。 */
                          isApplePlatform()
                            ? "left-20"
                            : "left-3 peer-data-[state=expanded]:hidden",
                          panelChromeClassName
                        )}
                      />
                      <SidebarInset>
                        <Suspense fallback={<ViewLoading />}>
                          <div
                            aria-hidden={settingsSection ? true : undefined}
                            className={cn("h-full", settingsSection && "hidden")}
                          >
                            <Routes>
                              <Route path="/settings/updates" element={<UpdatesSettingsView />} />
                              <Route path="/" element={<ChatRoute surfaceVisible={!settingsSection} />} />
                              <Route path="/chat/:id" element={<ChatRoute surfaceVisible={!settingsSection} />} />
                              <Route
                                path="/bases/:ownerKind/:ownerId"
                                element={<BaseDetailView />}
                              />
                              <Route path="/apps" element={<AppsListView />} />
                              <Route
                                path="/apps/:id/:surface?"
                                element={<AppDetailView />}
                              />
                              <Route
                                path="/settings/archive"
                                element={<ArchiveSettingsView />}
                              />
                              <Route
                                path="/settings/memory"
                                element={workbenchUiEnabled ? <ViewLoading /> : <MemorySettingsView />}
                              />
                              <Route
                                path="/settings/tools"
                                element={<ToolsSettingsView />}
                              />
                              <Route
                                path="/settings/skills"
                                element={<SkillsSettingsView />}
                              />
                              <Route
                                path="/settings/extensions"
                                element={<Navigate replace to="/settings/skills?tab=extensions" />}
                              />
                              <Route
                                path="/projects/:projectId/settings"
                                element={<ProjectSettingsView />}
                              />
                            </Routes>
                          </div>
                          <CompatibilityUpdateDialog />
                          {settingsSection === "account" && AccountSettingsView && <AccountSettingsView />}
                          {settingsSection === "general" && <GeneralSettingsView />}
                          {settingsSection === "updates" && <UpdatesSettingsView />}
                          {settingsSection === "community" && <CommunitySettingsView />}
                          {settingsSection === "shortcuts" && <ShortcutsSettingsView />}
                          {settingsSection === "providers" && <ProvidersSettingsView />}
                          {AgentConfigsSettingsView && settingsSection === "agent-configs" && <AgentConfigsSettingsView />}
                          {PluginsSettingsView && settingsSection === "plugins" && <PluginsSettingsView target={pluginTarget} onOpenPlugin={setPluginTarget} />}
                          {settingsSection === "personalization" && <PersonalizationSettingsView />}
                          {settingsSection === "browser" && <BrowserSettingsView />}
                          {settingsSection === "tools" && <ToolsSettingsView />}
                          {settingsSection === "usage" && <UsageSettingsView focusAgent={usageAgent} />}
                          {settingsSection === "dock" && <DockSettingsView />}
                          {settingsSection === "archive" && <ArchiveSettingsView />}
                        </Suspense>
                      </SidebarInset>
                    </SidebarProvider>
                  </TooltipProvider>
                </MessageRendererProvider>
              </ArchiveProvider>
            </BasesProvider>
          </ChatsProvider>
        </ProjectsProvider>
      </HistoryProvider>
    </AppsProvider>
    </SettingsNavigationContext.Provider>
  );
}

// Both window roles share feedback hosts and the effective theme supplied by main.
function AppToaster() {
  const theme = useSyncExternalStore(
    resolvedThemeStore.subscribe,
    resolvedThemeStore.getSnapshot
  );
  return (
    <>
      <Toaster theme={theme} position="bottom-right" />
      <FeedbackToaster theme={theme} />
    </>
  );
}

function SurfaceRuntimeEvents() {
  const { t } = useAppTranslation();
  useGlobalShortcuts(windowContext().role === "main" && isApplePlatform() ? { taskPanel: () => {
    const settings = settingsStore.getSnapshot().settings;
    if (settings?.showTaskStatusAtTop && !resolvePanelBinding(settings.keyboardShortcuts).conflict) {
      void presenceStore.togglePanel().catch(() => toast.error(t("settings.presence.panelUnavailable")));
    }
  } } : {});
  useEffect(() => {
    const hydrate = () => panelSlotStore.reloadFromStorage();
    const draftLost = () =>
      toast.error(t("windowSurface.draftLost"), {
        description: t("windowSurface.draftLostDescription"),
      });
    window.addEventListener("bottega:surface-hydrated", hydrate);
    window.addEventListener("bottega:surface-draft-lost", draftLost);
    return () => {
      window.removeEventListener("bottega:surface-hydrated", hydrate);
      window.removeEventListener("bottega:surface-draft-lost", draftLost);
    };
  }, [t]);
  return null;
}

function WindowProductRoot() {
  const { t } = useAppTranslation();
  const context = windowContext();
  if (context.role === "main") {
    return <SetupProvider><ProductApp /></SetupProvider>;
  }
  return context.appId ? (
    <AppWindowShell appId={context.appId} />
  ) : (
    <div role="alert" className="grid h-svh place-items-center bg-background text-destructive">
      {t("windowSurface.missingIdentity")}
    </div>
  );
}

function App() {
  const context = windowContext();
  return (
    <AppI18nProvider
      initialLanguage={initialLanguage}
      syncSettings={context.role === "main"}
    >
      <AppToaster />
      <HashRouter>
        <WindowProductRoot />
      </HashRouter>
      <SurfaceRuntimeEvents />
    </AppI18nProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 挂载节点");
const initialLanguage = initialAppLanguage();
document.documentElement.lang = initialLanguage;
setEffectiveLocale(initialLanguage);
/* Apply main's resolved theme before rendering to avoid a mismatched first frame. */
initializeTheme();
installWindowSurfaceRuntime();
installDurableDrafts();
/* Load the active catalog before the first render to avoid an English flash.
   An async IIFE keeps the entry synchronous so Rollup can merge shared chunks. */
void (async () => {
  await loadCatalog(initialLanguage);
  markStartup("catalog-loaded");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
})();
