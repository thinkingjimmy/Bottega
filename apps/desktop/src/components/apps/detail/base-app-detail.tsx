"use client";

/**
 * [INPUT]: Main-owned App and GUI grants, BaseWorkbench, AppGuiSurface, shared panel sizing, file-export IPC, editor and Use Chat controls, and window checkpoints
 * [OUTPUT]: Provides BaseAppDetail with Studio consent and recovery, title-level refresh and More actions, a stable GUI beside one Data, Settings or Use Chat panel, generation-bound file export, and App-window handoff
 * [POS]: Resident Base App Studio for native and delegated plugin routes
 */

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { usePanelLayout, type PanelWidths } from "@ai-chat/chat-ui/side-panel/layout";
import {
  EllipsisIcon,
  InfoIcon,
  MessageSquareIcon,
  PanelsTopLeftIcon,
  PencilLineIcon,
  RefreshCwIcon,
  Settings2Icon,
  Share2Icon,
  Table2Icon,
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
import type {
  AppAttachmentSurface,
  AppRecordProjection,
  BaseGuiHostAction,
} from "../../../../shared/ipc/apps/apps-ipc";
import {
  StudioConsentPermissions,
  studioConsentRequest,
  useStudioConsent,
} from "../authorization/app-consent-disclosure";
import { AppUsePanel } from "../use/app-use-panel";
import { APP_SIDE_PANEL_DEFAULT_WIDTH, AppSidePanel } from "../app-side-panel";
import { useAppUseChat } from "../use/use-app-use-chat";
import { ReadmeDialog, useAppReadme } from "./app-readme-adornment";
import { AppShareDialog } from "../dialogs/app-share-dialog";
import { useAppBase } from "../surface/use-app-base";
import { useAppGui } from "../surface/use-app-gui";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { AppSettingsPanel } from "../settings/app-settings-panel";
import { AppGuiSurface } from "../surface/app-gui-surface";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import {
  appStudioSurface,
  canonicalAppSurfaceRoute,
} from "../../../../shared/ipc/settings/window-surfaces-ipc";
import {
  acquireAppSurface,
  authorizeAppStudioAccess,
  beginAppFileExport,
  cancelAppFileExport,
  finalizeAppFileExport,
  releaseAppSurface,
  writeAppFileExport,
} from "@/lib/apps/apps-client";
import { appendComposerText } from "@/lib/chat/state/composer/chat-composer-store";
import { focusComposer } from "@/lib/gallery/focus-controller";
import {
  checkpointSurface,
  readSurfaceCheckpoint,
  openSurfaceInWindow,
  syncUseChatResidence,
  useHoldsSurface,
  windowContext,
} from "@/lib/platform/window-surfaces-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { surfaceErrorMessage } from "@/lib/chat-composer/errors";
import { declaresBaseGui } from "../app-state";
import { useAppEditor } from "../use-app-editor";
import { AppWorkbench } from "./app-workbench";
import { useAppSkillFeedback } from "./use-app-skill-feedback";
const AppUseDock = lazy(() => import("../use/app-use-dock").then(module => ({ default: module.AppUseDock })));
type RightSurface = "none" | "data" | "settings" | "use";
type MainSurface = "app" | "data";
const STUDIO_PANEL_WIDTHS: PanelWidths = {
  read: () => APP_SIDE_PANEL_DEFAULT_WIDTH,
  write: (width) => width,
};
/* 弹窗式入口住进了 ⋯ 菜单，而菜单一关就把整棵子树卸掉——触发器若自持
   open，弹窗与它共命，永远开不起来。故开关上提到这一层。 */
type Overlay = "none" | "readme" | "share" | "workbench";

export function BaseAppDetail({ record, hosted = false }: { record: AppRecordProjection; hosted?: boolean }) {
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
    : <AuthorizedBaseAppDetail record={record} hosted={hosted} />;
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

function AuthorizedBaseAppDetail({ record, hosted }: { record: AppRecordProjection; hosted: boolean }) {
  const { t } = useAppTranslation();
  const skillFeedback = useAppSkillFeedback(record);
  const { loading, ownerKey, error } = useAppBase(record);
  const navigate = useNavigate();
  const openEditor = useAppEditor(record.id);
  const { surface: routeSurface } = useParams<{ surface?: string }>();
  const location = useLocation();
  const studioNeedsChat = declaresBaseGui(record);
  const dataEntry = !hosted && routeSurface === "data" ? location.key : null;
  const routedViewId = location.state?.requestedViewId;
  const residenceSurface = appStudioSurface(record.id);
  /* Only the window holding the Studio owns its Use chat. A window the Studio is moving away from (main, after "Open in window", from
     the export on) must not sync, or main refuses it as nonresident; the move carries the Use chat along as a companion, and a restored
     move gives the Studio back, so the page syncs again. */
  const holdsStudio = useHoldsSurface(residenceSurface);
  const [checkpoint] = useState(() => readSurfaceCheckpoint(residenceSurface).route);
  const [handledDataEntry, setHandledDataEntry] = useState(dataEntry);
  const [rightSurface, setRightSurface] = useState<RightSurface>(() => {
    if (dataEntry && studioNeedsChat) return "data";
    const saved = checkpoint.rightSurface;
    return saved === "data" || saved === "settings" || saved === "use" ? saved : "none";
  });
  const [useDocked, setUseDocked] = useState(() => rightSurface === "none" && Boolean(checkpoint.useDocked));
  const [overlay, setOverlay] = useState<Overlay>("none");
  const readme = useAppReadme(record.id);
  const [requestedView, setRequestedView] = useState<
    { viewId: string; nonce: number } | undefined
  >(() =>
    typeof routedViewId === "string" && routedViewId
      ? { viewId: routedViewId, nonce: 0 }
      : undefined
  );
  // A link from a Chat's App tab can request Data and a view on an already mounted Studio.
  if (dataEntry !== handledDataEntry) {
    setHandledDataEntry(dataEntry);
    if (dataEntry) {
      if (studioNeedsChat) {
        setRightSurface("data");
        setUseDocked(false);
      }
      setRequestedView(
        typeof routedViewId === "string" && routedViewId
          ? { viewId: routedViewId, nonce: (requestedView?.nonce ?? 0) + 1 }
          : undefined
      );
    }
  }
  const { containerRef, geometry, widthChange } = usePanelLayout(STUDIO_PANEL_WIDTHS);
  const panelLayout = { ...geometry, onWidthChange: widthChange };
  const dataButton = useRef<HTMLButtonElement>(null);
  const dataPanelId = `app-data-${record.id}`;
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
  const showGui = studioNeedsChat || hasGui;
  const mainSurface: MainSurface = showGui ? "app" : "data";
  const dataOpen = showGui && rightSurface === "data";
  const waitingForStudioSurface = studioNeedsChat &&
    (!surfaceIdentity || !appSurface) &&
    !appSurfaceError;
  // Keep the active frame mounted while a refresh prepares its replacement.
  const waitingForGui = waitingForStudioSurface || (gui.loading && !hasGui && !gui.error);
  const standalone = windowContext().role === "app-window";
  const selectRightSurface = (next: RightSurface) => {
    setUseDocked(false);
    setRightSurface(next);
  };
  const closeData = () => {
    setRightSurface("none");
    dataButton.current?.focus();
  };
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
    selectRightSurface("data");
    return true;
  };

  useEffect(() => {
    if (hosted || loading || !ownerKey || routeSurface === "data" || routeSurface === mainSurface) return;
    navigate(canonicalAppSurfaceRoute(record.id, mainSurface), { replace: true });
  }, [hosted, loading, mainSurface, navigate, ownerKey, record.id, routeSurface]);

  useEffect(() => {
    checkpointSurface(residenceSurface, {
      pathname: canonicalAppSurfaceRoute(record.id, mainSurface),
      mainSurface,
      rightSurface,
      useDocked,
      useChatId: useChat.chatId,
    });
  }, [mainSurface, record.id, residenceSurface, rightSurface, useChat.chatId, useDocked]);

  useEffect(() => {
    if (!holdsStudio) return;
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
  }, [holdsStudio, record.id, useChat.chatId, useChat.incarnationId]);

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

  const renderSurface = (value: MainSurface, compact = false) => {
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
    const checkingGui = value === "app" && waitingForGui;
    if (loading || !ownerKey || checkingGui) {
      return (
        <div className="grid size-full place-items-center text-muted-foreground text-sm">
          {checkingGui ? t("apps.guiChecking") : t("apps.baseOpening")}
        </div>
      );
    }
    return value === "app" ? (
      <AppGuiSurface
        // A settled failure must discard retained frames before recovery is shown.
        key={gui.error ? "failed" : "active"}
        chromeless
        gui={gui}
        baseOwnerKey={ownerKey}
        onHostAction={handleHostAction}
        onGoToData={() => selectRightSurface("data")}
      />
    ) : (
      <BaseWorkbench compact={compact} ownerKey={ownerKey} requestedViewId={requestedView} />
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
        description: surfaceErrorMessage(cause, t("windowSurface.openInWindowFailed")),
      });
    }
  };

  const dataLabel = t("bases.gui.dataTab");
  const actions = (
    <div className="flex items-center gap-1">
      {showGui && (
        <Button
          aria-controls={dataPanelId}
          aria-label={dataLabel}
          aria-pressed={dataOpen}
          className={panelChromeClassName}
          onClick={() => selectRightSurface(dataOpen ? "none" : "data")}
          ref={dataButton}
          size="icon-lg"
          title={dataLabel}
          type="button"
          variant={dataOpen ? "secondary" : "ghost"}
        >
          <Table2Icon />
        </Button>
      )}
      <Button
        aria-label={t("apps.baseDetail.settings")}
        aria-pressed={settingsOpen}
        className={panelChromeClassName}
        onClick={() => selectRightSurface(settingsOpen ? "none" : "settings")}
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
        onClick={() => selectRightSurface(rightSurface === "use" ? "none" : "use")}
        size="icon-lg"
        variant={rightSurface === "use" ? "secondary" : "ghost"}
      >
        <MessageSquareIcon />
      </Button>
    </div>
  );
  const titleActions = (
    <span className="flex items-center gap-1 opacity-0 transition-opacity motion-reduce:transition-none [header:hover_&]:opacity-100 has-[:focus-visible]:opacity-100 has-[[data-state=open]]:opacity-100 no-hover:opacity-100">
      {showGui && !waitingForGui && !appSurfaceError && (
        <Button
          aria-label={t("bases.gui.refresh")}
          className={panelChromeClassName}
          disabled={gui.loading}
          onClick={gui.refresh}
          size="icon-lg"
          title={t("bases.gui.refresh")}
          type="button"
          variant="ghost"
        >
          <RefreshCwIcon />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("apps.baseDetail.more")}
            className={panelChromeClassName}
            size="icon-lg"
            title={t("apps.baseDetail.more")}
            variant="ghost"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {skillFeedback.failed && (
            <>
              <DropdownMenuItem
                disabled={skillFeedback.retrying}
                onSelect={() => void skillFeedback.retry()}
              >
                <RefreshCwIcon />
                {t("apps.baseDetail.retrySkill")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOverlay("share")}>
            <Share2Icon />
            {t("apps.share.title")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );

  return (
    <div className="flex h-full min-w-0 [--page-shell-header-height:2.5rem]" ref={containerRef}>
      <main className="min-w-0 flex-1">
        <PageShell
          actions={actions}
          backHref={standalone ? undefined : "/apps"}
          title={
            <span className="[-webkit-app-region:no-drag]">
              {record.manifest?.icon ?? "📦"} {record.displayName}
            </span>
          }
          titleAdornment={titleActions}
        >
          <div className="relative flex size-full min-w-0 flex-col">
            {renderSurface(mainSurface)}
            {useDocked && useChat.chatId && (
              <Suspense fallback={null}>
                <AppUseDock key={useChat.chatId} appId={record.id} chatId={useChat.chatId} />
              </Suspense>
            )}
          </div>
        </PageShell>
      </main>
      {showGui && (
        <AppSidePanel
          closeLabel={t("chat.sidePanel.closePanel")}
          header={<h2 className="min-w-0 flex-1 truncate px-2 font-medium text-sm">{dataLabel}</h2>}
          id={dataPanelId}
          inlineLayout={panelLayout}
          onClose={closeData}
          open={dataOpen}
          railLabel={t("chat.sidePanel.shell.resize")}
          railHint={t("chat.sidePanel.shell.resizeHint")}
        >
          {dataOpen && renderSurface("data", true)}
        </AppSidePanel>
      )}
      <AppSettingsPanel
        inlineLayout={panelLayout}
        onClose={() => setRightSurface("none")}
        open={settingsOpen}
        record={record}
      />
      <AppUsePanel
        chat={useChat}
        inlineLayout={panelLayout}
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
    </div>
  );
}
