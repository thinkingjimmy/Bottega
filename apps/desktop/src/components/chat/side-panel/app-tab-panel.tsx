/**
 * [INPUT]: Depends on AvailableAttachedApp, apps-client only view/express open/stop, three-tiered BaseWorkbench, AppGrantCard and attachment lease
 * [OUTPUT]: Provides AppTabPanel; Unmanifested open time 0 start, read/row-write shared six views Base projection, Chat deny keep clear Recovery, disabled/delete keep original tombstone
 * [POS]: The general App tab shell for chat/side-panel; Navigation slots, authorization and runtime triangles are not interrelated
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  AppAttachmentSurface,
  AppRecord,
  AvailableAttachedApp,
} from "../../../../shared/apps-ipc";
import {
  appOriginWithoutStart,
  acquireAppSurface,
  listApps,
  openApp,
  stopApp,
  releaseAppSurface,
} from "@/lib/apps-client";
import { AppGrantCard } from "./app-grant-card";
import { BaseWorkbench } from "@/components/bases/base-workbench";
import { AppGuiSurface } from "@/components/apps/app-gui-surface";
import { useAppGui } from "@/components/apps/use-app-gui";
import { appendComposerText } from "@/lib/chat-composer-store";
import { focusComposer } from "@/lib/gallery/focus-controller";
import { DesignHistoryControls } from "@/components/apps/design/design-history-controls";
import { useAppTranslation } from "@/components/providers/i18n-provider";

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
  onRefresh,
}: {
  app: AvailableAttachedApp;
  chatId: string;
  incarnationId: string;
  visible: boolean;
  onRefresh: () => void;
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
          setError(cause instanceof Error ? cause.message : "App 状态读取失败");
        }
      });
    return () => {
      active = false;
    };
  }, [app.appId]);
  useEffect(() => {
    if (!granted) return;
    let active = true;
    let leaseId = "";
    void acquireAppSurface({
      appId: app.appId,
      mode: "chat-tab",
      conversationId: chatId,
      conversationIncarnationId: incarnationId,
    })
      .then((value) => {
        leaseId = value.surfaceLeaseId;
        if (active) setSurface(value);
        else return releaseAppSurface(leaseId);
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "App surface 签发失败");
        }
      });
    return () => {
      active = false;
      if (leaseId) void releaseAppSurface(leaseId);
    };
  }, [app.appId, chatId, granted, incarnationId]);
  if (!record || record.state !== "ready" || !record.generationBinding.active) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
        {error || "App 已失效或正在删除；slot 已保留，但不会签发 runtime/data 能力。"}
      </div>
    );
  }
  const noData = record.domainIdentity?.kind === "no-data";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AppGrantCard
        conversationId={chatId}
        grant={app.effectiveGrant}
        onChanged={() => {
          onRefresh();
          void refresh();
        }}
        record={record}
        target={{ kind: "chat", chatId }}
      />
      {!app.effectiveGrant ? (
        <div className="grid min-h-0 flex-1 place-items-center px-6 text-center text-muted-foreground text-sm">
          此 Chat 已显式关闭该 App。清除 Chat 覆盖后会重新继承 Project 或默认全局授权。
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
                停止 App
              </Button>
            )}
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center">
            <Button
              onClick={() =>
                void openApp(record.id)
                  .then((result) => setOrigin(result.origin))
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "启动失败")
                  )
              }
            >
              打开 App
            </Button>
          </div>
        )
      ) : (
        /* no-data App（static/server）没有 Base 面：数据形态分流就地判定，
           不再经由已退化的 AppDomainSurface 壳。 */
        designGui && surface ? (
          <AppGuiSurface
            gui={gui}
            onGoToData={() => undefined}
            toolbar={<DesignHistoryControls
              appId={record.id}
              appSurfaceLeaseId={surface.surfaceLeaseId}
              onRestored={gui.refresh}
            />}
            onHostAction={(action) => {
              if (action.type === "compose-text") {
                const accepted = appendComposerText(chatId, action.text);
                if (accepted) focusComposer(chatId);
                return accepted;
              }
              return false;
            }}
          />
        ) : !record.domainIdentity || record.domainIdentity.kind === "no-data" ? null : surface?.ownerKey &&
          surface.dataGrant?.kind === "base" ? (
          surface.dataGrant.level === "row-write" ? (
            <BaseWorkbench
              capability="row-write"
              compact
              ownerKey={surface.ownerKey}
              surfaceLeaseId={surface.surfaceLeaseId}
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
    </div>
  );
}
