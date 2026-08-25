/**
 * [INPUT]: Depends on React DOM/lazy/Suspense, router, global style, business/I18n/History Providers, history only read routes, MessageRendererProvider/chart, fenced directory, brand, product graphics, settingsStore, sidebar-layout synchronous durable files, lib/platform platform judgments, theme sensors, sonner Toaster and inert onboarding/unified Skills setup views
 * [OUTPUT]: The first is the React SPAFirst, synchronize the valid language, take on the brand Loading, start the detection, register the message renderer, upload the HistoryProvider with /history/: opaqueId, save only one option for the Surface route (Shortcuts overlay included), explicitly send the Chat surface visibility, hand the sidebar Cmd/Ctrl+B to the central dispatcher (SidebarProvider keyboardShortcut={false}) and submit the Sidebar layout uniquely
 * [POS]: The renderer's root input and the border of the first pack; Unified Provider sorting, triggering, pre-drawing fonts/themes before first rendering, deployment without a drop-down, routing, preheating and page-level fallback
 */

import {
  lazy,
  startTransition,
  StrictMode,
  Suspense,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { panelChromeClassName } from "@/components/page-shell";
import { AppearanceProvider } from "@/components/providers/appearance-provider";
import { AppI18nProvider, useAppTranslation } from "@/components/providers/i18n-provider";
import { AppsProvider } from "@/components/providers/apps-provider";
import { ChatsProvider } from "@/components/providers/chats-provider";
import { BasesProvider } from "@/components/providers/bases-provider";
import { ArchiveProvider } from "@/components/providers/archive-provider";
import { ProjectsProvider } from "@/components/providers/projects-provider";
import { HistoryProvider } from "@/components/providers/history/history-provider";
import {
  SetupProvider,
  useSetup,
} from "@/components/providers/setup-provider";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@ai-chat/ui/components/ui/sidebar";
import { Toaster } from "@ai-chat/ui/components/ui/sonner";
import { TooltipProvider } from "@ai-chat/ui/components/ui/tooltip";
import { ChatRoute } from "@/views/chat";
import { initializeAppearance } from "@/lib/appearance";
import { isApplePlatform } from "@/lib/platform";
import {
  PRODUCT_MARK_SIZE,
  PRODUCT_MARK_URL,
  PRODUCT_NAME,
} from "@/lib/brand";
import { initialAppLanguage } from "@/lib/settings-client";
import { setEffectiveLocale } from "@/lib/i18n-locale";
import { loadCatalog } from "../shared/i18n/catalogs";
import { initializeTheme, resolvedThemeStore } from "@/lib/theme";
import {
  activeSettingsSection,
  settingsExitTarget,
  settingsRouteSection,
  MEMORY_SETTINGS_PATH,
  type SettingsOverlaySection,
} from "@/lib/settings-navigation";
import { settingsStore } from "@/lib/settings-store";
import {
  commitSidebarLayout,
  readSidebarLayout,
  type SidebarGroups,
  type SidebarView,
} from "@/lib/sidebar-layout";
import { cn } from "@ai-chat/ui/lib/utils";
import { MessageRendererProvider } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { CHAT_FENCE_RENDERERS } from "@/components/charts/chart-fence-renderers";
import "@ai-chat/ui/globals.css";
import "@/appearance.css";
// 组件级 css 统一在入口引入：node --test 的 tsx loader 无 css 处理，组件内 import 会炸 DOM 测试
import "@/components/sidebar/sidebar-row.css";

const AppDetailView = lazy(() =>
  import("@/views/app-detail").then((module) => ({
    default: module.AppDetailView,
  }))
);
const OnboardingView = lazy(() =>
  import("@/views/onboarding").then((module) => ({
    default: module.OnboardingView,
  }))
);
const AppsListView = lazy(() =>
  import("@/views/apps-list").then((module) => ({
    default: module.AppsListView,
  }))
);
const BaseDetailView = lazy(() =>
  import("@/views/base-detail").then((module) => ({
    default: module.BaseDetailView,
  }))
);
const GeneralSettingsView = lazy(() =>
  import("@/views/settings-general").then((module) => ({
    default: module.GeneralSettingsView,
  }))
);
const ShortcutsSettingsView = lazy(() =>
  import("@/views/settings-shortcuts").then((module) => ({
    default: module.ShortcutsSettingsView,
  }))
);
const BackendsSettingsView = lazy(() =>
  import("@/views/settings-backends").then((module) => ({
    default: module.BackendsSettingsView,
  }))
);
const PersonalizationSettingsView = lazy(() =>
  import("@/views/settings-personalization").then((module) => ({
    default: module.PersonalizationSettingsView,
  }))
);
const MemorySettingsView = lazy(() =>
  import("@/views/settings-memory").then((module) => ({
    default: module.MemorySettingsView,
  }))
);
const BrowserSettingsView = lazy(() =>
  import("@/views/settings-browser").then((module) => ({
    default: module.BrowserSettingsView,
  }))
);
const ToolsSettingsView = lazy(() =>
  import("@/views/settings-tools").then((module) => ({
    default: module.ToolsPanel,
  }))
);
const SkillsSettingsView = lazy(() =>
  import("@/views/settings-skills").then((module) => ({
    default: module.SkillsSettingsView,
  }))
);
const ExtensionsSettingsView = lazy(() =>
  import("@/views/settings-extensions").then((module) => ({
    default: module.ExtensionsPanel,
  }))
);
const UsageSettingsView = lazy(() =>
  import("@/views/settings-usage").then((module) => ({
    default: module.UsageSettingsView,
  }))
);
const ArchiveSettingsView = lazy(() =>
  import("@/views/settings-archive").then((module) => ({
    default: module.ArchiveSettingsView,
  }))
);
const HistoryRoute = lazy(() =>
  import("@/views/history").then((module) => ({
    default: module.HistoryRoute,
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
          className="pointer-events-none size-20 select-none object-contain"
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
  const [settingsSection, setSettingsSection] =
    useState<SettingsOverlaySection | null>(null);
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
    leaveSettingsRoute();
    setSettingsSection(section);
    settingsStore.ensureLoaded();
  };

  /* 谁把你送进设置的不重要，出去只能有一个意思——覆盖层与路由两条
     进入路径共用这一个出口。 */
  const closeSettings = () => {
    setSettingsSection(null);
    leaveSettingsRoute();
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
    settingsStore.ensureLoaded();
    startTransition(() => {
      setSettingsSection(null);
      void navigate(MEMORY_SETTINGS_PATH, { replace: inSettingsRoute });
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
    <AppsProvider>
      <HistoryProvider>
        <ProjectsProvider>
          <ChatsProvider>
            <BasesProvider>
              <ArchiveProvider>
                <MessageRendererProvider value={CHAT_FENCE_RENDERERS}>
                  <TooltipProvider>
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
                      className="h-svh min-h-0 overflow-hidden bg-sidebar"
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
                      <SidebarInset className="relative h-[calc(100svh-0.5rem)] min-h-0 overflow-hidden border border-border/80 shadow-sm md:peer-data-[variant=inset]:m-1 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-1">
                        <Suspense fallback={<ViewLoading />}>
                          <div
                            aria-hidden={settingsSection ? true : undefined}
                            className={cn("h-full", settingsSection && "hidden")}
                          >
                            <Routes>
                              <Route path="/" element={<ChatRoute surfaceVisible={!settingsSection} />} />
                              <Route path="/chat/:id" element={<ChatRoute surfaceVisible={!settingsSection} />} />
                              <Route path="/history/:id" element={<HistoryRoute />} />
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
                                element={<MemorySettingsView />}
                              />
                              <Route
                                path="/settings/tools"
                                element={<ToolsSettingsView />}
                              />
                              <Route
                                path="/settings/extensions"
                                element={<ExtensionsSettingsView />}
                              />
                            </Routes>
                          </div>
                          {settingsSection === "general" && <GeneralSettingsView />}
                          {settingsSection === "shortcuts" && <ShortcutsSettingsView />}
                          {settingsSection === "backends" && <BackendsSettingsView />}
                          {settingsSection === "personalization" && <PersonalizationSettingsView />}
                          {settingsSection === "browser" && <BrowserSettingsView />}
                          {settingsSection === "tools" && <ToolsSettingsView />}
                          {settingsSection === "skills" && <SkillsSettingsView />}
                          {settingsSection === "extensions" && <ExtensionsSettingsView />}
                          {settingsSection === "usage" && <UsageSettingsView />}
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
  );
}

/* 一次性操作失败走 toast，主进程推送的持久告警仍走侧栏横幅；
   theme 跟随 main 广播的有效主题，不走 sonner 的 system 档。 */
function AppToaster() {
  const theme = useSyncExternalStore(
    resolvedThemeStore.subscribe,
    resolvedThemeStore.getSnapshot
  );
  return <Toaster theme={theme} position="bottom-right" />;
}

function App() {
  return (
    <AppI18nProvider initialLanguage={initialLanguage}>
      <AppearanceProvider initialAppearance={initialAppearance}>
        <HashRouter>
          <SetupProvider>
            <ProductApp />
          </SetupProvider>
        </HashRouter>
        <AppToaster />
      </AppearanceProvider>
    </AppI18nProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("缺少 #root 挂载节点");
const initialAppearance = initializeAppearance();
const initialLanguage = initialAppLanguage();
document.documentElement.lang = initialLanguage;
setEffectiveLocale(initialLanguage);
/* 与字体同批、同在首次 render 之前：主题在此已由 main 的 themeSource
   决定，这里只是把结论写上 documentElement，没有一帧错色。 */
initializeTheme();
/* 与字体、主题同批：目录也是首帧的一部分。首包只背英文，活跃语言在第一次
   render 之前就位——多等的是一次本地 chunk 读取，换来的是没有一帧英文闪
   过，也没有 Suspense 把根节点撕开。
   刻意不用 top-level await：它会把入口 chunk 标记为 async，Rollup 于是不
   再把共享小块并回入口（异步块与同步块不可合并）。实测入口当场碎成 37 个
   modulepreload，raw 少了 4 万而 gzip 反涨 1 万余——碎块各压各的，压缩率
   的损失远大于删掉的字节。异步 IIFE 拿到同样的时序，却不动 chunk 形状。 */
void (async () => {
  await loadCatalog(initialLanguage);
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
})();
