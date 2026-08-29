"use client";

/**
 * [INPUT]: Depends on Base App lifecycle/generation, BaseWorkbench/AppGuiSurface, use-chat, routing, and window surface capsule checkpoints
 * [OUTPUT]: Provides BaseAppDetail with GUI/data tabs, use panel/dock, edit/settings surfaces, and normal-close checkpoint state
 * [POS]: Resident Base App Studio; the App-window shell removes global chrome while this component keeps the same main and third-panel product structure
 */

import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import {
  PanelRightIcon,
  PanelsTopLeftIcon,
  PencilLineIcon,
  Settings2Icon,
  SnowflakeIcon,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { PageShell, panelChromeClassName } from "@/components/page-shell";
import { useApps } from "@/components/providers/apps-provider";
import type {
  AppAttachmentSurface,
  AppRecord,
  BaseGuiHostAction,
} from "../../../shared/apps-ipc";
import { AppUsePanel } from "./app-use-panel";
import { useAppUseChat } from "./use-app-use-chat";
import { AppReadmeAdornment } from "./app-readme-adornment";
import { AppShareDialog } from "./app-share-dialog";
import { useAppBase } from "./use-app-base";
import { useAppGui } from "./use-app-gui";
import { Separator } from "@ai-chat/ui/components/ui/separator";
import { AppEditPanel } from "./app-edit-panel";
import { AppSettingsPanel } from "./app-settings-panel";
import { AppGuiSurface } from "./app-gui-surface";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { appStudioSurface } from "../../../shared/window-surfaces-ipc";
import {
  acquireAppSurface,
  releaseAppSurface,
  setDesignEnabled,
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
import { DesignHistoryControls } from "./design/design-history-controls";

const AppUseDock = lazy(() =>
  import("./app-use-dock").then((module) => ({ default: module.AppUseDock }))
);

type RightSurface = "none" | "settings" | "edit" | "use";
type MainSurface = "app" | "data";

export function BaseAppDetail({ record }: { record: AppRecord }) {
  const { t } = useAppTranslation();
  const { retrySkill } = useApps();
  const { loading, ownerKey, error } = useAppBase(record);
  const navigate = useNavigate();
  const { surface } = useParams<{ surface?: string }>();
  const residenceSurface = appStudioSurface(record.id);
  const checkpoint = readSurfaceCheckpoint(residenceSurface).route;
  const initialRightSurface = checkpoint.rightSurface;
  const [rightSurface, setRightSurface] = useState<RightSurface>(
    initialRightSurface === "settings" ||
      initialRightSurface === "edit" ||
      initialRightSurface === "use"
      ? initialRightSurface
      : "none"
  );
  const [useDocked, setUseDocked] = useState(Boolean(checkpoint.useDocked));
  const [requestedView, setRequestedView] = useState<{
    viewId: string;
    nonce: number;
  }>();
  const studioNeedsChat = Boolean(
    record.manifest?.kind === "base" && record.manifest.gui
  );
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
  const editOpen = rightSurface === "edit";
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
  const handleHostAction = (action: BaseGuiHostAction) => {
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
            error: cause instanceof Error ? cause.message : "App Studio surface 签发失败",
          });
        }
      });
    return () => {
      active = false;
      if (leaseId) void releaseAppSurface(leaseId);
    };
  }, [record.id, residentUseChat, surfaceIdentity]);

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
      return (
        <div className="grid size-full place-items-center p-8 text-destructive text-sm">
          {appSurfaceError}
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
        onHostAction={handleHostAction}
        onGoToData={() => selectMainSurface("data")}
        toolbar={record.presetId === "design-canvas" && appSurface ? (
          <DesignHistoryControls
            appId={record.id}
            appSurfaceLeaseId={appSurface.surfaceLeaseId}
            onRestored={gui.refresh}
          />
        ) : undefined}
      />
    ) : (
      <BaseWorkbench ownerKey={ownerKey} requestedViewId={requestedView} />
    );
  };

  return (
    <PageShell
      /* 右侧只留第三栏开合：使用栏跨页头，会把这一格连同它右边的一切盖住，
         面板自带的「收起使用栏」正好接任它。分享/设置/编辑必须常驻可达，
         故随标题落在左侧——被盖住的按钮等于不存在的按钮。 */
      actions={
        <Button
          aria-label={rightSurface === "use" ? "关闭使用 chat" : "打开使用 chat"}
          aria-pressed={rightSurface === "use"}
          className={panelChromeClassName}
          onClick={() => {
            setUseDocked(false);
            setRightSurface((current) => current === "use" ? "none" : "use");
          }}
          size="icon-lg"
          variant="ghost"
        >
          <PanelRightIcon />
        </Button>
      }
      backHref={standalone ? undefined : "/apps"}
      title={`${record.manifest?.icon ?? "📦"} ${record.displayName}`}
      titleAdornment={
        <div className="flex items-center gap-1">
          <AppReadmeAdornment
            appId={record.id}
            appName={record.displayName}
          />
          <AppShareDialog record={record} />
          {!standalone && (
            <Button
              aria-label={t("windowSurface.openInWindow")}
              onClick={() =>
                void openSurfaceInWindow(
                  residenceSurface,
                  record.id,
                  `/apps/${record.id}/${mainSurface}`,
                  undefined,
                  useChat.chatId && useChat.incarnationId
                    ? {
                        chatId: useChat.chatId,
                        incarnationId: useChat.incarnationId,
                      }
                    : undefined
                )
              }
              size="icon-sm"
              variant="ghost"
            >
              <PanelsTopLeftIcon />
            </Button>
          )}
          <Button
            aria-label="Base App 设置"
            aria-pressed={settingsOpen}
            onClick={() => {
              setUseDocked(false);
              setRightSurface(settingsOpen ? "none" : "settings");
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Settings2Icon />
          </Button>
          <Separator className="mx-1 h-5" orientation="vertical" />
          <Button
            aria-label="编辑 App"
            aria-pressed={editOpen}
            onClick={() => {
              setUseDocked(false);
              setRightSurface(editOpen ? "none" : "edit");
            }}
            size="sm"
            variant="outline"
          >
            <PencilLineIcon />
            编辑 App
          </Button>
        </div>
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
              <span>App skill 生成失败，使用 chat 暂无稳定录入协议。</span>
              <Button
                onClick={() => void retrySkill(record.id)}
                size="sm"
                variant="outline"
              >
                重试生成
              </Button>
            </div>
          )}
          {showSurfaceTabs && (
            <div
              aria-label={t("bases.gui.surfaceTabsAria")}
              className="flex h-10 shrink-0 items-center gap-1 border-b px-3"
              role="tablist"
            >
              {(["app", "data"] as const).map((value) => (
                <Button
                  key={value}
                  aria-controls={`${record.id}-${value}-panel`}
                  aria-selected={mainSurface === value}
                  id={tabId(value)}
                  onClick={() => selectMainSurface(value)}
                  onKeyDown={(event) => selectAdjacentTab(event, value)}
                  role="tab"
                  size="sm"
                  tabIndex={mainSurface === value ? 0 : -1}
                  variant={mainSurface === value ? "secondary" : "ghost"}
                >
                  {value === "app"
                    ? t("bases.gui.appTab")
                    : t("bases.gui.dataTab")}
                </Button>
              ))}
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
          {editOpen && (
            <div className="absolute inset-0 z-30 grid place-items-center bg-background/70 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-sky-700">
                <SnowflakeIcon className="size-9" />
                <p className="font-medium text-sm">编辑模式，Base 已冻结</p>
              </div>
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
        {/* 编辑栏在内、设置与使用栏在外：编辑是对 App 自身动刀，属于主体的一部分，
            页头理应盖在它上面；设置与使用是 App 的平级邻居，故它们才跨页头。
            三者同受 rightSurface 互斥，任一时刻至多一栏有宽度。 */}
        <AppEditPanel
          appId={record.id}
          appName={record.displayName}
          defaultAgent={record.agent}
          open={editOpen}
        />
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
      </div>
    </PageShell>
  );
}
