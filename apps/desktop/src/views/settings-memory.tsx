/**
 * [INPUT]: Depends on React, shared Memory/AppSettings contracts with MEMORY_SHARING_MODES, app Intl locale, view-local consent/history-import/setup modules, settings/memory components, memoryMasterRow, and memory-store authority flows
 * [OUTPUT]: Provides MemorySettingsView: a provider-bound, backtrackable install-first setup followed by the settled product switch, engine roster, sharing scope, activity, and attention surfaces; the activity header hosts both corpus actions — history import fills those numbers, rebuild clears them
 * [POS]: Settings › Memory product console; this layer declares user intent and dialog orchestration while all durable facts come from main-owned snapshots
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MemoryActivityGrid } from "@/components/settings/memory/memory-activity-grid";
import { MemoryAttentionList } from "@/components/settings/memory/memory-attention-list";
import { MemoryDisclosureDialog } from "@/components/settings/memory/memory-disclosure-dialog";
import { MemoryEngineList } from "@/components/settings/memory/memory-engine-list";
import {
  MemoryRebuildButton,
  MemoryRebuildDialog,
  MemoryRebuildProgress,
} from "@/components/settings/memory/memory-rebuild";
import {
  blankMemoryConfigValues,
  MemoryRuntimeConfigDialog,
  MemoryRuntimePanel,
  MemoryUninstallDialog,
} from "@/components/settings/memory/memory-runtime-panel";
import { MemorySupplyList } from "@/components/settings/memory/memory-supply-list";
import {
  SettingsCanvas,
  SettingsChoiceRow,
  SettingsIconButton,
  SettingsList,
  SettingsSection,
  SettingsSwitch,
} from "@/components/settings/settings-layout";
import { memoryStore } from "@/lib/memory-store";
import { intlLocale } from "@/lib/i18n-locale";
import { errorMessage } from "@/lib/errors";
import {
  TONE_SURFACE,
  TONE_TEXT,
  memoryMasterRow,
  memoryRuntimeStance,
  memoryServiceNeedsAttention,
  rebuildOutstanding,
} from "@/lib/memory-view";
import { settingsStore } from "@/lib/settings-store";
import { Button } from "@ai-chat/ui/components/ui/button";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryConsentPreview,
  MemoryDestructiveAuthority,
  MemoryRuntimeConfigPreview,
} from "../../shared/memory-ipc";
import { MEMORY_SHARING_MODES } from "../../shared/settings-ipc";
import { useHistoryMemoryImport } from "./settings-memory/history-import-action";
import { MemorySetup } from "./settings-memory/memory-setup";
import { useMemoryConsent } from "./settings-memory/use-memory-consent";

/** 相对时间要自己走动，否则「刚刚」会在页面上凝固一整天。 */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function MemorySettingsView() {
  const { t } = useAppTranslation();
  const { settings, error: settingsError } = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot
  );
  const {
    providers,
    panels,
    status,
    runtimes,
    checkingUpdates,
    loading,
    error,
  } =
    useSyncExternalStore(memoryStore.subscribe, memoryStore.getSnapshot);
  const consent = useMemoryConsent(settings);
  /* 哪一档引擎的抽屉摊开着。要不要强制摊开由 memoryServiceNeedsAttention
     说了算，两者 or 在一起——于是不存在「用户收起了一件坏掉的东西」。 */
  const [openEngineId, setOpenEngineId] = useState<string | null>(null);
  /* 首次设置的显式目标；null 才允许 MemorySetup 按 runtime 事实恢复。 */
  const [setupEngineId, setSetupEngineId] = useState<string | null>(null);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<string | null>(null);
  const [rebuildAuthority, setRebuildAuthority] =
    useState<MemoryDestructiveAuthority | null>(null);
  const [rebuildPreview, setRebuildPreview] =
    useState<MemoryConsentPreview | null>(null);
  const [uninstallAuthority, setUninstallAuthority] =
    useState<MemoryDestructiveAuthority | null>(null);
  const [pendingRuntimeConfig, setPendingRuntimeConfig] = useState<{
    preview: MemoryRuntimeConfigPreview;
  } & (
    | { kind: "write"; values: Record<string, string> }
    | {
        kind: "issue";
        issue: MemoryConfigIssue;
        action: MemoryConfigIssueAction;
      }
  ) | null>(null);
  const [runtimeConfigBusy, setRuntimeConfigBusy] = useState(false);
  /* 配置弹窗开给谁：每一档引擎都有自己的配置入口，main 本来就允许配置
     一个非当前后端（buildConfigPreview 专门区分了两种情形）。 */
  const [configOpenFor, setConfigOpenFor] = useState<string | null>(null);
  const [runtimeConfigError, setRuntimeConfigError] = useState("");
  const [runtimeConfigDraft, setRuntimeConfigDraft] = useState<{
    providerId: string;
    values: Record<string, string>;
  } | null>(null);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const now = useNow(30_000);
  /* 历史导入不再自立分节，它的三个节点由「运行观测」就地安放；因此这个
     hook 必须在任何提前 return 之前跑完，键里的字段此刻都已可读。 */
  const historyImport = useHistoryMemoryImport(
    `${settings?.memory.enabled}:${settings?.memory.sharingMode}:${status?.health}`
  );

  useEffect(() => {
    settingsStore.ensureLoaded();
    memoryStore.ensureLoaded();
  }, []);

  if (!settings || !status || providers.length === 0) {
    return (
      <PageShell title={t("common.memory")} icon={<BrainCircuit />}>
        <SettingsCanvas>
          <Skeleton className="h-32 w-full rounded-lg" />
        </SettingsCanvas>
      </PageShell>
    );
  }

  const providerId = settings.memory.provider;
  const descriptor = providers.find((item) => item.id === providerId);
  if (!descriptor) {
    return (
      <PageShell title={t("common.memory")} icon={<BrainCircuit />}>
        <SettingsCanvas>
          <p role="alert" className="text-destructive text-sm">
            {t("memory.page.providerMissing", { provider: providerId })}
          </p>
        </SettingsCanvas>
      </PageShell>
    );
  }
  const runtime = runtimes[descriptor.id] ?? null;
  const gateOpen = Boolean(
    runtime?.installed && runtime.phase === "idle" && runtime.serviceReachable
  );
  /* 一档引擎能不能被选中，只看它自己：装好、空闲、握手可达。三条不满足
     哪一条，那一档的状态与语气会自己说，圈不必再兼职解释。 */
  const selectable = (id: string) => {
    const snapshot = runtimes[id] ?? null;
    return Boolean(
      snapshot?.installed &&
        snapshot.phase === "idle" &&
        snapshot.serviceReachable
    );
  };
  const panelOf = (id: string) => {
    const provider = providers.find((item) => item.id === id);
    return (
      panels.find((item) => item.panelId === provider?.configPanelId) ?? null
    );
  };
  const valuesFor = (id: string) => ({
    ...blankMemoryConfigValues(panelOf(id)),
    ...(runtimeConfigDraft?.providerId === id ? runtimeConfigDraft.values : {}),
  });

  /* ── 这一页此刻是设置还是初次设置 ───────────────────────────────
     判据是磁盘事实，不是本地游标：只要还没有任何一档「装好且过了配置关」，
     这一页就只有三步。装到一半关掉 App 再回来，快照说到哪就还在哪。 */
  const setupDone = providers.some((item) => {
    const snapshot = runtimes[item.id];
    return Boolean(snapshot?.installed && snapshot.configured);
  });

  const submitRuntimeConfig = (id: string) => {
    const values = valuesFor(id);
    setRuntimeConfigBusy(true);
    setRuntimeConfigError("");
    void memoryStore
      .previewRuntimeConfig(id, values)
      .then(async (preview) => {
        if (preview.requiresConfirmation) {
          setPendingRuntimeConfig({ kind: "write", values, preview });
          setConfigOpenFor(null);
          return;
        }
        const ok = await memoryStore.writeRuntimeConfig(id, values);
        if (ok) {
          setRuntimeConfigDraft(null);
          setConfigOpenFor(null);
          return;
        }
        setRuntimeConfigError(
          memoryStore.getSnapshot().error ||
            t("memory.runtime.configSaveFailed")
        );
      })
      .catch((cause) =>
        setRuntimeConfigError(
          errorMessage(cause, t("memory.runtime.configSaveFailed"))
        )
      )
      .finally(() => setRuntimeConfigBusy(false));
  };

  const setEnabled = () => {
    if (settings.memory.enabled) {
      if (!settings.memory.paused) {
        setPauseConfirmOpen(true);
        return;
      }
      void settingsStore.mutateMemory(
        { kind: "set-paused", paused: false },
        t("memory.page.resumeFailed")
      );
      return;
    }
    consent.openProvider(settings.memory.provider);
  };
  /* 顶部摘要与引擎行的结论同源：两处各判一次健康，迟早各说各话。 */
  const master = memoryMasterRow(settings.memory, status, gateOpen, (key, options) =>
    t(key, options)
  );
  const needsAttention = memoryServiceNeedsAttention(
    settings.memory,
    status,
    gateOpen
  );
  const sharingAvailable = Boolean(
    settings.memory.enabled && status.target?.canEnable && gateOpen && !loading
  );
  const sharingDisabledReason = !settings.memory.enabled
    ? t("memory.sharing.disabledMemory")
    : status.target?.blockedReason || t("memory.sharing.disabledTarget");

  const openUninstall = (id: string) => {
    void memoryStore
      .requestDestructiveAuthority(id, "uninstall")
      .then((authority) => {
        if (!authority) return;
        setUninstallTarget(id);
        setUninstallAuthority(authority);
        setUninstallOpen(true);
      });
  };

  const configPanel = configOpenFor ? panelOf(configOpenFor) : null;
  const runtimeConfigValues = configOpenFor ? valuesFor(configOpenFor) : {};

  const renderManage = (id: string) => {
    const snapshot = runtimes[id] ?? null;
    const provider = providers.find((item) => item.id === id);
    if (!snapshot || !provider) return null;
    return (
      <MemoryRuntimePanel
        key={`${id}:${provider.configPanelId ?? "none"}`}
        descriptor={provider}
        runtime={snapshot}
        stance={memoryRuntimeStance(snapshot)}
        panel={panelOf(id)}
        target={id === descriptor.id ? status.target : null}
        onInstall={() => memoryStore.runRuntimeOperation(id, "install")}
        onRepair={() => memoryStore.runRuntimeOperation(id, "repair")}
        onUpgrade={() => memoryStore.runRuntimeOperation(id, "upgrade")}
        onListVersions={() => memoryStore.listVersions(id)}
        onSwitchVersion={(version) =>
          memoryStore.runRuntimeOperation(id, "switch-version", version)
        }
        onUninstall={() => openUninstall(id)}
        onConfigure={() => {
          if (runtimeConfigDraft?.providerId !== id) {
            setRuntimeConfigError("");
          }
          setRuntimeConfigDraft((current) =>
            current?.providerId === id
              ? current
              : { providerId: id, values: blankMemoryConfigValues(panelOf(id)) }
          );
          setConfigOpenFor(id);
        }}
        onResolveConfigIssue={(issue, action) => {
          setRuntimeConfigBusy(true);
          void memoryStore
            .previewConfigIssue(issue, action)
            .then((preview) => {
              if (preview.requiresConfirmation) {
                setPendingRuntimeConfig({
                  kind: "issue",
                  issue,
                  action,
                  preview,
                });
                return;
              }
              return memoryStore.resolveConfigIssue(issue, action);
            })
            .catch(() => undefined)
            .finally(() => setRuntimeConfigBusy(false));
        }}
        onRecheck={() => void memoryStore.recheckRuntime(id)}
      />
    );
  };

  return (
    <PageShell
      title={t("common.memory")}
      icon={<BrainCircuit />}
      actions={
        <SettingsIconButton
          variant="ghost"
          label={t("memory.page.refreshHealth")}
          disabled={loading || !runtime?.installed || !settings.memory.enabled}
          onClick={memoryStore.refresh}
        >
          <RefreshCw className={loading ? "motion-safe:animate-spin" : ""} />
        </SettingsIconButton>
      }
    >
      <SettingsCanvas>
        {!setupDone ? (
          <MemorySetup
            descriptors={providers}
            runtimes={runtimes}
            panels={panels}
            selectedId={setupEngineId}
            onSelectEngine={setSetupEngineId}
            onInstall={(id) => {
              setSetupEngineId(id);
              void memoryStore.runRuntimeOperation(id, "install");
            }}
            getConfigValues={valuesFor}
            configBusy={runtimeConfigBusy}
            configError={runtimeConfigError}
            onConfigChange={(providerId, values) => {
              setRuntimeConfigError("");
              setRuntimeConfigDraft({
                providerId,
                values,
              });
            }}
            onConfigSubmit={submitRuntimeConfig}
          />
        ) : (
          /* 纵向秩序 = 决定的顺序：要不要记 → 用哪个引擎、怎么管它
             → 记的东西谁能召回 → 它在干什么。 */
          <div className="space-y-8">
            {/* 一级：整页唯一的产品级开关。它只说记不记——用哪个引擎是
                下面那一段自己的事，同一批引擎不在一页里列两遍。 */}
            <SettingsSection
              title={t("memory.page.title")}
              description={master.detail ?? t("memory.page.description")}
              alert={settingsError || error || status.warning}
              action={
                <SettingsSwitch
                  id="memory-enabled"
                  label={master.switchLabel}
                  checked={master.switchChecked}
                  disabled={loading || master.switchDisabled}
                  onToggle={setEnabled}
                />
              }
            >
              {/* apply 失败不是一次性 toast：磁盘新、runtime 旧的窗口必须
                  一直可见，直到前向重试把它收敛掉。 */}
              {status.applyStatus?.state === "failed" && (
                <div
                  role="alert"
                  className={cn(
                    "rounded-lg px-4 py-3 text-xs ring-1",
                    TONE_SURFACE.danger
                  )}
                >
                  <p className={cn("font-medium", TONE_TEXT.danger)}>
                    {t("memory.page.applyFailedTitle")}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {status.applyStatus.message ??
                      t("memory.page.applyFailedFallback")}
                    · {t("memory.page.applyRetrying")}
                  </p>
                </div>
              )}
            </SettingsSection>

            {/* 二级：引擎册。选哪个在用、升级、配置、装另一个，全在这一处。 */}
            <SettingsSection
              title={t("memory.engines.title")}
              description={t("memory.engines.description")}
              action={
                <Button
                  type="button"
                  size="pill"
                  variant="ghost"
                  disabled={providers.some((item) => checkingUpdates[item.id])}
                  onClick={() => {
                    for (const item of providers) {
                      if (runtimes[item.id]?.installed)
                        void memoryStore.checkUpdates(item.id, true);
                    }
                  }}
                >
                  <RefreshCw
                    className={
                      providers.some((item) => checkingUpdates[item.id])
                        ? "motion-safe:animate-spin"
                        : ""
                    }
                  />
                  {t("memory.version.check")}
                </Button>
              }
            >
              <SettingsList>
                <MemoryEngineList
                  descriptors={providers}
                  runtimes={runtimes}
                  currentId={descriptor.id}
                  currentFacts={{
                    enabled: settings.memory.enabled,
                    health: status.health,
                    healthIssue: status.healthIssue,
                    target: status.target,
                    runningVersion: status.runningVersion,
                  }}
                  openId={openEngineId}
                  lockedId={needsAttention ? descriptor.id : null}
                  onOpenChange={setOpenEngineId}
                  onSelect={consent.openProvider}
                  canSelect={selectable}
                  renderManage={renderManage}
                />
              </SettingsList>
            </SettingsSection>

            {/* 三态就画三选一：后端存的本来就是一个枚举（main 的
                assertMemoryMutation 只收 sharingMode）。禁用原因归段描述
                说一次，不逐行复述。 */}
            <SettingsSection
              title={t("memory.sharing.title")}
              description={
                sharingAvailable
                  ? t("memory.sharing.description")
                  : sharingDisabledReason
              }
            >
              <SettingsList
                role="radiogroup"
                aria-label={t("memory.sharing.title")}
              >
                {MEMORY_SHARING_MODES.map((mode) => (
                  <SettingsChoiceRow
                    key={mode}
                    label={t(`memory.sharing.mode.${mode}`)}
                    description={t(`memory.sharing.isolation.${mode}`)}
                    checked={settings.memory.sharingMode === mode}
                    disabled={!sharingAvailable}
                    onSelect={() => {
                      /* 选中当前档不是一次变更：确认弹窗只为真的换代而开。 */
                      if (mode !== settings.memory.sharingMode)
                        consent.openSharing(mode);
                    }}
                  />
                ))}
              </SettingsList>
            </SettingsSection>

            {/* 两个入口都挂在它们所改变的那片数字的段头上，而不是各自另立
                一节「标题 + 描述 + 一个按钮」的门户；进度也就地接替按钮。
                导入填充这片数字，重建清空它——一对反向动作，排序按后果给：
                不可逆的那个在右。 */}
            {(gateOpen || settings.memory.enabled) && (
              <SettingsSection
                title={t("memory.page.observability")}
                description={status.epoch
                  ? t("memory.page.observabilityEpoch", {
                      date: new Date(status.epoch.effectiveAt).toLocaleDateString(
                        intlLocale()
                      ),
                      generation: status.epoch.sharingGeneration,
                    })
                  : t("memory.page.observabilityDescription")}
                alert={historyImport.alert}
                action={
                  <div className="flex items-center gap-2">
                    {historyImport.action}
                    {status.target?.canRebuild ? (
                      <MemoryRebuildButton
                        running={rebuildOutstanding(status.rebuild)}
                        onClick={() => {
                          void Promise.all([
                            memoryStore.requestDestructiveAuthority(
                              descriptor.id,
                              "rebuild"
                            ),
                            memoryStore.previewConsent(
                              descriptor.id,
                              true,
                              "rebuild",
                              settings.memory.sharingMode
                            ),
                          ])
                            .then(([authority, preview]) => {
                              if (!authority) return;
                              setRebuildAuthority(authority);
                              setRebuildPreview(preview);
                              setRebuildOpen(true);
                            })
                            .catch(() => undefined);
                        }}
                      />
                    ) : null}
                  </div>
                }
              >
                {/* 完成的重建不再留着一张卡：做完的事退回观测格成为一条带
                    时刻的往事，只有还在跑或已中断的才配继续占着这块表面。 */}
                <div className="space-y-2">
                  {status.recallWarning && (
                    <div
                      role="alert"
                      className={cn(
                        "rounded-lg px-4 py-3 text-xs ring-1",
                        TONE_SURFACE.warn
                      )}
                    >
                      <p className={cn("font-medium", TONE_TEXT.warn)}>
                        {t("memory.page.recallWarningTitle")}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {status.recallWarning}
                      </p>
                    </div>
                  )}
                  <MemoryActivityGrid status={status} now={now} />
                  <MemorySupplyList status={status} />
                  {rebuildOutstanding(status.rebuild) && status.rebuild && (
                    <MemoryRebuildProgress rebuild={status.rebuild} />
                  )}
                </div>
              </SettingsSection>
            )}

            {/* attention 有货必须可见（M4-06）：徽标点进来不许是空白页。 */}
            {status.attention.length > 0 && (
              <SettingsSection
                title={t("memory.page.attentionTitle")}
                description={t("memory.page.attentionDescription")}
              >
                <MemoryAttentionList
                  items={status.attention}
                  now={now}
                  onResolve={memoryStore.resolve}
                />
              </SettingsSection>
            )}
          </div>
        )}
      </SettingsCanvas>

      <MemoryDisclosureDialog
        open={consent.intent !== null}
        onOpenChange={consent.setOpen}
        providerName={
          providers.find((item) => item.id === consent.intent?.providerId)
            ?.displayName ??
          descriptor.displayName
        }
        previousProviderName={
          consent.intent?.reason === "cutover"
            ? descriptor.displayName
            : undefined
        }
        reason={consent.intent?.reason ?? "enable"}
        preview={consent.preview}
        includeHistory={consent.includeHistory}
        onIncludeHistoryChange={consent.setIncludeHistory}
        historyDisabled={settings.memory.paused}
        busy={consent.busy}
        error={consent.error}
        onAccept={() => {
          /* 换代成功即收起：选完了，这一档就该退回一行结论。 */
          void consent.accept().then(() => setOpenEngineId(null));
        }}
      />

      {/* 导入的确认弹窗与它的按钮隔着一整棵树，但 Portal 让位置无关紧要；
          它与「重建记忆」的弹窗并排，因为两者是同一族的不可逆动作。 */}
      {historyImport.dialog}

      <MemoryRebuildDialog
        open={rebuildOpen}
        onOpenChange={(open) => {
          setRebuildOpen(open);
          if (!open) {
            setRebuildAuthority(null);
            setRebuildPreview(null);
          }
        }}
        providerName={
          providers.find((item) => item.id === rebuildAuthority?.providerId)
            ?.displayName ?? descriptor.displayName
        }
        preview={rebuildPreview}
        paused={settings.memory.paused}
        resetsManagedConfig={
          (providers.find((item) => item.id === rebuildAuthority?.providerId) ??
            descriptor
          ).purgeModel === "runtime-reset"
        }
        onConfirm={() => {
          setRebuildOpen(false);
          const authority = rebuildAuthority;
          setRebuildAuthority(null);
          setRebuildPreview(null);
          if (authority) {
            void memoryStore.consumeDestructiveAuthority(authority.token);
          }
        }}
      />

      <MemoryUninstallDialog
        open={uninstallOpen}
        onOpenChange={(open) => {
          setUninstallOpen(open);
          if (!open) {
            setUninstallAuthority(null);
            setUninstallTarget(null);
          }
        }}
        providerName={
          providers.find((item) => item.id === uninstallTarget)?.displayName ??
          descriptor.displayName
        }
        onConfirm={() => {
          setUninstallOpen(false);
          const authority = uninstallAuthority;
          setUninstallAuthority(null);
          setUninstallTarget(null);
          if (authority) {
            void memoryStore.consumeDestructiveAuthority(authority.token);
          }
        }}
      />

      {configPanel && configOpenFor && (
        <MemoryRuntimeConfigDialog
          open={runtimeConfigDraft?.providerId === configOpenFor}
          panel={configPanel}
          values={runtimeConfigValues}
          busy={runtimeConfigBusy}
          error={runtimeConfigError}
          requireMissingValues={Boolean(
            runtimes[configOpenFor]?.installed &&
              !runtimes[configOpenFor]?.configured
          )}
          onOpenChange={(next) => setConfigOpenFor(next ? configOpenFor : null)}
          onChange={(values) => {
            setRuntimeConfigError("");
            setRuntimeConfigDraft({ providerId: configOpenFor, values });
          }}
          onSubmit={() => submitRuntimeConfig(configOpenFor)}
        />
      )}

      <ConfirmationDialog
        open={pendingRuntimeConfig !== null}
        title={t("memory.page.configTitle")}
        description={
          pendingRuntimeConfig ? (
            <div className="space-y-2 text-left">
              <p>{t("memory.page.configChange", {
                currentHostname: pendingRuntimeConfig.preview.currentHostname,
                currentModel: pendingRuntimeConfig.preview.currentModel,
                nextHostname: pendingRuntimeConfig.preview.nextHostname,
                nextModel: pendingRuntimeConfig.preview.nextModel,
              })}</p>
              <p>{t("memory.page.configDisclosure")}</p>
              {pendingRuntimeConfig.kind === "write" && runtimeConfigError && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-destructive"
                >
                  {runtimeConfigError}
                </p>
              )}
            </div>
          ) : null
        }
        confirmLabel={t("memory.page.configConfirm")}
        cancelLabel={t("common.cancel")}
        busy={runtimeConfigBusy}
        onOpenChange={(open) => {
          if (!open && !runtimeConfigBusy) setPendingRuntimeConfig(null);
        }}
        onConfirm={() => {
          const pending = pendingRuntimeConfig;
          if (!pending) return;
          setRuntimeConfigBusy(true);
          const operation = pending.kind === "write"
            ? memoryStore
                .requestRuntimeConfigAuthority(
                  pending.preview.providerId,
                  pending.values,
                  pending.preview.digest
                )
                .then((authority) =>
                  memoryStore.writeRuntimeConfig(
                    pending.preview.providerId,
                    pending.values,
                    authority.token
                  )
                )
            : memoryStore
                .requestConfigIssueAuthority(
                  pending.issue,
                  pending.action,
                  pending.preview.digest
                )
                .then((authority) =>
                  memoryStore.resolveConfigIssue(
                    pending.issue,
                    pending.action,
                    authority.token
                  )
                );
          void operation
            .then((ok) => {
              if (ok) {
                if (pending.kind === "write") {
                  setRuntimeConfigDraft(null);
                  setRuntimeConfigError("");
                }
                setPendingRuntimeConfig(null);
                return;
              }
              if (pending.kind === "write") {
                setRuntimeConfigError(
                  memoryStore.getSnapshot().error ||
                    t("memory.runtime.configSaveFailed")
                );
              }
            })
            .catch(() => undefined)
            .finally(() => setRuntimeConfigBusy(false));
        }}
      />

      <ConfirmationDialog
        open={pauseConfirmOpen}
        onOpenChange={setPauseConfirmOpen}
        title={t("memory.page.pauseTitle")}
        description={t("memory.page.pauseDescription")}
        confirmLabel={t("memory.page.pauseConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          setPauseConfirmOpen(false);
          void settingsStore.mutateMemory(
            { kind: "set-paused", paused: true },
            t("memory.page.pauseFailed")
          );
        }}
      />
    </PageShell>
  );
}
