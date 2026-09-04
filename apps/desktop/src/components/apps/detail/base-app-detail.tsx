"use client";

/**
 * [INPUT]: Depends on Base App lifecycle/generation, the main-owned AppRecordProjection, declaresBaseGui, BaseWorkbench/AppGuiSurface, trusted file-export IPC, the shared useAppEditor command, use-chat, routing, and window surface capsule checkpoints
 * [OUTPUT]: Provides BaseAppDetail with a main-derived studioSurfaceReady gate that discloses every requested capability and offers allow/decline, a re-authorize exit from surface failures, uniformly styled tri-zone header actions, explicit App-window handoff, generation-bound native file export, Use panel/dock, Editor navigation, settings, and normal-close checkpoints
 * [POS]: Resident Base App Studio; the App-window shell removes global chrome while this component keeps the same main and third-panel product structure
 */

import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  EllipsisIcon,
  InfoIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  PencilLineIcon,
  Settings2Icon,
  Share2Icon,
  TestTube2Icon,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { PageShell, panelChromeClassName } from "@/components/page-shell";
import { useApps } from "@/components/providers/apps-provider";
import type {
  AppAttachmentSurface,
  AppRecordProjection,
  BaseGuiHostAction,
} from "../../../../shared/apps-ipc";
import {
  StudioConsentPermissions,
  studioConsentRequest,
  useStudioConsent,
} from "../authorization/app-consent-disclosure";
import { AppUsePanel } from "../use/app-use-panel";
import { useAppUseChat } from "../use/use-app-use-chat";
import { ReadmeDialog, useAppReadme } from "./app-readme-adornment";
import { AppShareDialog } from "../dialogs/app-share-dialog";
import { useAppBase } from "../surface/use-app-base";
import { useAppGui } from "../surface/use-app-gui";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { AppSettingsPanel } from "../settings/app-settings-panel";
import { AppGuiSurface } from "../surface/app-gui-surface";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  appStudioSurface,
  canonicalAppSurfaceRoute,
} from "../../../../shared/window-surfaces-ipc";
import {
  acquireAppSurface,
  authorizeAppStudioAccess,
  beginAppFileExport,
  cancelAppFileExport,
  finalizeAppFileExport,
  releaseAppSurface,
  setDesignEnabled,
  writeAppFileExport,
} from "@/lib/apps-client";
import { appendComposerText } from "@/lib/chat-composer-store";
import { focusComposer } from "@/lib/gallery/focus-controller";
import {
  checkpointSurface,
  readSurfaceCheckpoint,
  openSurfaceInWindow,
  syncUseChatResidence,
  windowContext,
} from "@/lib/window-surfaces-client";
import {
  DesignCanvasMenuItems,
  DesignHistoryDialog,
} from "../design/design-history-dialog";
import { errorMessage } from "@/lib/errors";
import { declaresBaseGui } from "../app-state";
import { useAppEditor } from "../use-app-editor";
import { AppWorkbench } from "./app-workbench";

const AppUseDock = lazy(() =>
  import("../use/app-use-dock").then((module) => ({ default: module.AppUseDock }))
);

type RightSurface = "none" | "settings" | "use";
type MainSurface = "app" | "data";
/* 弹窗式入口住进了 ⋯ 菜单，而菜单一关就把整棵子树卸掉——触发器若自持
   open，弹窗与它共命，永远开不起来。故开关上提到这一层。 */
type Overlay = "none" | "readme" | "share" | "history" | "workbench";

export function BaseAppDetail({ record }: { record: AppRecordProjection }) {
  const needsStudio = declaresBaseGui(record);
  /* 判据只有一份，而且在 main 手里：studioSurfaceReady 与 surface 的放行
     读同一组八项事实。renderer 从前自己比 generationId + contentDigest 两
     项，兼容重绑后这里说「已授权」而 surface 403——两个真相源迟早各说各话。

     `state === "ready"` 不是第二个授权判据，它决定的是「此刻该不该问」：
     换代、删除、隔离期间 studioSurfaceReady 同样为 false，但原因是生命周期
     而不是授权。此时端出一张同意书，问的就不是它回答的那个问题——正文交回
     详情体，由它照实说 App 正在忙。 */
  const askForConsent =
    needsStudio && record.state === "ready" && record.studioSurfaceReady !== true;
  return askForConsent
    ? <StudioAccessGate record={record} />
    : <AuthorizedBaseAppDetail record={record} />;
}

function StudioAccessGate({ record }: { record: AppRecordProjection }) {
  const { t } = useAppTranslation();
  const consent = useStudioConsent(record.id);
  return (
    <PageShell title={`${record.manifest?.icon ?? "📦"} ${record.displayName}`} backHref="/apps">
      <div className="grid size-full place-items-center p-6">
        <section className="w-full max-w-md rounded-xl border bg-card p-5 text-sm">
          {consent.declined ? (
            <>
              <h2 className="font-medium text-base" role="status">
                {t("apps.baseGuiConsent.declinedTitle")}
              </h2>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                {t("apps.baseGuiConsent.declinedDescription")}
              </p>
              <div className="mt-4 flex justify-end">
                <Button onClick={consent.reset} variant="outline">
                  {t("apps.reauthorize")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="font-medium text-base">
                {t("apps.baseGuiConsent.allowOpenTitle", { name: record.displayName })}
              </h2>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                {t("apps.installAuthorizationDescription")}
              </p>
              <StudioConsentPermissions request={studioConsentRequest(record)} />
              {consent.error && (
                <p className="mt-3 text-destructive text-xs" role="alert">
                  {consent.error}
                </p>
              )}
              <p className="mt-3 text-muted-foreground text-xs">
                {t("apps.baseGuiConsent.declineHint")}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  disabled={consent.busy}
                  onClick={consent.decline}
                  variant="ghost"
                >
                  {t("apps.baseGuiConsent.decline")}
                </Button>
                <Button disabled={consent.busy} onClick={consent.allow}>
                  {consent.busy
                    ? t("apps.authorizing")
                    : t("apps.baseGuiConsent.allowAndOpen")}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}

function AuthorizedBaseAppDetail({ record }: { record: AppRecordProjection }) {
  const { t } = useAppTranslation();
  const { retrySkill } = useApps();
  const { loading, ownerKey, error } = useAppBase(record);
  const navigate = useNavigate();
  const openEditor = useAppEditor(record.id);
  const { surface } = useParams<{ surface?: string }>();
  /* Chat tab 里的 GUI 没有数据页可切，只能把 open-data-view 转成一次跳转。
     viewId 随 location.state 过来，落在同一个 requestedView 上——两条入口
     一个消费点，不再有「跳过来了但视图没选中」这种半成品。 */
  const routedViewId = useLocation().state?.requestedViewId;
  const residenceSurface = appStudioSurface(record.id);
  const checkpoint = readSurfaceCheckpoint(residenceSurface).route;
  const initialRightSurface = checkpoint.rightSurface;
  const [rightSurface, setRightSurface] = useState<RightSurface>(
    initialRightSurface === "settings" ||
      initialRightSurface === "use"
      ? initialRightSurface
      : "none"
  );
  const [useDocked, setUseDocked] = useState(Boolean(checkpoint.useDocked));
  const [overlay, setOverlay] = useState<Overlay>("none");
  const readme = useAppReadme(record.id);
  const [requestedView, setRequestedView] = useState<
    { viewId: string; nonce: number } | undefined
  >(() =>
    typeof routedViewId === "string" && routedViewId
      ? { viewId: routedViewId, nonce: 0 }
      : undefined
  );
  const studioNeedsChat = declaresBaseGui(record);
  const useChat = useAppUseChat(
    record,
    studioNeedsChat || rightSurface === "use" || useDocked
  );
  const [residentUseChat, setResidentUseChat] = useState<
    Readonly<{ chatId: string; incarnationId: string }> | undefined
  >();
  const surfaceIdentity = ownerKey && residentUseChat &&
    residentUseChat.chatId === useChat.chatId &&
    residentUseChat.incarnationId === useChat.incarnationId
    ? `${ownerKey}:${residentUseChat.chatId}:${residentUseChat.incarnationId}`
    : "";
  const [surfaceState, setSurfaceState] = useState<{
    identity: string;
    surface: AppAttachmentSurface;
  }>();
  const [surfaceFailure, setSurfaceFailure] = useState({ identity: "", error: "" });
  const [reauthorizing, setReauthorizing] = useState(false);
  const appSurface = surfaceState?.identity === surfaceIdentity
    ? surfaceState.surface
    : null;
  const appSurfaceError = surfaceFailure.identity === surfaceIdentity
    ? surfaceFailure.error
    : "";
  const gui = useAppGui({
    appId: record.id,
    appSurfaceLeaseId: appSurface?.surfaceLeaseId,
    enabled: Boolean(ownerKey && appSurface),
    revisionKey: JSON.stringify([
      record.lifecycleRevision,
      record.generationBinding.active?.generationId ?? null,
      useChat.chatId || null,
      useChat.incarnationId || null,
    ]),
  });
  const syncedUseChat = useRef<
    Readonly<{ chatId: string; incarnationId: string }> | undefined
  >(undefined);
  const settingsOpen = rightSurface === "settings";
  const hasGui = gui.pages.includes("index.html");
  const hasAppSurface = hasGui || (surface === "app" && Boolean(gui.error));
  const showSurfaceTabs = !gui.loading && hasAppSurface;
  const mainSurface: MainSurface =
    surface === "data" ? "data" : surface === "app" ? "app" : hasGui ? "app" : "data";
  const waitingForStudioSurface = studioNeedsChat &&
    (!surfaceIdentity || !appSurface) &&
    !appSurfaceError;
  const waitingForGui = (gui.loading || waitingForStudioSurface) &&
    !hasAppSurface &&
    surface !== "data";
  const standalone = windowContext().role === "app-window";
  const selectMainSurface = (next: MainSurface) =>
    navigate(`/apps/${record.id}/${next}`, { replace: true });
  const handleHostAction = async (
    action: BaseGuiHostAction,
    context: Readonly<{ trustedGestureAt: number | null }>
  ) => {
    const exportSurface = {
      appId: record.id,
      surfaceId: gui.surfaceId,
      appSurfaceLeaseId: appSurface?.surfaceLeaseId ?? "",
    };
    if (action.type === "file.export.begin") {
      if (context.trustedGestureAt === null) return false;
      return beginAppFileExport({
        surface: exportSurface,
        request: action.request,
        trustedGestureAt: context.trustedGestureAt,
      });
    }
    if (action.type === "file.export.chunk") {
      return writeAppFileExport({ surface: exportSurface, header: action.header, bytes: action.bytes });
    }
    if (action.type === "file.export.finalize") {
      return finalizeAppFileExport({ surface: exportSurface, exportId: action.exportId });
    }
    if (action.type === "file.export.cancel") {
      return cancelAppFileExport({ surface: exportSurface, exportId: action.exportId });
    }
    if (action.type === "compose-text") {
      if (!useChat.chatId) return false;
      const accepted = appendComposerText(useChat.chatId, action.text);
      if (accepted) focusComposer(useChat.chatId);
      return accepted;
    }
    if (action.type === "open-data-view") {
      setRequestedView((current) => ({
        viewId: action.viewId,
        nonce: (current?.nonce ?? 0) + 1,
      }));
    }
    selectMainSurface("data");
    return true;
  };

  useEffect(() => {
    if (loading || !ownerKey || gui.loading || waitingForStudioSurface) return;
    const target = surface === "app" && !hasGui && !gui.error
      ? "data"
      : surface === "app" || surface === "data"
        ? null
        : hasGui ? "app" : "data";
    if (!target) return;
    navigate(`/apps/${record.id}/${target}`, {
      replace: true,
    });
  }, [gui.error, gui.loading, hasGui, loading, navigate, ownerKey, record.id, surface, waitingForStudioSurface]);

  useEffect(() => {
    checkpointSurface(residenceSurface, {
      pathname: `/apps/${record.id}/${mainSurface}`,
      mainSurface,
      rightSurface,
      useDocked,
      useChatId: useChat.chatId,
    });
  }, [mainSurface, record.id, residenceSurface, rightSurface, useChat.chatId, useDocked]);

  useEffect(() => {
    const next = useChat.chatId && useChat.incarnationId
      ? { chatId: useChat.chatId, incarnationId: useChat.incarnationId }
      : undefined;
    const previous = syncedUseChat.current;
    if (
      previous?.chatId === next?.chatId &&
      previous?.incarnationId === next?.incarnationId
    ) return;
    let alive = true;
    void syncUseChatResidence(record.id, previous, next)
      .then(() => {
        if (!alive) return;
        syncedUseChat.current = next;
        setResidentUseChat(next);
      })
      .catch(() => {
        if (alive) setResidentUseChat(undefined);
      });
    return () => {
      alive = false;
    };
  }, [record.id, useChat.chatId, useChat.incarnationId]);

  useEffect(() => {
    if (!surfaceIdentity || !residentUseChat) return;
    let active = true;
    let leaseId = "";
    void acquireAppSurface({
      appId: record.id,
      mode: "studio",
      conversationId: residentUseChat.chatId,
      conversationIncarnationId: residentUseChat.incarnationId,
    })
      .then((next) => {
        leaseId = next.surfaceLeaseId;
        if (active) setSurfaceState({ identity: surfaceIdentity, surface: next });
        else return releaseAppSurface(leaseId);
      })
      .catch((cause) => {
        if (active) {
          setSurfaceFailure({
            identity: surfaceIdentity,
            error: errorMessage(cause, t("apps.baseDetail.surfaceFailed")),
          });
        }
      });
    return () => {
      active = false;
      if (leaseId) void releaseAppSurface(leaseId);
    };
  }, [record.id, residentUseChat, surfaceIdentity, t]);

  const tabId = (value: MainSurface) => `${record.id}-${value}-tab`;
  const selectAdjacentTab = (event: KeyboardEvent, value: MainSurface) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = value === "app" ? "data" : "app";
    selectMainSurface(next);
    document.getElementById(tabId(next))?.focus();
  };
  const renderMainSurface = (value: MainSurface) => {
    if (error) {
      return (
        <div className="grid size-full place-items-center p-8 text-destructive text-sm">
          {error}
        </div>
      );
    }
    if (value === "app" && appSurfaceError) {
      /* 面取不到最常见的原因就是授权过期（兼容重绑换掉了 decision revision）。
         从前这里只印一句红字，是一条没有出口的死巷；重新授权正是那个出口。 */
      return (
        <div className="grid size-full place-items-center p-8 text-center text-sm">
          <div className="flex max-w-md flex-col items-center gap-3">
            <p className="text-destructive">{appSurfaceError}</p>
            <Button
              disabled={reauthorizing}
              onClick={() => {
                setReauthorizing(true);
                void authorizeAppStudioAccess(record.id)
                  .then(() => setSurfaceFailure({ identity: "", error: "" }))
                  .catch((cause) =>
                    toast.error(t("apps.reauthorize"), {
                      description: errorMessage(cause),
                    })
                  )
                  .finally(() => setReauthorizing(false));
              }}
              size="sm"
              variant="outline"
            >
              {reauthorizing ? t("apps.authorizing") : t("apps.reauthorize")}
            </Button>
          </div>
        </div>
      );
    }
    if (loading || !ownerKey || waitingForGui) {
      return (
        <div className="grid size-full place-items-center text-muted-foreground text-sm">
          {waitingForGui ? t("apps.guiChecking") : t("apps.baseOpening")}
        </div>
      );
    }
    return value === "app" ? (
      <AppGuiSurface
        gui={gui}
        baseOwnerKey={ownerKey}
        onHostAction={handleHostAction}
        onGoToData={() => selectMainSurface("data")}
        chromeless={record.presetId === "design-canvas"}
      />
    ) : (
      <BaseWorkbench ownerKey={ownerKey} requestedViewId={requestedView} />
    );
  };

  const openWindow = async () => {
    try {
      const result = await openSurfaceInWindow(
        residenceSurface,
        record.id,
        canonicalAppSurfaceRoute(record.id, mainSurface),
        undefined,
        useChat.chatId && useChat.incarnationId
          ? {
              chatId: useChat.chatId,
              incarnationId: useChat.incarnationId,
            }
          : undefined
      );
      if (!result) throw new Error(t("windowSurface.openInWindowUnavailable"));
      navigate("/apps", { replace: true });
    } catch (cause) {
      toast.error(t("windowSurface.openInWindowFailed"), {
        description: errorMessage(cause),
      });
    }
  };

  return (
    <PageShell
      /* 右侧只放第三栏那两颗互斥开关：跨页头面板盖住的正是它们自己，
         而面板自带的收起钮当场接任，没有任何操作因此失联。
         其余入口——编辑、独立窗口、关于、分享——全部收进标题旁的 ⋯，
         那一格永远不会被盖住。被盖住的按钮等于不存在的按钮。 */
      actions={
        <div className="flex items-center gap-1">
          <Button
            aria-label={t("apps.baseDetail.settings")}
            aria-pressed={settingsOpen}
            className={panelChromeClassName}
            onClick={() => {
              setUseDocked(false);
              setRightSurface(settingsOpen ? "none" : "settings");
            }}
            size="icon-lg"
            variant={settingsOpen ? "secondary" : "ghost"}
          >
            <Settings2Icon />
          </Button>
          <Button
            aria-label={t(
              rightSurface === "use"
                ? "apps.baseDetail.closeUseChat"
                : "apps.baseDetail.openUseChat"
            )}
            aria-pressed={rightSurface === "use"}
            className={panelChromeClassName}
            onClick={() => {
              setUseDocked(false);
              setRightSurface((current) => current === "use" ? "none" : "use");
            }}
            size="icon-lg"
            variant={rightSurface === "use" ? "secondary" : "ghost"}
          >
            <MessageSquareIcon />
          </Button>
        </div>
      }
      backHref={standalone ? undefined : "/apps"}
      /* 页签并进页头正中：它原先独占一条 40px 横带；现在与两侧 chrome 同为
         32px 高，但保留文本 tab 的选中语义，而不是冒充图标按钮。
         还顺手画出第二条分隔线——page-shell 的注释亲口禁止过那件事。
         上来这一格，横带与那条线一起消失，内容区白拿 40px。 */
      center={
        showSurfaceTabs ? (
          <div
            aria-label={t("bases.gui.surfaceTabsAria")}
            className="flex items-center gap-1"
            role="tablist"
          >
            {(["app", "data"] as const).map((value) => (
              <Button
                aria-controls={`${record.id}-${value}-panel`}
                aria-selected={mainSurface === value}
                className={panelChromeClassName}
                id={tabId(value)}
                key={value}
                onClick={() => selectMainSurface(value)}
                onKeyDown={(event) => selectAdjacentTab(event, value)}
                role="tab"
                size="lg"
                tabIndex={mainSurface === value ? 0 : -1}
                variant={mainSurface === value ? "secondary" : "ghost"}
              >
                {value === "app"
                  ? t("bases.gui.appTab")
                  : t("bases.gui.dataTab")}
              </Button>
            ))}
          </div>
        ) : undefined
      }
      title={`${record.manifest?.icon ?? "📦"} ${record.displayName}`}
      titleAdornment={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t("apps.baseDetail.more")}
              className={panelChromeClassName}
              size="icon-lg"
              variant="ghost"
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {record.editableSource === true && (
              <DropdownMenuItem onSelect={() => void openEditor()}>
                <PencilLineIcon />
                {t("apps.baseDetail.edit")}
              </DropdownMenuItem>
            )}
            {record.editableSource === true && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => setOverlay("workbench")}>
              <TestTube2Icon />
              {t("apps.baseDetail.workbench")}
            </DropdownMenuItem>
            {!standalone && (
              <DropdownMenuItem onSelect={() => void openWindow()}>
                <PanelsTopLeftIcon />
                {t("windowSurface.openInWindow")}
              </DropdownMenuItem>
            )}
            {readme !== "" && (
              <DropdownMenuItem onSelect={() => setOverlay("readme")}>
                <InfoIcon />
                {t("apps.readme.about")}
              </DropdownMenuItem>
            )}
            {record.presetId === "design-canvas" && appSurface && (
              <>
                <DropdownMenuSeparator />
                <DesignCanvasMenuItems
                  appId={record.id}
                  appSurfaceLeaseId={appSurface.surfaceLeaseId}
                  onImported={gui.refresh}
                  onOpenHistory={() => setOverlay("history")}
                />
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setOverlay("share")}>
              <Share2Icon />
              {t("apps.share.title")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="flex h-full min-w-0">
        <main className="relative flex min-w-0 flex-1 flex-col">
          {record.presetId === "design-canvas" && record.defaultGrant == null && (
            <div className="absolute top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 text-sm shadow-lg">
              <span>{t("apps.designHiddenHint")}</span>
              <Button
                onClick={() => void setDesignEnabled({ appId: record.id, enabled: true })}
                size="sm"
                variant="outline"
              >
                {t("apps.designReopen")}
              </Button>
            </div>
          )}
          {record.skillStatus?.state === "failed" && (
            <div className="absolute top-[calc(var(--page-shell-header-height)+1rem)] left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-500/30 bg-background/95 px-4 py-2 text-sm shadow-lg">
              <span>{t("apps.baseDetail.skillFailed")}</span>
              <Button
                onClick={() => void retrySkill(record.id)}
                size="sm"
                variant="outline"
              >
                {t("apps.baseDetail.retrySkill")}
              </Button>
            </div>
          )}
          {showSurfaceTabs ? (
            <>
              {(["app", "data"] as const).map((value) => {
                const active = mainSurface === value;
                return (
                  <div
                    aria-labelledby={tabId(value)}
                    className={active
                      ? "flex min-h-0 flex-1 flex-col"
                      : "hidden"}
                    hidden={!active}
                    id={`${record.id}-${value}-panel`}
                    key={value}
                    role="tabpanel"
                  >
                    {active ? renderMainSurface(value) : null}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {renderMainSurface(hasAppSurface ? mainSurface : "data")}
            </div>
          )}
          {/* dock 挂在 main 里，因为它要盖住的正是 main：定位锚点就是这层
              relative，与全屏 Base 把 dock 挂在自己的 relative 容器里同理。 */}
          {useDocked && useChat.chatId && (
            <Suspense fallback={null}>
              <AppUseDock
                key={useChat.chatId}
                appId={record.id}
                chatId={useChat.chatId}
                draftAgent={record.agent}
              />
            </Suspense>
          )}
        </main>
        {/* Settings and Use remain mutually exclusive resident side surfaces. */}
        <AppSettingsPanel
          onClose={() => setRightSurface("none")}
          open={settingsOpen}
          record={record}
        />
        <AppUsePanel
          chat={useChat}
          onClose={() => setRightSurface("none")}
          onDock={() => {
            setRightSurface("none");
            setUseDocked(true);
          }}
          open={rightSurface === "use"}
          record={record}
        />
        <ReadmeDialog
          appName={record.displayName}
          onOpenChange={(next) => setOverlay(next ? "readme" : "none")}
          open={overlay === "readme"}
          readme={readme}
        />
        <AppShareDialog
          onOpenChange={(next) => setOverlay(next ? "share" : "none")}
          open={overlay === "share"}
          record={record}
        />
        <AppWorkbench
          gui={gui}
          onOpenChange={(next) => setOverlay(next ? "workbench" : "none")}
          open={overlay === "workbench"}
          record={record}
        />
        {/* 只在开着的时候挂：这道弹窗一挂上就发两条 IPC 并订阅
            design-canvases-changed，而它一年里 364 天是关着的。开关既然
            已经由 overlay 持有，挂载条件就该照它写，而不是让组件自己
            在关闭态里空转一整套订阅。 */}
        {overlay === "history" && appSurface && (
          <DesignHistoryDialog
            appId={record.id}
            appSurfaceLeaseId={appSurface.surfaceLeaseId}
            onOpenChange={(next) => setOverlay(next ? "history" : "none")}
            onRestored={gui.refresh}
            open
          />
        )}
      </div>
    </PageShell>
  );
}
