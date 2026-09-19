/**
 * [INPUT]: Depends on React/router navigation/progress and rejected-destination state, i18n, AppsProvider, shared App catalog/card presentation, Add AppDialog, PresetShelf/PresetInstallDialog, Sheet and PageShell
 * [OUTPUT]: Provides AppsListView with the Cloud Dev portable catalog, a card-shaped placeholder grid while listApps is in flight, explicit local installation and a single-page entry with rejected App navigation evidence; preset authorization leads directly to canonical App detail while Web installs retain progress UI
 * [POS]: Apps route composition; local installations, portable cloud entries and first-party acquisition retain their existing domain owners
 */

import { CompatibilityRequests } from "@/components/apps/compatibility/requests";
import { CloudAppsCatalog } from "@/components/apps/cloud/catalog";
import type { AppCompatibilityFailure } from "../../shared/app-host/contract";
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
  AppCatalogBody,
  AppCatalogEmpty,
  AppCatalogGrid,
  AppCatalogSkeleton,
} from "@ai-chat/ui/components/catalog/app-catalog";
import {
  type AppListItem,
  useApps,
} from "@/components/providers/apps-provider";
import { readAppLog, presentAppCompatibility } from "@/lib/apps-client";
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

/* epoch 让「再打开一次」成为一次新挂载：安装弹窗因此一次挂载只 probe 一次，
   而关闭不卸载它，退场动画得以完整播完。 */
type PresetFlow = {
  requestId?: string;
  preset: PresetAppSummary;
  epoch: number;
  open: boolean;
};

function ProgressOverlay({ app }: { app: AppListItem }) {
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

export function EmptyAppsPanel({
  warning,
  children,
}: {
  warning: string;
  children?: ReactNode;
}) {
  const { t } = useAppTranslation();
  return (
    <AppCatalogEmpty
      title={t(warning ? "apps.listUnavailable" : "apps.empty")}
      description={t(warning ? "apps.listUnavailableLead" : "apps.emptyLead")}
      warning={warning}
      hint={<AddAppHint />}
    >
      {children}
    </AppCatalogEmpty>
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
    presets,
    runtimeWarning,
    sidebarStatus,
  } = useApps();
  const [progressRequest, setProgressRequest] = useState({
    appId: "",
    revision: 0,
  });
  const [repoResumeId, setRepoResumeId] = useState<string | undefined>();
  const [presetFlow, setPresetFlow] = useState<PresetFlow | null>(null);
  const navigationError =
    typeof (location.state as { appNavigationError?: unknown } | null)
      ?.appNavigationError === "string"
      ? (location.state as { appNavigationError: string }).appNavigationError
      : "";
  const progressApp = apps.find(
    (app) =>
      app.record.id === progressRequest.appId &&
      isWorkingState(app.record.state),
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
    const requested = apps.find((app) => app.record.id === appId);
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

  const resumeCompatibility = (failure: AppCompatibilityFailure) => {
    if (failure.candidate.appId) {
      presentAppCompatibility(failure);
      return;
    }
    const preset = presets.find(
      (item) => item.id === failure.candidate.presetId,
    );
    if (preset)
      setPresetFlow((current) => ({
        preset,
        epoch: (current?.epoch ?? 0) + 1,
        open: true,
        requestId: failure.requestId,
      }));
    else setRepoResumeId(failure.requestId);
  };

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
        actions={
          <AddAppDialog
            onInstallStarted={openProgress}
            resumeRequestId={repoResumeId}
            onResumeClosed={() => setRepoResumeId(undefined)}
          />
        }
      >
        <AppCatalogBody>
          {window.cloudApps && <CloudAppsCatalog />}
          <CompatibilityRequests
            onResume={resumeCompatibility}
            highlightedId={searchParams.get("compatibility")}
          />
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
            <AppCatalogSkeleton label={t("apps.loading")} />
          ) : apps.length === 0 ? (
            <EmptyAppsPanel warning={listWarning}>
              <PresetShelf onSelect={openPreset} />
            </EmptyAppsPanel>
          ) : (
            <AppCatalogGrid>
              {apps.map((app) => (
                <AppCard
                  key={app.record.id}
                  app={app}
                  onOpenProgress={openProgress}
                />
              ))}
            </AppCatalogGrid>
          )}
        </AppCatalogBody>
      </PageShell>
      {presetFlow && (
        <PresetInstallDialog
          compatibilityRequestId={presetFlow.requestId}
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
