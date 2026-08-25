/**
 * [INPUT]: Depends on React, shared Memory/AppSettings Compatibility with MEMORY_SHARING_MODES, application Intl locale, view-local Consent/history importing state machine, settings/memory stores, memoryMasterRow derived from memoryServiceNeedsAttention, running configuration/destructive capability with Settings
 * [OUTPUT]: Provides MemorySettingsView: A card loads "remember not" with a secondary "where to save" below it, sharing the range, explicit historical import, application language age dates, observing and hanging; All changes confirmed, suspended, restored, failed to maintain configuration and rebuilt unloaded as of
 * [POS]: Settings › Memory product control panel; In the order of the order in which it is decided, the user intends to go only through Memory, specifically mutation, and execute the fact only read main-owned snapshots
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { MemoryActivityGrid } from "@/components/settings/memory/memory-activity-grid";
import { MemoryAttentionList } from "@/components/settings/memory/memory-attention-list";
import { MemoryDisclosureDialog } from "@/components/settings/memory/memory-disclosure-dialog";
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
import { MemoryServicePicker } from "@/components/settings/memory/memory-service-picker";
import { MemorySupplyList } from "@/components/settings/memory/memory-supply-list";
import {
  SettingsCanvas,
  SettingsChoiceRow,
  SettingsList,
  SettingsRow,
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
import { HistoryMemoryImportAction } from "./settings-memory/history-import-action";
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
  /* 服务档摊开与否，只有「用户自己掀开的」这一个自由度。要不要强制
     摊开由 memoryServiceNeedsAttention 说了算，两者 or 在一起——于是
     不存在「用户收起了一件坏掉的东西」这种状态可言。 */
  const [serviceOpened, setServiceOpened] = useState(false);
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
  /* 配置弹窗开给谁：每一档服务都有自己的配置入口，main 本来就允许配置
     一个非当前后端（buildConfigPreview 专门区分了两种情形）。 */
  const [configOpenFor, setConfigOpenFor] = useState<string | null>(null);
  const [runtimeConfigError, setRuntimeConfigError] = useState("");
  const [runtimeConfigDraft, setRuntimeConfigDraft] = useState<{
    providerId: string;
    values: Record<string, string>;
  } | null>(null);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const now = useNow(30_000);

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
  /* 一档服务能不能被选中，只看它自己：装好、空闲、握手可达。三条不满足
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
  /* 顶部摘要与服务档的结论同源：两处各判一次健康，迟早各说各话。 */
  const master = memoryMasterRow(settings.memory, status, gateOpen, (key, options) =>
    t(key, options)
  );
  const needsAttention = memoryServiceNeedsAttention(
    settings.memory,
    status,
    gateOpen
  );
  const serviceOpen = serviceOpened || needsAttention;
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
  const runtimeConfigValues = {
    ...blankMemoryConfigValues(configPanel),
    ...(runtimeConfigDraft?.providerId === configOpenFor
      ? runtimeConfigDraft.values
      : {}),
  };

  return (
    <PageShell
      title={t("common.memory")}
      icon={<BrainCircuit />}
      actions={
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={t("memory.page.refreshHealth")}
          disabled={loading || !runtime?.installed || !settings.memory.enabled}
          onClick={memoryStore.refresh}
        >
          <RefreshCw className={loading ? "motion-safe:animate-spin" : ""} />
        </Button>
      }
    >
      <SettingsCanvas>
        {/* 纵向秩序 = 决定的顺序：要不要记 → 存哪儿 → 记的东西谁能召回
            → 它在干什么。前两件同处一张卡，因为它们是父子而不是兄弟：
            provider 在 settings.memory 里就是 enabled 隔壁的一个字段，
            画成两张并排的卡，视觉语言就把父子说成了兄弟。 */}
        <div className="space-y-8">
          <SettingsSection
            title={t("memory.page.title")}
            description={t("memory.page.description")}
            alert={settingsError || error || status.warning}
          >
            <div className="space-y-3">
              <SettingsList>
                {/* 一级：整页唯一的产品级开关。它只说记不记——用哪个后端
                    是下面那个子项自己的事，同一个名词不在一张卡里说两次。 */}
                <SettingsRow
                  label={master.label}
                  htmlFor="memory-enabled"
                  description={master.detail}
                  control={
                    <SettingsSwitch
                      id="memory-enabled"
                      label={master.switchLabel}
                      checked={master.switchChecked}
                      disabled={loading || master.switchDisabled}
                      onToggle={setEnabled}
                    />
                  }
                />
                {/* 二级：存哪儿。二态枚举画成二选一而不是页签——页签点一下
                    免费且可逆，换服务点一下要签字且回不去。 */}
                <MemoryServicePicker
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
                  open={serviceOpen}
                  locked={needsAttention}
                  onOpenChange={setServiceOpened}
                  onSelect={consent.openProvider}
                  canSelect={selectable}
                  renderRuntime={(id) => {
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
                        onInstall={() =>
                          memoryStore.runRuntimeOperation(id, "install")
                        }
                        onRepair={() =>
                          memoryStore.runRuntimeOperation(id, "repair")
                        }
                        onUpgrade={() =>
                          memoryStore.runRuntimeOperation(id, "upgrade")
                        }
                        onCheckUpdates={() => {
                          void memoryStore.checkUpdates(id, true);
                        }}
                        onListVersions={() => memoryStore.listVersions(id)}
                        onSwitchVersion={(version) =>
                          memoryStore.runRuntimeOperation(
                            id,
                            "switch-version",
                            version
                          )
                        }
                        checkingUpdates={Boolean(checkingUpdates[id])}
                        onUninstall={() => openUninstall(id)}
                        onConfigure={() => {
                          if (runtimeConfigDraft?.providerId !== id) {
                            setRuntimeConfigError("");
                          }
                          setRuntimeConfigDraft((current) =>
                            current?.providerId === id
                              ? current
                              : {
                                  providerId: id,
                                  values: blankMemoryConfigValues(panelOf(id)),
                                }
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
                  }}
                />
              </SettingsList>

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
            </div>
          </SettingsSection>

          {/* 三态就画三选一：后端存的本来就是一个枚举（main 的
              assertMemoryMutation 只收 sharingMode），两个联动开关是界面
              自己发明的。禁用原因归段描述说一次，不逐行复述。 */}
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

          <HistoryMemoryImportAction
            refreshKey={`${settings.memory.enabled}:${settings.memory.sharingMode}:${status.health}`}
          />

          {/* 重建入口挂在它所清空的那片数字的段头上，而不是另立一节
              「标题 + 描述 + 一个按钮」的门户；进度也就地接替按钮。 */}
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
              action={
                status.target?.canRebuild ? (
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
                ) : undefined
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
          void consent.accept().then(() => setServiceOpened(false));
        }}
      />

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
          requireMissingValues={
            runtimes[configOpenFor]?.phase === "configuration-required"
          }
          onOpenChange={(next) => setConfigOpenFor(next ? configOpenFor : null)}
          onChange={(values) => {
            setRuntimeConfigError("");
            setRuntimeConfigDraft({ providerId: configOpenFor, values });
          }}
          onSubmit={() => {
            const values = runtimeConfigValues;
            setRuntimeConfigBusy(true);
            setRuntimeConfigError("");
            void memoryStore
              .previewRuntimeConfig(configOpenFor, values)
              .then(async (preview) => {
                if (preview.requiresConfirmation) {
                  setPendingRuntimeConfig({ kind: "write", values, preview });
                  setConfigOpenFor(null);
                  return;
                }
                const ok = await memoryStore.writeRuntimeConfig(
                  configOpenFor,
                  values
                );
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
          }}
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
