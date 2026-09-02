/**
 * [INPUT]: Depends on react-router, Apps i18n/provider, Base detail, README/settings surfaces, Apps client, and Web App frame/edit/repair components
 * [OUTPUT]: Provides AppDetailView, residence-gated Base Studio rendering, App-window handoff, Editor navigation, Base/Web distribution, retry/cancel, README, and settings
 * [POS]: App detail route; web runtime start is gated by the positive servesWebRuntime predicate, and a nonresident main route renders a transfer card before any Base Studio hook or mutation surface mounts
 */

import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import {
  FileText,
  MonitorPlay,
  PanelsTopLeft,
  PencilLine,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { AppReadmeAdornment } from "@/components/apps/app-readme-adornment";
import { BaseAppDetail } from "@/components/apps/base-app-detail";
import { AppSettingsPanel } from "@/components/apps/app-settings-panel";
import { AppFailureCard } from "@/components/apps/app-failure-card";
import { AppExtensionConsentCard } from "@/components/apps/app-extension-consent-card";
import { AppFrame } from "@/components/apps/app-frame";
import {
  isFailedState,
  shouldRedirectAppDetail,
} from "@/components/apps/app-state";
import { RepairConfirmDialog } from "@/components/apps/repair-dialog";
import { PageShell } from "@/components/page-shell";
import { useApps } from "@/components/providers/apps-provider";
import { openApp, openAppEditor, readAppLog } from "@/lib/apps-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ai-chat/ui/components/ui/card";
// 日志仍走 Sheet：长流水线要的是整条右侧高度，弹窗只会把它切碎。
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ai-chat/ui/components/ui/sheet";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { toast } from "@ai-chat/ui/components/ui/sonner";
import { errorMessage } from "@/lib/errors";
import {
  appStudioSurface,
  canonicalAppSurfaceRoute,
} from "../../shared/window-surfaces-ipc";
import {
  isCurrentResidence,
  openSurfaceInWindow,
  useSurfaceResidence,
  windowContext,
} from "@/lib/window-surfaces-client";
import { SurfaceAwayCard } from "@/components/apps/surface-away-card";
import { servesWebRuntime, type AppRecord } from "../../shared/apps-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { productDestinationRoute } from "@/lib/product-navigation";

type FrameState =
  | { type: "idle" | "loading" | "stopped"; message?: string }
  | { type: "online"; origin: string }
  | { type: "error"; message: string };
type RightSurface = "none" | "settings" | "log";

function ResidentBaseAppDetail({ record }: { record: AppRecord }) {
  const { t } = useAppTranslation();
  const surface = appStudioSurface(record.id);
  const residence = useSurfaceResidence(surface);
  const route = `/apps/${record.id}/app`;
  if (!residence && window.windowSurfaces) {
    return (
      <div className="grid size-full place-items-center text-muted-foreground text-sm">
        {t("windowSurface.checkingResidence")}
      </div>
    );
  }
  if (residence && !isCurrentResidence(residence)) {
    return <SurfaceAwayCard residence={residence} route={route} />;
  }
  return <BaseAppDetail key={record.id} record={record} />;
}

export function AppDetailView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useAppTranslation();
  const { apps, retryApp, repairApp, cancelInstall, liveLogs } = useApps();
  const [rightSurface, setRightSurface] = useState<RightSurface>("none");
  const [frame, setFrame] = useState<FrameState>({ type: "idle" });
  const [revision, setRevision] = useState(0);
  const [repairOpen, setRepairOpen] = useState(false);
  const [historyLog, setHistoryLog] = useState({ appId: "", text: "" });
  const app = apps.find((item) =>
    item.kind === "installed" ? item.record.id === id : item.id === id
  );

  const record = app?.kind === "installed" ? app.record : null;
  const recordId = record?.id;
  const recordState = record?.state;
  const standalone = windowContext().role === "app-window";
  /* 启 runtime 的资格必须正着问：manifest 是 active generation 的投影，成代前
     它是 null，反向的 `kind !== "base"` 会把「还不知道」读成「是 Web App」，
     于是这条 effect 会替 Base App 去开 web runtime，把它打成 update-failed。 */
  const webRuntime = servesWebRuntime(record?.manifest);
  const name =
    record?.manifest?.name ??
    (app?.kind === "placeholder" ? app.name : record?.displayName ?? "App");

  const openWindow = async (target: AppRecord) => {
    try {
      const result = await openSurfaceInWindow(
        appStudioSurface(target.id),
        target.id,
        canonicalAppSurfaceRoute(target.id)
      );
      if (!result) throw new Error(t("windowSurface.openInWindowUnavailable"));
      navigate("/apps", { replace: true });
    } catch (cause) {
      toast.error(t("windowSurface.openInWindowFailed"), {
        description: errorMessage(cause),
      });
    }
  };

  useEffect(() => {
    if (!recordId || recordState !== "ready" || !webRuntime) return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      setFrame({ type: "loading" });
      void openApp(recordId)
        .then(({ origin }) => {
          if (!active) return;
          setRevision((value) => value + 1);
          setFrame({ type: "online", origin });
        })
        .catch((cause) => {
          if (active) {
            setFrame({
              type: "error",
              message: errorMessage(cause, t("apps.detail.startFailed")),
            });
          }
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [recordId, recordState, t, webRuntime]);

  useEffect(() => {
    if (rightSurface !== "log" || !recordId) return;
    let active = true;
    void readAppLog(recordId)
      .then((log) => {
        if (active) setHistoryLog({ appId: recordId, text: log });
      })
      .catch(() => {
        if (active) setHistoryLog({ appId: recordId, text: "" });
      });
    return () => {
      active = false;
    };
  }, [rightSurface, recordId, recordState]);

  const logOpen = rightSurface === "log";
  const settingsOpen = rightSurface === "settings";

  // React Compiler 自动记忆化，无需手工 useMemo。
  const logText = [
    historyLog.appId === recordId ? historyLog.text : "",
    ...(recordId ? liveLogs[recordId] ?? [] : []),
  ]
    .filter(Boolean)
    .join("\n");

  if (!app) return <Navigate to="/apps" replace />;

  if (app.kind === "placeholder") {
    return (
      <PageShell title={`${app.icon} ${app.name}`} backHref="/apps">
        <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="text-5xl">{app.icon}</div>
          <p className="font-medium">{app.name}</p>
          <p className="max-w-md text-muted-foreground text-sm">
            {app.description}
          </p>
          <p className="text-muted-foreground text-xs">
            {t("apps.detail.placeholder")}
          </p>
        </div>
      </PageShell>
    );
  }
  if (!record) return <Navigate to="/apps" replace />;
  if (shouldRedirectAppDetail(record.state)) {
    return <Navigate to="/apps" replace />;
  }
  if (record.manifest?.kind === "base") {
    return <ResidentBaseAppDetail record={record} />;
  }

  const effectiveFrame =
    app.runtimeState === "stopped" || app.runtimeState === "crashed"
      ? ({
          type: "stopped",
          message:
            app.runtimeState === "crashed"
              ? t("apps.detail.crashed")
              : t("apps.detail.stopped"),
        } satisfies FrameState)
      : frame;

  const restart = () => {
    setFrame({ type: "loading" });
    void openApp(record.id)
      .then(({ origin }) => {
        setRevision((value) => value + 1);
        setFrame({ type: "online", origin });
      })
      .catch((cause) =>
        setFrame({
          type: "error",
          message: errorMessage(cause, t("apps.detail.startFailed")),
        })
      );
  };

  const openEditor = async () => {
    try {
      const destination = await openAppEditor({
        appId: record.id,
        requestId: crypto.randomUUID(),
        mode: "resume",
      });
      if (!standalone) navigate(productDestinationRoute(destination));
    } catch (cause) {
      toast.error(t("apps.detail.edit"), { description: errorMessage(cause) });
    }
  };

  return (
    <>
      <PageShell
        title={`${record.manifest?.icon ?? "📦"} ${name}`}
        /* 全部操作随标题落在左侧：设置栏跨页头，会把页头右端连同它右边的一切
           盖住，而日志/设置/编辑必须常驻可达——被盖住的按钮等于不存在的按钮。 */
        titleAdornment={
          <div className="flex items-center gap-1">
            {!standalone && (
              <Button
                aria-label={t("windowSurface.openInWindow")}
                onClick={() => void openWindow(record)}
                size="icon-sm"
                variant="ghost"
              >
                <PanelsTopLeft />
              </Button>
            )}
            <AppReadmeAdornment appId={record.id} appName={name} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("apps.detail.viewLog")}
              onClick={() => setRightSurface("log")}
            >
              <FileText />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("apps.detail.settings")}
              aria-pressed={settingsOpen}
              onClick={() =>
                setRightSurface(settingsOpen ? "none" : "settings")
              }
            >
              <Settings2 />
            </Button>
            {record.state === "ready" && record.editableSource === true && (
              <Button
                size="sm"
                variant="outline"
                aria-label={t("apps.detail.edit")}
                onClick={() => void openEditor()}
              >
                <PencilLine />
                {t("apps.detail.edit")}
              </Button>
            )}
          </div>
        }
        backHref="/apps"
      >
        <div className="flex h-full">
          <div className="relative min-w-0 flex-1">
            {/* pending 代是 App 的一个真实状态：没有这张卡，含 extensionRequirements
                的 App 装完就永远停在 consent-required，没有任何出口。 */}
            {record.generationBinding.pending && (
              <AppExtensionConsentCard record={record} />
            )}

            {isFailedState(record.state) && (
              <AppFailureCard
                record={record}
                onRetry={() => void retryApp(record.id)}
                onCancel={() => void cancelInstall(record.id)}
                onRepair={() => setRepairOpen(true)}
                onShowLog={() => setRightSurface("log")}
              />
            )}

            {record.state === "updating" && (
              <div className="flex size-full items-center justify-center p-8">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <RefreshCw className="size-7 animate-spin" />
                  <p className="font-medium text-sm">
                    {t("apps.detail.rebuilding")}
                  </p>
                </div>
              </div>
            )}

            {record.state === "ready" && effectiveFrame.type === "loading" && (
              <Skeleton className="size-full rounded-none" />
            )}
            {record.state === "ready" && record.agentWarning && (
              <p
                role="alert"
                className="absolute inset-x-4 top-4 z-20 rounded-lg border border-amber-500/30 bg-amber-50/95 p-3 text-amber-900 text-sm shadow-sm"
              >
                {t("apps.detail.agentWarning", {
                  warning: record.agentWarning,
                })}
              </p>
            )}
            {record.state === "ready" && effectiveFrame.type === "online" && (
              <AppFrame
                origin={effectiveFrame.origin}
                name={name}
                revision={revision}
              />
            )}
            {record.state === "ready" &&
              (effectiveFrame.type === "error" ||
                effectiveFrame.type === "stopped") && (
                <div className="flex size-full items-center justify-center p-8">
                  <Card className="max-w-md">
                    <CardHeader>
                      <MonitorPlay className="mb-2 size-8 text-muted-foreground" />
                      <CardTitle>{t("apps.detail.notRunning")}</CardTitle>
                      <CardDescription>{effectiveFrame.message}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-2">
                      <Button onClick={restart}>
                        <RefreshCw />
                        {t("apps.detail.restart")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setRightSurface("log")}
                      >
                        {t("apps.detail.viewLog")}
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}

          </div>
          <AppSettingsPanel
            onClose={() => setRightSurface("none")}
            open={settingsOpen}
            record={record}
          />
        </div>
      </PageShell>

      <Sheet open={logOpen} onOpenChange={(next) => setRightSurface(next ? "log" : "none")}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("apps.detail.logTitle")}</SheetTitle>
            <SheetDescription>
              {t("apps.detail.logDescription")}
            </SheetDescription>
          </SheetHeader>
          <SlimScroller asChild>
            <pre className="m-4 flex-1 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {logText || t("apps.detail.noLogs")}
            </pre>
          </SlimScroller>
        </SheetContent>
      </Sheet>

      <RepairConfirmDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        onConfirm={() => void repairApp(record.id).then(() => setRepairOpen(false))}
      />
    </>
  );
}
