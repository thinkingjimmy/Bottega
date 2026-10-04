/**
 * [INPUT]: Depends on AvailableAttachedApp, apps-client surface/open/stop/file-export controls, BaseWorkbench, the grant failure notice, attachment leases, router data navigation, the shared AppAuthorizationDialog, and the localized App-tab catalog
 * [OUTPUT]: Provides AppTabPanel with localized loading, tombstone and distinct unauthorized states, an Open App button that shows Opening… and takes no second click while the open is in flight and says a refusal by its line (the cutover title and hint, else Could not start the App; raw text only to the log), an inline authorization entry, data-surface navigation and file export from GUI host actions, last-turn failure disclosure, and data or trusted-GUI surfaces The row-write Base tab renews its App surface lease once when main stops honouring it (the workbench retries the refused write), releasing the lease it replaced.
 * [POS]: apps/desktop/src/components/chat/side-panel/tabs; General App tab shell for chat/side-panel; it opens the same shared authorization dialog the tab badge does and never maintains a second permission flow
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  AppAttachmentSurface,
  AppRecord,
  AvailableAttachedApp,
  BaseGuiHostAction,
} from "../../../../../shared/ipc/apps/apps-ipc";
import { canonicalAppSurfaceRoute } from "../../../../../shared/ipc/settings/window-surfaces-ipc";
import {
  appOriginWithoutStart,
  acquireAppSurface,
  beginAppFileExport,
  cancelAppFileExport,
  finalizeAppFileExport,
  listApps,
  openApp,
  stopApp,
  releaseAppSurface,
  writeAppFileExport,
} from "@/lib/apps/apps-client";
import { AppAuthorizationDialog } from "@/components/apps/authorization/app-authorization-dialog";
import { AppGrantNotice } from "../grant/app-grant-notice";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { AppGuiSurface } from "@/components/apps/surface/app-gui-surface";
import { guiFailureKind } from "@/components/apps/surface/app-gui-surface-failure";
import { useAppGui } from "@/components/apps/surface/use-app-gui";
import { appendComposerText } from "@/lib/chat/state/composer/chat-composer-store";
import { focusComposer } from "@/lib/gallery/focus-controller";
import { DesignHistoryButton } from "@/components/apps/design/design-history-dialog";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";

async function loadAppPanelState(appId: string) {
  const [snapshot, live] = await Promise.all([
    listApps(),
    appOriginWithoutStart(appId),
  ]);
  return {
    record: snapshot.apps.find((item) => item.id === appId) ?? null,
    origin: live?.origin ?? "",
  };
}

export function AppTabPanel({
  app,
  chatId,
  incarnationId,
  visible,
}: {
  app: AvailableAttachedApp;
  chatId: string;
  incarnationId: string;
  visible: boolean;
}) {
  const { t } = useAppTranslation();
  const [record, setRecord] = useState<AppRecord | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const [surface, setSurface] = useState<AppAttachmentSurface | null>(null);
  const designGui = Boolean(
    record?.manifest?.kind === "base" &&
    record.manifest.gui?.capabilities.includes("workspace-read")
  );
  const gui = useAppGui({
    appId: app.appId,
    appSurfaceLeaseId: surface?.surfaceLeaseId,
    enabled: designGui && Boolean(surface),
    revisionKey: record?.generationBinding.active
      ? `${record.generationBinding.active.generationId}:${record.lifecycleRevision}`
      : "",
  });
  const granted = app.effectiveGrant !== null;
  /* Opening a server App can wait up to 10 s while it changes versions (after an install or update): the button says so and takes
     no second click, and a refusal says why in the interface language — the cutover line, else "could not start" — never raw text. */
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const [openFailure, setOpenFailure] = useState<{ title: string; hint?: string } | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const navigate = useNavigate();
  /* 数据面的去处与 Base App Studio 完全同一个：`/apps/{id}/data`。侧栏这一格
     没有第二个页签可切，所以「去数据」就是产品里那条既有的数据导航；viewId
     随 location.state 一起过去，那边同一个 requestedView 消费它。 */
  const openData = useCallback(
    (viewId?: string) =>
      navigate(canonicalAppSurfaceRoute(app.appId, "data"), {
        state: viewId ? { requestedViewId: viewId } : undefined,
      }),
    [app.appId, navigate]
  );
  /* file.export 在这一格是能落地的：main 侧只要求「面租约属于本 App + 本
     会话驻留 + 一次可信手势」，chat-tab 租约三样都有。从前这里一律 return
     false，把一个真能做的动作说成做不了。 */
  const hostAction = useCallback(
    (
      action: BaseGuiHostAction,
      context: Readonly<{ trustedGestureAt: number | null }>,
      exportSurface: Readonly<{
        appId: string;
        surfaceId: string;
        appSurfaceLeaseId: string;
      }>
    ) => {
      if (action.type === "compose-text") {
        const accepted = appendComposerText(chatId, action.text);
        if (accepted) focusComposer(chatId);
        return Promise.resolve(accepted);
      }
      if (action.type === "open-data" || action.type === "open-data-view") {
        openData(action.type === "open-data-view" ? action.viewId : undefined);
        return Promise.resolve(true);
      }
      if (action.type === "file.export.begin") {
        if (context.trustedGestureAt === null) return Promise.resolve(false);
        return beginAppFileExport({
          surface: exportSurface,
          request: action.request,
          trustedGestureAt: context.trustedGestureAt,
        });
      }
      if (action.type === "file.export.chunk") {
        return writeAppFileExport({
          surface: exportSurface,
          header: action.header,
          bytes: action.bytes,
        });
      }
      if (action.type === "file.export.finalize") {
        return finalizeAppFileExport({ surface: exportSurface, exportId: action.exportId });
      }
      return cancelAppFileExport({ surface: exportSurface, exportId: action.exportId });
    },
    [chatId, openData]
  );
  const refresh = useCallback(async () => {
    const next = await loadAppPanelState(app.appId);
    setRecord(next.record);
    setOrigin(next.origin);
  }, [app.appId]);
  useEffect(() => {
    let active = true;
    void loadAppPanelState(app.appId)
      .then((next) => {
        if (!active) return;
        setRecord(next.record);
        setOrigin(next.origin);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : t("chat.sidePanel.appTab.readFailed")
          );
        }
      });
    return () => {
      active = false;
    };
  }, [app.appId, t]);
  /* The lease this tab holds now: a renewal replaces it, and whichever is current is released on unmount. */
  const heldLease = useRef("");
  const renewSurfaceLease = useCallback(async () => {
    const value = await acquireAppSurface({ appId: app.appId, mode: "chat-tab", conversationId: chatId, conversationIncarnationId: incarnationId });
    const previous = heldLease.current;
    heldLease.current = value.surfaceLeaseId;
    setSurface(value);
    if (previous) void releaseAppSurface(previous).catch(() => undefined);
    return value.surfaceLeaseId;
  }, [app.appId, chatId, incarnationId]);
  useEffect(() => {
    if (!granted) return;
    let active = true;
    void acquireAppSurface({
      appId: app.appId,
      mode: "chat-tab",
      conversationId: chatId,
      conversationIncarnationId: incarnationId,
    })
      .then((value) => {
        if (!active) return releaseAppSurface(value.surfaceLeaseId);
        heldLease.current = value.surfaceLeaseId;
        setSurface(value);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : t("chat.sidePanel.appTab.surfaceFailed")
          );
        }
      });
    return () => {
      active = false;
      if (heldLease.current) void releaseAppSurface(heldLease.current);
      heldLease.current = "";
    };
  }, [app.appId, chatId, granted, incarnationId, t]);
  if (!record || record.state !== "ready" || !record.generationBinding.active) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
        {error || t("chat.sidePanel.appTab.unavailable")}
      </div>
    );
  }
  const noData = record.domainIdentity?.kind === "no-data";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 权限档位归 tab 上那颗盾；这里只在真的出事时让出一条横幅的高度 */}
      {app.effectiveGrant && (
        <AppGrantNotice appId={app.appId} chatId={chatId} />
      )}
      {!app.effectiveGrant ? (
        /* 「未授权」不是「已失效」。从前两态共用一句话，说的还是错的那一句，
           而且没有出口——盾在页签上，用户得先猜到它在那里。这里把同一个
           对话框摆在人正看着的地方，措辞照实说。 */
        <div className="grid min-h-0 flex-1 place-items-center gap-3 px-6 text-center text-sm">
          <div className="flex flex-col items-center gap-3">
            <p className="text-muted-foreground">
              {t("chat.sidePanel.appTab.notAuthorized")}
            </p>
            <Button onClick={() => setAuthorizeOpen(true)} variant="outline">
              {t("chat.sidePanel.appTab.authorize")}
            </Button>
          </div>
        </div>
      ) : noData ? (
        origin ? (
          <>
            <iframe
              className="min-h-0 flex-1 border-0"
              hidden={!visible}
              sandbox="allow-forms allow-scripts allow-same-origin"
              src={origin}
              title={record.displayName}
            />
            {record.manifest?.kind === "server" && (
              <Button className="m-3" onClick={() => void stopApp(record.id).then(refresh)} variant="outline">
                {t("chat.sidePanel.appTab.stop")}
              </Button>
            )}
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center">
            <div className="flex flex-col items-center gap-2 px-6 text-center text-sm">
              {openFailure && (
                <div role="alert" data-app-open-failure="">
                  <p className="font-medium">{openFailure.title}</p>
                  {openFailure.hint && <p className="text-muted-foreground">{openFailure.hint}</p>}
                </div>
              )}
              <Button
                aria-busy={opening}
                disabled={opening}
                onClick={() => {
                  if (openingRef.current) return;
                  openingRef.current = true;
                  setOpening(true);
                  setOpenFailure(null);
                  void openApp(record.id)
                    .then((result) => setOrigin(result.origin))
                    .catch((cause: unknown) => {
                      console.warn("[app-tab] open refused", cause);
                      setOpenFailure(guiFailureKind({ error: cause instanceof Error ? cause.message : String(cause), missingEntry: false }) === "cutover"
                        ? { title: t("bases.gui.cutoverFailedTitle"), hint: t("bases.gui.cutoverFailedHint") }
                        : { title: t("chat.sidePanel.appTab.startFailed") });
                    })
                    .finally(() => { openingRef.current = false; setOpening(false); });
                }}
              >
                {opening ? t("chat.sidePanel.appTab.opening") : t("chat.sidePanel.appTab.open")}
              </Button>
            </div>
          </div>
        )
      ) : (
        /* no-data App（static/server）没有 Base 面：数据形态分流就地判定，
           不再经由已退化的 AppDomainSurface 壳。 */
        designGui && surface ? (
          <AppGuiSurface
            gui={gui}
            onGoToData={() => openData()}
            toolbar={<DesignHistoryButton
              appId={record.id}
              appSurfaceLeaseId={surface.surfaceLeaseId}
              onRestored={gui.refresh}
            />}
            onHostAction={(action, context) =>
              hostAction(action, context, {
                appId: record.id,
                surfaceId: gui.surfaceId,
                appSurfaceLeaseId: surface.surfaceLeaseId,
              })
            }
          />
        ) : !record.domainIdentity || record.domainIdentity.kind === "no-data" ? null : surface?.ownerKey &&
          surface.dataGrant?.kind === "base" ? (
          surface.dataGrant.level === "row-write" ? (
            <BaseWorkbench
              capability="row-write"
              compact
              ownerKey={surface.ownerKey}
              surfaceLeaseId={surface.surfaceLeaseId}
              renewSurfaceLease={renewSurfaceLease}
            />
          ) : (
            <BaseWorkbench
              capability="read"
              compact
              ownerKey={surface.ownerKey}
            />
          )
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
            {t("apps.surfacePreparing")}
          </div>
        )
      )}
      {/* 与页签上那颗盾开的是同一个对话框：授权只有一个编辑器，这里只是
          把它的入口放到用户正在看的那一格里。 */}
      <AppAuthorizationDialog
        appId={app.appId}
        mode="edit"
        onCommitted={refresh}
        onOpenChange={setAuthorizeOpen}
        open={authorizeOpen}
        target={{
          kind: "chat",
          chatId,
          expectedConversationIncarnationId: incarnationId,
        }}
      />
    </div>
  );
}
