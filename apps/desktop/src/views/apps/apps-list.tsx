/**
 * [INPUT]: Depends on parent-owned surface visibility, the shared Dock settings store, lazy Widget management and localized Dock section, React/router navigation/progress and rejected-destination state, i18n, AppsProvider, shared App catalog/card presentation, Tabs, a Widget action portal, AddAppDialog, PresetShelf/PresetInstallDialog, Sheet and PageShell.
 * [OUTPUT]: Provides AppsListView with localized category tabs and add actions below the page header, an enabled-only Widget catalog, Cloud Dev portable entries, loading cards, explicit local installation and rejected App navigation evidence. Preset authorization leads to canonical App detail while Web installs show progress. Owns one Dock subscription for tab availability and independent App shortcuts.
 * [POS]: apps/desktop/src/views/apps; Apps route composition; local installations, portable cloud entries and first-party acquisition retain their existing domain owners
 */

import { dockSettingsStore } from "@/lib/platform/system-dock-settings-client";
import { CompatibilityRequests } from "@/components/apps/compatibility/requests";
import { CloudAppsCatalog } from "@/components/apps/cloud/catalog";
import type { AppCompatibilityFailure } from "../../../shared/app-host/contract";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AddAppHint } from "@/components/apps/cards/add-app-hint";
import { AddAppDialog } from "@/components/apps/install/add-app-dialog";
import { AppCard } from "@/components/apps/cards/app-card";
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
} from "@/components/providers/content/apps-provider";
import { readAppLog, presentAppCompatibility } from "@/lib/apps/apps-client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ai-chat/ui/components/ui/sheet";
import { LayoutGrid } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import type { PresetAppSummary } from "../../../shared/ipc/apps/apps-ipc";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { canonicalAppSurfaceRoute } from "../../../shared/ipc/settings/window-surfaces-ipc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ai-chat/ui/components/ui/tabs";
import { pluginContextCopy } from "@/lib/plugin-platform/context-copy";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { loadSection } from "../../../shared/i18n/sections";

const DockWidgetsSection = lazy(() => Promise.all([
  import("@/components/settings/dock/widgets"), loadSection("systemDock", effectiveLocale()),
]).then(([module]) => ({ default: module.DockWidgetsSection })));

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

export function AppsListView({ surfaceVisible = true }: { surfaceVisible?: boolean }) {
  const [widgetActionsContainer, setWidgetActionsContainer] = useState<HTMLDivElement | null>(null);
  const dock = useSyncExternalStore(dockSettingsStore.subscribe, dockSettingsStore.getSnapshot);
  useEffect(() => { dockSettingsStore.load(); }, []);
  const { t, i18n } = useAppTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const dockEnabled = Boolean(dock.snapshot?.capability.supported && dock.snapshot.state.enabled);
  const selectedTab = dockEnabled && searchParams.get("tab") === "widgets" ? "widgets" : "apps";
  const selectTab = (tab: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (tab === "widgets") next.set("tab", tab); else next.delete("tab");
      return next;
    }, { replace: true });
  };
  useEffect(() => {
    if (surfaceVisible && dock.snapshot && !dockEnabled && searchParams.get("tab") === "widgets") {
      setSearchParams(current => {
        const next = new URLSearchParams(current);
        next.delete("tab");
        return next;
      }, { replace: true });
    }
  }, [surfaceVisible, dock.snapshot, dockEnabled, searchParams, setSearchParams]);
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

  const appCatalog = <>
    {window.cloudApps && <CloudAppsCatalog />}
    <CompatibilityRequests
      onResume={resumeCompatibility}
      highlightedId={searchParams.get("compatibility")}
    />
    {loading ? (
      <AppCatalogSkeleton label={t("apps.loading")} />
    ) : apps.length === 0 ? (
      <EmptyAppsPanel warning={listWarning}>
        <PresetShelf onSelect={openPreset} />
      </EmptyAppsPanel>
    ) : (
      <AppCatalogGrid>
        {apps.map((app) => (
          <AppCard key={app.record.id} app={app} dock={dock} onOpenProgress={openProgress} />
        ))}
      </AppCatalogGrid>
    )}
  </>;

  return (
    <>
      <Tabs value={selectedTab} onValueChange={selectTab} className="h-full min-h-0 gap-0">
        <PageShell title={pluginContextCopy(i18n.language).plugins} icon={<LayoutGrid />}>
          <div className="flex h-full min-h-0 flex-col">
            <div data-app-catalog-toolbar="" className="mx-4 mt-2 flex min-h-11 shrink-0 items-center gap-2">
              {dockEnabled && (
                <TabsList
                  aria-label={t("apps.catalog.filter")}
                  className="relative isolate min-h-11 bg-transparent p-0 before:absolute before:inset-x-0 before:inset-y-2 before:-z-10 before:rounded-lg before:bg-muted/70"
                >
                  {([['apps', t('common.apps')], ['widgets', t('apps.catalog.widgets')]] as const).map(([value, label]) => (
                    <TabsTrigger
                      key={value}
                      value={value}
                      className="relative isolate min-h-11 border-0 px-3 text-xs font-medium transition-colors before:absolute before:inset-x-1 before:inset-y-2.5 before:-z-10 before:rounded-md data-active:bg-transparent data-active:before:bg-background data-active:before:shadow-sm dark:data-active:bg-transparent"
                    >
                      {label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
              <div
                ref={selectedTab === "widgets" ? setWidgetActionsContainer : undefined}
                className="ml-auto flex shrink-0 items-center"
              >
                {selectedTab === "apps" && (
                  <AddAppDialog
                    onInstallStarted={openProgress}
                    resumeRequestId={repoResumeId}
                    onResumeClosed={() => setRepoResumeId(undefined)}
                  />
                )}
              </div>
            </div>
            <AppCatalogBody>
              {navigationError && (
                <p
                  role="alert"
                  className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
                >
                  {navigationError}
                </p>
              )}
              {/* Runtime warnings are independent of the App list and installer. */}
              {runtimeWarning && (
                <p
                  role="alert"
                  className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
                >
                  {runtimeWarning}
                </p>
              )}
              {dockEnabled ? (
                <>
                  <TabsContent value="apps" className="min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                    {appCatalog}
                  </TabsContent>
                  <TabsContent value="widgets">
                    <Suspense fallback={<AppCatalogSkeleton label={t("common.loading")} />}>
                      <DockWidgetsSection active={surfaceVisible} actionsContainer={widgetActionsContainer} />
                    </Suspense>
                  </TabsContent>
                </>
              ) : appCatalog}
            </AppCatalogBody>
          </div>
        </PageShell>
      </Tabs>
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
