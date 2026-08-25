/**
 * [INPUT]: Depends on react-router, Apps Provider, base app detail, README adornment, unified app settings panel, apps client, Web app frame/edit/repair
 * [OUTPUT]: Provides AppDetailView, distributes Base/Web according to manifest.kind, and accepts Base import retry/cancel, README, third-party settings, and isolates from the App id status
 * [POS]: The App details the views of the routes; rightSurface states that set/log/edit are mutually exclusive, and that boundaries prevent Base App from triggering Web runtime
 */

import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router";
import {
  FileText,
  MonitorPlay,
  PencilLine,
  RefreshCw,
  Settings2,
  Snowflake,
} from "lucide-react";
import { AppEditPanel } from "@/components/apps/app-edit-panel";
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
import { openApp, readAppLog } from "@/lib/apps-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Separator } from "@ai-chat/ui/components/ui/separator";
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
import { cn } from "@ai-chat/ui/lib/utils";
import { errorMessage } from "@/lib/errors";

type FrameState =
  | { type: "idle" | "loading" | "stopped"; message?: string }
  | { type: "online"; origin: string }
  | { type: "error"; message: string };
type RightSurface = "none" | "settings" | "log" | "edit";

export function AppDetailView() {
  const { id } = useParams();
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
  const recordKind = record?.manifest?.kind;
  const name =
    record?.manifest?.name ??
    (app?.kind === "placeholder" ? app.name : record?.displayName ?? "App");

  useEffect(() => {
    if (!recordId || recordState !== "ready" || recordKind === "base") return;
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
              message: errorMessage(cause, "App 启动失败"),
            });
          }
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [recordId, recordKind, recordState]);

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

  const editOpen = rightSurface === "edit";
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
            演示占位不可运行；请用右上角 + 添加真实 GitHub App。
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
    return <BaseAppDetail key={record.id} record={record} />;
  }

  const effectiveFrame =
    app.runtimeState === "stopped" || app.runtimeState === "crashed"
      ? ({
          type: "stopped",
          message:
            app.runtimeState === "crashed"
              ? "App 进程意外退出"
              : "App 已停止",
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
          message: errorMessage(cause, "App 启动失败"),
        })
      );
  };

  return (
    <>
      <PageShell
        title={`${record.manifest?.icon ?? "📦"} ${name}`}
        /* 全部操作随标题落在左侧：设置栏跨页头，会把页头右端连同它右边的一切
           盖住，而日志/设置/编辑必须常驻可达——被盖住的按钮等于不存在的按钮。 */
        titleAdornment={
          <div className="flex items-center gap-1">
            <AppReadmeAdornment appId={record.id} appName={name} />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="查看日志"
              onClick={() => setRightSurface("log")}
            >
              <FileText />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="App Agent 设置"
              aria-pressed={settingsOpen}
              onClick={() =>
                setRightSurface(settingsOpen ? "none" : "settings")
              }
            >
              <Settings2 />
            </Button>
            {(record.state === "ready" || editOpen) && (
              <>
                <Separator className="mx-1 h-5" orientation="vertical" />
                <Button
                  size="sm"
                  variant="outline"
                  aria-label="编辑 App"
                  aria-pressed={editOpen}
                  className={cn(editOpen && "bg-accent")}
                  onClick={() => setRightSurface(editOpen ? "none" : "edit")}
                >
                  <PencilLine />
                  编辑 App
                </Button>
              </>
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
                  <p className="font-medium text-sm">正在应用修改并重建 App</p>
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
                Agent 未启动：{record.agentWarning}
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
                      <CardTitle>App 未运行</CardTitle>
                      <CardDescription>{effectiveFrame.message}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex gap-2">
                      <Button onClick={restart}>
                        <RefreshCw />
                        重新启动
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setRightSurface("log")}
                      >
                        查看日志
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              )}

            <div
              aria-hidden={!editOpen}
              inert={!editOpen}
              className={cn(
                "absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300",
                editOpen ? "opacity-100" : "pointer-events-none opacity-0"
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-sky-200/50 via-cyan-100/35 to-blue-300/45 backdrop-blur-[4px] backdrop-saturate-150" />
              <div className="relative flex flex-col items-center gap-2 text-sky-600/90">
                <Snowflake className="size-10" />
                <p className="font-medium text-sm">界面已冻结</p>
              </div>
            </div>
          </div>
          {/* 编辑栏在内、设置栏在外：编辑是对 App 自身动刀，属于主体的一部分，
              页头理应盖在它上面；设置是 App 的平级邻居，故它才跨页头。 */}
          <AppEditPanel
            open={editOpen}
            appId={record.id}
            appName={name}
            defaultAgent={record.agent}
          />
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
            <SheetTitle>安装与运行日志</SheetTitle>
            <SheetDescription>
              历史日志最多读取末尾 256 KB，并叠加当前会话实时事件。
            </SheetDescription>
          </SheetHeader>
          <SlimScroller asChild>
            <pre className="m-4 flex-1 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {logText || "暂无日志"}
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
