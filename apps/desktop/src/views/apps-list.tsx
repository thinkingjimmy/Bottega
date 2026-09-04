/**
 * [INPUT]: Depends on React/router navigation/progress and rejected-destination state, i18n, AppsProvider, App Card/Progress, Add AppDialog, PresetShelf/PresetInstallDialog, Sheet and PageShell
 * [OUTPUT]: Provides AppsListView single-page entry with rejected App navigation evidence; preset authorization leads directly to canonical App detail while Web installs retain progress UI
 * [POS]: views `/apps` import of products; The page only tells you what's installed, the first App only enters from the empty shelf, the page head + goes straight to GitHub installation
 */

import { useEffect, useState, type ReactNode } from "react";
import { AddAppHint } from "@/components/apps/add-app-hint";
import { AddAppDialog } from "@/components/apps/install/add-app-dialog";
import { AppCard } from "@/components/apps/app-card";
import { AppProgressDialog } from "@/components/apps/dialogs/app-progress-dialog";
import { isWorkingState } from "@/components/apps/app-state";
import {
  PresetInstallDialog,
  PresetShelf,
} from "@/components/apps/install/preset-app-shelf";
import { PageShell } from "@/components/page-shell";
import {
  type AppListItem,
  useApps,
} from "@/components/providers/apps-provider";
import { readAppLog } from "@/lib/apps-client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ai-chat/ui/components/ui/sheet";
import { LayoutGrid } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { PresetAppSummary } from "../../shared/apps-ipc";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { canonicalAppSurfaceRoute } from "../../shared/window-surfaces-ipc";

type InstalledApp = Extract<AppListItem, { kind: "installed" }>;
/* epoch 让「再打开一次」成为一次新挂载：安装弹窗因此一次挂载只 probe 一次，
   而关闭不卸载它，退场动画得以完整播完。 */
type PresetFlow = { preset: PresetAppSummary; epoch: number; open: boolean };

function ProgressOverlay({ app }: { app: InstalledApp }) {
  const { t } = useAppTranslation();
  const { cancelInstall, liveLogs } = useApps();
  const [logOpen, setLogOpen] = useState(false);
  const [historyLog, setHistoryLog] = useState("");
  const { record } = app;

  useEffect(() => {
    let active = true;
    void readAppLog(record.id)
      .then((log) => active && setHistoryLog(log))
      .catch(() => active && setHistoryLog(""));
    return () => {
      active = false;
    };
  }, [record.id]);

  const logText = [historyLog, ...(liveLogs[record.id] ?? [])]
    .filter(Boolean)
    .join("\n");
  const logPreview = logText.split("\n").filter(Boolean).slice(-12).join("\n");

  return (
    <>
      <AppProgressDialog
        record={record}
        step={app.step}
        operation={app.operation}
        logPreview={logPreview}
        onCancel={() => void cancelInstall(record.id)}
        onShowLog={() => setLogOpen(true)}
      />
      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("apps.installLog")}</SheetTitle>
            <SheetDescription>
              {t("apps.installLogDescription")}
            </SheetDescription>
          </SheetHeader>
          <SlimScroller asChild>
            <pre className="m-4 flex-1 overflow-auto rounded-lg bg-muted p-4 text-xs">
              {logText || t("apps.noLogs")}
            </pre>
          </SlimScroller>
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------------------- *
 *  「一张卡都没有」有两种成因，长得也该不一样：
 *  读取失败是一块虚线告警面板——那里本该有东西，我们没读到；
 *  真的没装则是开局引导，货架就摆在里面。虚线的意思是「此处为空」，
 *  一旦填进三张卡，它就不空了，边框自然该退场。
 * ------------------------------------------------------------------------- */
export function EmptyAppsPanel({
  warning,
  children,
}: {
  warning: string;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();

  if (warning) {
    return (
      <div className="my-auto rounded-2xl border border-amber-500/40 border-dashed bg-amber-500/5 px-6 py-10 text-center">
        <LayoutGrid className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-2 font-medium text-sm">
          {t("apps.listUnavailable")}
        </h2>
        <p className="mt-1 text-muted-foreground text-xs">
          {t("apps.listUnavailableLead")}
        </p>
        <p className="mt-3 text-muted-foreground text-xs">{warning}</p>
      </div>
    );
  }

  return (
    <>
      {/* 第二条路径不排在引导正文里：它讲的是页头右上角那颗 +，
          就该长在那颗 + 底下用一根箭头指过去，而不是在页面正中被读一遍。 */}
      <AddAppHint />
      {/* 竖向 my-auto 而非 justify-center：两者在有余量时同样居中，但窗口不够高时
          justify-center 会把溢出的头部裁在滚动区外够不着，auto margin 不会。
          横向的居中则**不能**也交给 auto margin：flex item 一旦有了 auto 横向
          外边距就不再 stretch，section 塌成 fit-content，里面的 w-full 货架没了
          可填的宽度，三张卡被挤到最宽那段文字的尺寸。故 section 保持满宽，
          限宽与居中下沉到一个普通块级子元素上。 */}
      <section className="my-auto w-full py-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <LayoutGrid className="size-8 text-muted-foreground" />
          <h2 className="mt-3 font-heading font-semibold text-base">
            {t("apps.empty")}
          </h2>
          <p className="mt-1.5 max-w-md text-muted-foreground text-sm">
            {t("apps.emptyLead")}
          </p>
          <div className="mt-7 w-full">{children}</div>
        </div>
      </section>
    </>
  );
}

export function AppsListView() {
  const { t } = useAppTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    acknowledgeSidebarStatus,
    apps,
    discardPresetProbe,
    highlightApp,
    installPreset,
    listWarning,
    loading,
    probePreset,
    runtimeWarning,
    sidebarStatus,
  } = useApps();
  const [progressRequest, setProgressRequest] = useState({
    appId: "",
    revision: 0,
  });
  const [presetFlow, setPresetFlow] = useState<PresetFlow | null>(null);
  const navigationError =
    typeof (location.state as { appNavigationError?: unknown } | null)
      ?.appNavigationError === "string"
      ? (location.state as { appNavigationError: string }).appNavigationError
      : "";
  const progressApp = apps.find(
    (app): app is InstalledApp =>
      app.kind === "installed" &&
      app.record.id === progressRequest.appId &&
      isWorkingState(app.record.state)
  );

  const openProgress = (appId: string) => {
    setProgressRequest((current) => ({
      appId,
      revision: current.revision + 1,
    }));
  };

  useEffect(() => {
    const appId = searchParams.get("progress");
    if (!appId || loading) return;
    const requested = apps.find(
      (app): app is InstalledApp =>
        app.kind === "installed" && app.record.id === appId
    );
    const timer = window.setTimeout(() => {
      if (requested && isWorkingState(requested.record.state)) {
        setProgressRequest((current) => ({
          appId,
          revision: current.revision + 1,
        }));
      }
      const next = new URLSearchParams(searchParams);
      next.delete("progress");
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [apps, loading, searchParams, setSearchParams]);

  const openPreset = (preset: PresetAppSummary) => {
    setPresetFlow((current) => ({
      preset,
      epoch: (current?.epoch ?? 0) + 1,
      open: true,
    }));
  };

  useEffect(() => {
    acknowledgeSidebarStatus();
  }, [acknowledgeSidebarStatus, sidebarStatus]);

  return (
    <>
      <PageShell
        title={t("common.apps")}
        icon={<LayoutGrid />}
        actions={<AddAppDialog onInstallStarted={openProgress} />}
      >
        <SlimScroller className="h-full overflow-y-auto p-4">
          {navigationError && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
            >
              {navigationError}
            </p>
          )}
          {/* 横幅只承接与「有哪些 App」无关的运行时降级；列表自身的问题
              归列表位置去说，预设包的问题归安装弹窗去说。 */}
          {runtimeWarning && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
            >
              {runtimeWarning}
            </p>
          )}
          {loading ? (
            <p className="text-muted-foreground text-sm">{t("apps.loading")}</p>
          ) : apps.length === 0 ? (
            /* relative 是给右上角批注的定位锚；h-full + flex 列让空态块拿到
               「剩余高度」这个概念，my-auto 才有余量可分。 */
            <div className="relative flex h-full flex-col">
              <EmptyAppsPanel warning={listWarning}>
                <PresetShelf onSelect={openPreset} />
              </EmptyAppsPanel>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <AppCard
                  key={app.kind === "installed" ? app.record.id : app.id}
                  app={app}
                  onOpenProgress={openProgress}
                />
              ))}
            </div>
          )}
        </SlimScroller>
      </PageShell>
      {presetFlow && (
        <PresetInstallDialog
          discardPresetProbe={discardPresetProbe}
          key={`${presetFlow.preset.id}:${presetFlow.epoch}`}
          onInstall={async (input) => {
            const record = await installPreset(input);
            highlightApp(record.id);
            navigate(canonicalAppSurfaceRoute(record.id));
            return record;
          }}
          onOpenChange={(open) =>
            setPresetFlow((current) => current && { ...current, open })
          }
          open={presetFlow.open}
          preset={presetFlow.preset}
          probePreset={probePreset}
        />
      )}
      {progressApp && (
        <ProgressOverlay
          key={`${progressApp.record.id}:${progressApp.record.state}:${progressRequest.revision}`}
          app={progressApp}
        />
      )}
    </>
  );
}
