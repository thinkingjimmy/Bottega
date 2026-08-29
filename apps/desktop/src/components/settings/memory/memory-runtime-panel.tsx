/**
 * [INPUT]: Depends on React hooks, lucide icons, shared MemoryRuntimeSnapshot/descriptor/target/config-panel agreement, settings-layout SettingsButton/SettingsIconButton/SettingsAlert, MemoryVersionPicker, reveal IPC, i18n and Dialog/Input/Button from @ai-chat/ui
 * [OUTPUT]: Provides MemoryRuntimePanel (the per-engine management drawer: alerts, live operation progress, then either the install pitch or Version/Extraction model/Runtime rows with data-location beside version selection, refresh first in runtime controls, and confirmation before healthy-state repair; plus logs/version/config dialogs), MemoryRuntimeConfigDialog, MemoryUninstallDialog and blankMemoryConfigValues
 * [POS]: settings/memory 引擎抽屉的正文。它只画一个引擎的处境与动作；选哪个在用归 memory-engine-list，产品级开关归视图
 */

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type {
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryConfigPanel,
  MemoryEffectiveTarget,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
  MemoryRuntimeVersionsResult,
} from "../../../../shared/memory-ipc";
import {
  SettingsAlert,
  SettingsButton,
  SettingsIconButton,
} from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import type { MemoryRuntimeStance } from "@/lib/memory-view";
import { revealMemoryDataRoot } from "@/lib/memory-client";
import {
  AppDialogBody,
  AppDialogContent,
  ConfirmationDialog,
} from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ai-chat/ui/components/ui/dialog";
import { Input } from "@ai-chat/ui/components/ui/input";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { MemoryVersionPicker } from "./memory-version-picker";

export const blankMemoryConfigValues = (panel: MemoryConfigPanel | null) =>
  Object.fromEntries((panel?.fields ?? []).map((field) => [field.key, ""]));

/* ============================================================
 * 属性行：左边一个名词，右边一排动作。
 *
 * 从前这块是一排平铺的按钮——配置、修复、选版本、升级、检查更新、
 * 发布说明、重新检测、卸载，八颗同尺寸同权重挤在一行里 flex-wrap。
 * 一排里没有主次，就等于没有入口：每次要动手都得先把八个标签读一遍。
 * 而版本号在那一版里出现了三次（头部一次、事实带一次、按钮上一次），
 * 三处还各自可能不同步。
 *
 * 现在按「关心什么」分三行：版本、提取模型、运行时。每行只有一颗带
 * 文字的按钮——那是这一行此刻最该做的事；其余降成纯图标，边框、高度、
 * 圆角与文字按钮同源（SettingsIconButton），所以一排读起来仍是一族，
 * 主次却由「有没有文字」一眼分得开。
 *
 * key 顶对齐到 value 第一行：value 常有两行（值 + 注解），若让 key 垂直
 * 居中，它就飘在两行中间，与自己解释的那个值错开一截。动作反而居中，
 * 因为它对齐的是整行的重心而不是某一行文字。
 * ============================================================ */

/* ============================================================
 * 运行进度：分段条 + 步骤名 + 计时，模型传输就地填进当前那一段。
 *
 * 从前模型下载另起一条独占的进度条挂在分段条下面。两条平行的条读起来
 * 像两件事在同时发生，而它其实是「第几步」里那一步自己的细粒度进度。
 * 让它回到所在的段里去填充，字节数落在说明行——一条条，一个意思。
 *
 * 它在设置抽屉与初次设置第二步各出现一次，故是一个组件而不是两段
 * 长得差不多的 JSX：进度条一旦有两份实现，迟早一份先学会新状态。
 * ============================================================ */

export function MemoryOperationProgress({
  runtime,
  stepText,
}: {
  runtime: MemoryRuntimeSnapshot;
  stepText: string | null;
}) {
  const { t } = useAppTranslation();
  const [now, setNow] = useState(() => Date.now());
  const running = runtime.phase === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running, runtime.operationStartedAt]);
  const elapsed = runtime.operationStartedAt
    ? Math.max(0, Math.floor((now - runtime.operationStartedAt) / 1_000))
    : 0;
  return (
    <div className="space-y-2">
      {running && runtime.stepTotal > 0 && (
        <div
          data-testid="memory-runtime-progress"
          className="flex gap-1"
          aria-label={t("memory.runtime.steps", {
            current: runtime.stepIndex,
            total: runtime.stepTotal,
          })}
        >
          {Array.from({ length: runtime.stepTotal }, (_, index) => {
            const done = index < runtime.stepIndex;
            const active = index === runtime.stepIndex;
            const ratio =
              active && runtime.transfer && runtime.transfer.totalBytes
                ? Math.min(
                    1,
                    runtime.transfer.receivedBytes / runtime.transfer.totalBytes
                  )
                : 0;
            return (
              <span
                key={index}
                data-complete={done}
                className={cn(
                  "relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted",
                  done && "bg-foreground"
                )}
              >
                {active && runtime.transfer && (
                  <span
                    data-testid="memory-runtime-transfer"
                    role="progressbar"
                    aria-label={t("memory.runtime.modelTransferAria")}
                    aria-valuemin={0}
                    aria-valuemax={runtime.transfer.totalBytes}
                    aria-valuenow={runtime.transfer.receivedBytes}
                    className="absolute inset-y-0 left-0 origin-left rounded-full bg-foreground motion-safe:transition-transform"
                    style={{ transform: `scaleX(${ratio})` }}
                  />
                )}
              </span>
            );
          })}
        </div>
      )}
      <div className="text-muted-foreground text-xs">
        {running ? (
          <>
            {stepText ?? t("memory.runtime.preparing")} ·{" "}
            <span className="tabular-nums">
              {new Intl.NumberFormat(intlLocale(), {
                style: "unit",
                unit: "second",
                unitDisplay: "narrow",
              }).format(elapsed)}
            </span>
          </>
        ) : (
          t("memory.runtime.preparing")
        )}
      </div>
      {/* 没有步骤可分段时（stepTotal 为 0），传输自己就是唯一的进度，
          于是它独占一条。两条条永远不会同时出现：有段就填段，没段才自立。 */}
      {running && runtime.transfer && runtime.stepTotal === 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          {/* 进度条的身份挂在**填充**那一层，与分段态一致：两处若一处挂在
              轨道、一处挂在填充，读它的人（与测试）就得先分辨自己拿到的
              是哪一种。 */}
          <div
            data-testid="memory-runtime-transfer"
            role="progressbar"
            aria-label={t("memory.runtime.modelTransferAria")}
            aria-valuemin={0}
            aria-valuemax={runtime.transfer.totalBytes}
            aria-valuenow={runtime.transfer.receivedBytes}
            className="h-full origin-left rounded-full bg-foreground motion-safe:transition-transform"
            style={{
              transform: `scaleX(${Math.min(
                1,
                runtime.transfer.totalBytes
                  ? runtime.transfer.receivedBytes / runtime.transfer.totalBytes
                  : 0
              )})`,
            }}
          />
        </div>
      )}
      {running && runtime.transfer && (
        <p className="text-muted-foreground text-xs tabular-nums">
          {t("memory.runtime.modelTransfer", {
            received: (runtime.transfer.receivedBytes / 1024 / 1024).toFixed(1),
            total: (runtime.transfer.totalBytes / 1024 / 1024).toFixed(1),
          })}
          {runtime.transfer.recovered
            ? ` · ${t("memory.runtime.modelRecovered")}`
            : ""}
        </p>
      )}
      {running && (
        <p className="text-muted-foreground text-xs">
          {t("memory.runtime.downloadHint")}
        </p>
      )}
    </div>
  );
}

function ManageRow({
  label,
  value,
  detail,
  actions,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 py-3.5">
      <div className="w-28 shrink-0 pt-px font-medium text-muted-foreground text-xs leading-normal">
        {label}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] leading-normal">{value}</div>
          {detail && (
            <p className="mt-0.5 text-muted-foreground text-xs leading-normal">
              {detail}
            </p>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 self-center">
          {actions}
        </div>
      </div>
    </div>
  );
}

export function MemoryRuntimePanel({
  descriptor,
  runtime,
  stance,
  panel,
  target,
  onInstall,
  onRepair,
  onUpgrade,
  onListVersions,
  onSwitchVersion,
  onUninstall,
  onConfigure,
  onResolveConfigIssue,
  onRecheck,
}: {
  descriptor: MemoryProviderDescriptor;
  runtime: MemoryRuntimeSnapshot;
  /** 决定这块在说什么：托管在跑 / 什么都没有。 */
  stance: MemoryRuntimeStance;
  panel: MemoryConfigPanel | null;
  /** 只有正在用的那一档才有生效地址；其余回落到 descriptor 的默认地址。 */
  target?: MemoryEffectiveTarget | null;
  onInstall(): void;
  onRepair(): void;
  onUpgrade(): void;
  onListVersions(): Promise<MemoryRuntimeVersionsResult>;
  onSwitchVersion(version: string): Promise<unknown> | void;
  /** 打开卸载确认（对话框归调用方，与重建同一模式）。 */
  onUninstall(): void;
  onConfigure(): void;
  onResolveConfigIssue(issue: MemoryConfigIssue, action: MemoryConfigIssueAction): void;
  onRecheck(): void;
}) {
  const { t } = useAppTranslation();
  const running = runtime.phase === "running";
  const [logsRequestedOpen, setLogsRequestedOpen] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [listingVersions, setListingVersions] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [revealFailed, setRevealFailed] = useState(false);
  const [repairConfirmOpen, setRepairConfirmOpen] = useState(false);
  const versionRequest = useRef(0);
  const runtimeRef = useRef(runtime);
  const operationFocusRef = useRef<HTMLDivElement | null>(null);
  const logsOpen = Boolean(runtime.error) || logsRequestedOpen;
  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    runtimeRef.current = runtime;
  }, [runtime]);
  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [runtime.log.length, logsOpen]);
  /* 两个正交事实，从前被同一个 manual 判过：
     manual  = ov.conf 由谁写（configModes），只管配置披露与配置按钮；
     lockedTarget = 安装目标由谁定（versionSource），只管版本失配与升级。 */
  const manual = Object.values(runtime.configModes).includes("manual");
  const lockedTarget = runtime.versionSource === "locked";
  const switchInProgress = switching || runtime.operation === "switch-version";
  /* 判据是 configured 而不是 phase：写配置的那几秒 phase 是 running，
     拿它反推「还缺配置吗」，会在提交的一瞬间答成「已经配好了」。 */
  const needsConfig = runtime.installed && !runtime.configured;
  const hasInstallIdentity = runtime.installed || runtime.instanceId !== null;
  const mirrorWithoutMarker =
    runtime.installed && !runtime.instanceId && !runtime.ownershipMarkerPresent;
  const versionMismatch = lockedTarget && runtime.versionMatch === false;
  const yanked = Boolean(
    runtime.installedVersion &&
      runtime.yankedVersions?.includes(runtime.installedVersion)
  );
  /* 运行时是否需要动手：修复从图标升格为带文字的按钮，只在这几种情形。
     healthy 时它仍在场（扳手图标），但不该和「一切正常」抢注意力。 */
  const runtimeNeedsRepair = Boolean(
    hasInstallIdentity &&
      !needsConfig &&
      (runtime.error ||
        !runtime.serviceReachable ||
        !runtime.instanceId ||
        (!runtime.installed && runtime.instanceId))
  );

  /* main 只发步骤身份，这一句是它变成人话的唯一地方：context 命中
     `<kind>_<context>` 就用变体，缺席自动回落到 `<kind>`。 */
  const stepText = runtime.step
    ? t(`memory.runtime.step.${runtime.step.kind}`, {
        context: runtime.step.context,
        version: runtime.step.version ?? "",
      })
    : null;

  const listVersions = () => {
    const token = ++versionRequest.current;
    setListingVersions(true);
    setCatalogError(null);
    void onListVersions()
      .then((catalog) => {
        /* 被更新的一次请求取代：那一次自己会给出结局，这里
           沉默是对的——两个结局同时写进同一块状态才是错的。 */
        if (token !== versionRequest.current) return;
        const current = runtimeRef.current;
        /* 但 fence 命中不同：它意味着这份目录属于另一个 provider
           或另一个 revision，而不会再有第二个答案到来。无声 return
           会让按钮转完一圈又回到原样，读者只能猜自己是不是没点中。 */
        if (
          catalog.providerId !== descriptor.id ||
          current.revision > catalog.revision
        ) {
          setCatalogError(t("memory.version.listStale"));
          return;
        }
        setVersions(catalog.versions);
      })
      .catch(() => {
        if (token === versionRequest.current) {
          setCatalogError(t("memory.version.listFailed"));
        }
      })
      .finally(() => {
        if (token === versionRequest.current) setListingVersions(false);
      });
  };

  const versionActions = (
    <>
      {/* 一行里最多一颗实心/带文字的按钮，它是此刻最该做的事：
          装的不是锁定版就先归位，有新版就去目录里挑（目录会把降级、
          撤回、未验证三种警示当面说清，故这里不做「一键升到最新」）。 */}
      {versionMismatch && (
        <SettingsButton variant="outline" disabled={running} onClick={onUpgrade}>
          <Wrench />
          {t("memory.runtime.upgradeTo", { version: runtime.lockedVersion })}
        </SettingsButton>
      )}
      {runtime.versionCatalogSupported && (
        <MemoryVersionPicker
          runtime={runtime}
          providerName={descriptor.displayName}
          versions={versions}
          listing={listingVersions}
          catalogError={catalogError}
          /* 判据是 switchInProgress 而不是本地 switching：切换由运行时快照
             接手之后本地标志就落回 false，而那一刻它显然还在跑——按得动
             的入口意味着可以再挑一版压在正在装的那一版上。 */
          disabled={running || switchInProgress}
          prominent={runtime.updateAvailable && !versionMismatch}
          busy={switchInProgress}
          error={switchError}
          onOpen={listVersions}
          onDismiss={() => {
            setSwitchError(null);
            /* 切换在后台继续时，触发器已经变灰——焦点默认归还它就是掉进
               body。此刻该读的是那条真进度。 */
            if (switchInProgress) operationFocusRef.current?.focus();
          }}
          onConfirm={(version) => {
            setSwitching(true);
            setSwitchError(null);
            Promise.resolve(onSwitchVersion(version))
              .then((succeeded) => {
                if (succeeded === false) {
                  setSwitchError(t("memory.version.switchFailed"));
                }
              }, () => {
                setSwitchError(t("memory.version.switchFailed"));
              })
              .finally(() => setSwitching(false));
          }}
        />
      )}
      {runtime.dataRoot && (
        <SettingsIconButton
          label={t("memory.backend.dataLocation")}
          onClick={() => {
            setRevealFailed(false);
            void revealMemoryDataRoot(descriptor.id).catch(() => {
              setRevealFailed(true);
            });
          }}
        >
          <FolderOpen />
        </SettingsIconButton>
      )}
    </>
  );

  /* 卸载归运行时行，不归版本行。版本行问的是「装哪一版」，而卸载不是
     其中一个答案——它取消这个问题本身。它真正的邻居是修复：重新检测、
     修复、卸载，三者是同一条轴上依次加重的三步（免费重试 → 重装文件 →
     连同数据一起抹掉），空间顺序照着代价排。

     它不自带常驻警告：那段字每次开面板都喊一遍，等于把音量用在最不该
     常驻的地方。静止态是灰的，hover 才转红，严重性交给那道必经的卸载
     确认承担（它已写明「永久删除全部长期记忆数据」）。 */
  const uninstallAction = hasInstallIdentity ? (
    <SettingsIconButton
      label={t("memory.runtime.uninstallConfirm")}
      disabled={running}
      className="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
      onClick={onUninstall}
    >
      <Trash2 />
    </SettingsIconButton>
  ) : null;

  return (
    <div className="space-y-3">
      {!runtime.supported && (
        <SettingsAlert tone="warn">
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-px size-4 shrink-0" />
            {t("memory.runtime.unsupported")}
          </span>
        </SettingsAlert>
      )}
      {/* 版本失配是可用 + 警示，不是一票否决。但它只对「装的是当时的
          锁定版」成立：用户自选 0.4.16 之后，这条琥珀会永远挂着反对他
          自己刚做的选择。判据是 versionSource，与 configModes 无关。 */}
      {versionMismatch && (
        <SettingsAlert tone="warn">
          <span className="flex items-start gap-2">
            <TriangleAlert className="mt-px size-4 shrink-0" />
            {t("memory.runtime.versionMismatch", {
              installed: runtime.installedVersion,
              locked: runtime.lockedVersion,
            })}
          </span>
        </SettingsAlert>
      )}
      {runtime.error && (
        <SettingsAlert>
          {stepText ? t("memory.runtime.stepFailed", { step: stepText }) : ""}
          {runtime.error}
        </SettingsAlert>
      )}
      {runtime.configIssue && (
        <div
          role="alert"
          className="space-y-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs ring-1 ring-amber-500/20"
        >
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("memory.runtime.configModified", {
              file: runtime.configIssue.file,
            })}
          </p>
          <p className="text-muted-foreground">
            {t("memory.runtime.configModifiedDetail")}
          </p>
          <div className="flex flex-wrap gap-2">
            <SettingsButton
              variant="outline"
              disabled={running}
              onClick={() => onResolveConfigIssue(runtime.configIssue!, "regenerate")}
            >
              {t("memory.runtime.regenerate")}
            </SettingsButton>
            <SettingsButton
              variant="ghost"
              disabled={running}
              onClick={() => onResolveConfigIssue(runtime.configIssue!, "adopt-manual")}
            >
              {t("memory.runtime.adoptManual")}
            </SettingsButton>
          </div>
        </div>
      )}
      {manual && !runtime.configIssue && (
        <SettingsAlert tone="warn">{t("memory.runtime.manualDetail")}</SettingsAlert>
      )}
      {!runtime.installed && runtime.instanceId && !runtime.versionChange && (
        <SettingsAlert tone="warn">
          {t("memory.runtime.interruptedInstall", {
            version: runtime.installedVersion ?? runtime.lockedVersion ?? "",
          })}
        </SettingsAlert>
      )}
      {runtime.unverifiedVersion && (
        <SettingsAlert tone="warn">
          {t("memory.runtime.versionCandidateAwaitingReadiness", {
            version: runtime.unverifiedVersion,
          })}
        </SettingsAlert>
      )}
      {runtime.versionChange &&
        runtime.versionChange.phase !== "candidate-installed" && (
        <SettingsAlert tone="warn">
          {t("memory.runtime.versionIntentRecoveryRequired", {
            version: runtime.versionChange.targetVersion,
          })}
        </SettingsAlert>
      )}
      {runtime.installed && !runtime.instanceId && (
        <SettingsAlert tone="warn">
          {runtime.ownershipMarkerPresent
            ? t("memory.runtime.identityRepair")
            : t("memory.runtime.identityMissing")}
        </SettingsAlert>
      )}

      {(running || switchInProgress) && (
        <div
          ref={operationFocusRef}
          tabIndex={-1}
          role="status"
          data-testid="memory-runtime-focus-target"
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <MemoryOperationProgress runtime={runtime} stepText={stepText} />
        </div>
      )}

      {stance === "absent" ? (
        /* ── 什么都还没有：这一档要说服一个空手的人 ───────────────
           三条承诺只在这一档出现——装好之后再复述一遍，是把已经兑现的
           承诺当成现状念给人听。 */
        <div className="space-y-3">
          <div>
            <p className="font-medium text-sm">
              {t("memory.runtime.installHeading")}
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4 text-muted-foreground text-xs leading-relaxed marker:text-muted-foreground/40">
              <li>
                {t("memory.runtime.installPackage", {
                  provider: descriptor.displayName,
                  version: descriptor.lockedVersion ?? "",
                })}
              </li>
              <li>
                {t("memory.runtime.installAutostart", {
                  url: descriptor.defaultBaseUrl,
                })}
              </li>
              <li>{t("memory.runtime.installStorage")}</li>
            </ul>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2">
              <SettingsIconButton
                variant="ghost"
                label={t("memory.runtime.recheck")}
                onClick={onRecheck}
              >
                <RefreshCw />
              </SettingsIconButton>
              {/* 半装的运行时要的是修复而不是重装：instanceId 在、文件不全，
                  修复能安全地替换掉那份残缺；只有连归属标记都没有的镜像
                  才必须从头装一遍。 */}
              <SettingsButton
                disabled={!runtime.supported || running}
                onClick={
                  mirrorWithoutMarker || !hasInstallIdentity ? onInstall : onRepair
                }
              >
                {running ? (
                  <Loader2 className="motion-safe:animate-spin" />
                ) : (
                  <Download />
                )}
                {running
                  ? (stepText ?? t("memory.runtime.running"))
                  : runtime.error
                    ? t("memory.runtime.retryInstall")
                    : mirrorWithoutMarker || !hasInstallIdentity
                      ? t("memory.runtime.installAction")
                      : t("memory.runtime.repairAction")}
              </SettingsButton>
            </div>
          </div>
        </div>
      ) : (
        /* ── 装好了：按关心什么分三行，一行一个主动作 ──────────── */
        <div className="divide-y divide-border border-border border-t">
          <ManageRow
            label={t("memory.engines.versionRow")}
            value={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-mono tabular-nums">
                  {runtime.installedVersion ?? runtime.lockedVersion ?? "—"}
                </span>
                {runtime.versionSource === "selected" ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-foreground text-xs">
                    {t("memory.version.selected")}
                  </span>
                ) : (
                  !versionMismatch && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-foreground text-xs">
                      {t("memory.version.locked")}
                    </span>
                  )
                )}
                {yanked && (
                  <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-destructive text-xs">
                    {t("memory.version.yanked")}
                  </span>
                )}
              </span>
            }
            detail={
              runtime.updateAvailable && runtime.latestVersion
                ? t("memory.version.available", { version: runtime.latestVersion })
                : undefined
            }
            actions={versionActions}
          />

          {panel && runtime.installed && (
            <ManageRow
              label={t("memory.engines.modelRow")}
              value={
                <span className={needsConfig ? "text-amber-700 dark:text-amber-400" : undefined}>
                  {needsConfig
                    ? t("memory.engines.modelUnset")
                    : t("memory.engines.modelConfigured")}
                </span>
              }
              actions={
                <SettingsButton
                  data-testid="memory-config-panel"
                  variant={needsConfig ? undefined : "outline"}
                  disabled={running || manual}
                  onClick={onConfigure}
                >
                  <KeyRound />
                  {t("memory.runtime.configureAction")}
                </SettingsButton>
              }
            />
          )}

          <ManageRow
            label={t("memory.engines.runtimeRow")}
            value={t("memory.engines.runtimeManaged", {
              url: target?.baseUrl ?? descriptor.defaultBaseUrl,
            })}
            detail={t("memory.engines.runtimeAutostart")}
            actions={
              <>
                {/* 重新检测只重新握手，不修改磁盘；它免费且可逆，故稳定待在
                    最左边。需要确认的修复排在它后面，空间顺序也表达代价。 */}
                <SettingsIconButton
                  label={t("memory.runtime.recheck")}
                  onClick={onRecheck}
                >
                  <RefreshCw />
                </SettingsIconButton>
                {/* 修复按情形改变分量：出事时它是这一行的主动作，平时
                    只是一颗扳手——「一切正常」不该有一颗喊着修复的按钮。 */}
                {runtimeNeedsRepair || mirrorWithoutMarker ? (
                  <SettingsButton
                    variant="outline"
                    disabled={!runtime.supported || running}
                    onClick={mirrorWithoutMarker ? onInstall : onRepair}
                  >
                    {running ? (
                      <Loader2 className="motion-safe:animate-spin" />
                    ) : (
                      <Wrench />
                    )}
                    {mirrorWithoutMarker
                      ? t("memory.runtime.installAction")
                      : t("memory.runtime.repairAction")}
                  </SettingsButton>
                ) : (
                  <SettingsIconButton
                    label={t("memory.runtime.repairAction")}
                    disabled={!runtime.supported || running}
                    onClick={() => setRepairConfirmOpen(true)}
                  >
                    {running ? (
                      <Loader2 className="motion-safe:animate-spin" />
                    ) : (
                      <Wrench />
                    )}
                  </SettingsIconButton>
                )}
                {uninstallAction}
              </>
            }
          />
        </div>
      )}

      {revealFailed && (
        <SettingsAlert>{t("memory.backend.dataLocationFailed")}</SettingsAlert>
      )}
      <ConfirmationDialog
        open={repairConfirmOpen}
        onOpenChange={setRepairConfirmOpen}
        title={t("memory.runtime.repairTitle", {
          provider: descriptor.displayName,
        })}
        description={t("memory.runtime.repairDescription")}
        confirmLabel={t("memory.runtime.repairAction")}
        onConfirm={() => {
          setRepairConfirmOpen(false);
          onRepair();
        }}
      />
      {runtime.log.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            className="text-muted-foreground text-xs underline underline-offset-2"
            aria-expanded={logsOpen}
            disabled={Boolean(runtime.error)}
            onClick={() => setLogsRequestedOpen((value) => !value)}
          >
            {runtime.error
              ? t("memory.runtime.errorLog")
              : logsOpen
                ? t("memory.runtime.hideLog")
                : t("memory.runtime.showLog")}
          </button>
          {logsOpen && (
            <SlimScroller asChild>
              <pre
                ref={logRef}
                className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/60 p-3 font-mono text-[11px] text-muted-foreground leading-relaxed"
              >
                {runtime.log.join("\n")}
              </pre>
            </SlimScroller>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * 配置字段：密钥表单只有这一份实现。
 *
 * 它同时长在两处——设置里的配置弹窗，与初次设置的第三步。两处各写
 * 一遍意味着 secret/autocomplete/1Password 抑制/「留空即保留」这些
 * 与凭据安全相关的细节会各自漂移，而漂移的那一份不会有人发现。
 * 表单的形状归这里，容器（弹窗还是页面）归调用方。
 * ============================================================ */

export function MemoryConfigFields({
  panel,
  values,
  busy,
  requireMissingValues,
  autoFocusFirst,
  onChange,
}: {
  panel: MemoryConfigPanel;
  values: Record<string, string>;
  busy: boolean;
  requireMissingValues: boolean;
  autoFocusFirst: boolean;
  onChange(values: Record<string, string>): void;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      {panel.fields.map((field, index) => {
        const inputId = `memory-config-${panel.panelId}-${field.key}`;
        const descriptionId = `${inputId}-description`;
        /* 占位文案有两种身份：「留空即保留」是一句话，示例值是一个值。
           句子该走界面字体——等宽把中文一个字一个字撑开，读起来像被
           拆散的密码；示例值该走等宽——用户照着它的形状填，字符必须
           一眼可辨。同一个条件决定文案与字体，不留第二处判断。 */
        const retainHint = field.retainedWhenBlank;
        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={inputId} className="block font-medium text-sm">
              {t(`memory.provider.${panel.providerId}.field.${field.key}.label`, {
                defaultValue: field.label,
              })}
            </label>
            <Input
              id={inputId}
              name={field.key}
              type={field.secret ? "password" : "text"}
              autoFocus={index === 0 && autoFocusFirst}
              autoComplete={field.secret ? "new-password" : "off"}
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore
              required={requireMissingValues && field.required}
              aria-describedby={descriptionId}
              placeholder={
                retainHint
                  ? t("memory.runtime.retainBlank")
                  : field.defaultValue ?? ""
              }
              value={values[field.key] ?? ""}
              disabled={busy}
              onChange={(event) =>
                onChange({ ...values, [field.key]: event.target.value })
              }
              /* 14px 是这里的正确刻度：比基线的 12px 大一档，因为密钥与
                 URL 要逐字符核对；也不到 16px——那是移动端防缩放的规矩，
                 搬到桌面只会让输入值压过它自己的标签。md: 必须显式写，
                 否则基线的 md:text-xs 会在桌面断点上赢回去。 */
              className={cn(
                "h-9 w-full px-3 font-mono text-sm md:text-sm",
                retainHint && "placeholder:font-sans"
              )}
            />
            <p
              id={descriptionId}
              className="text-muted-foreground text-xs leading-relaxed"
            >
              {t(
                `memory.provider.${panel.providerId}.field.${field.key}.description`,
                { defaultValue: field.description }
              )}
            </p>
          </div>
        );
      })}
    </>
  );
}

export function MemoryRuntimeConfigDialog({
  open,
  panel,
  values,
  busy,
  error,
  requireMissingValues,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  panel: MemoryConfigPanel;
  values: Record<string, string>;
  busy: boolean;
  error: string;
  requireMissingValues: boolean;
  onOpenChange(next: boolean): void;
  onChange(values: Record<string, string>): void;
  onSubmit(): void;
}) {
  const { t } = useAppTranslation();
  const allowAutoFocus =
    typeof window === "undefined" || !("ontouchstart" in window);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AppDialogContent
        showCloseButton={false}
        aria-busy={busy}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader className="shrink-0 gap-0 text-left">
            <DialogTitle className="font-semibold text-xl/7">
              {t("memory.runtime.configDialogTitle", {
                provider: panel.title,
              })}
            </DialogTitle>
            {/* 说明跟着密钥走：这句「只保存在本机」从前印在设置页上一块
                常驻区里，而人是在这张表单里交出密钥的。承诺要待在动手的
                那一刻，且各家运行时的保管方式本就不同（0600 ov.conf 与
                LaunchAgent），descriptor 自带的那句比一句通用文案更准。 */}
            <DialogDescription className="mt-2 text-[15px]/[1.4]">
              {t(`memory.provider.${panel.providerId}.panel.description`, {
                defaultValue: panel.description,
              })}
            </DialogDescription>
          </DialogHeader>

          <AppDialogBody className="mt-4 space-y-4 pr-1">
            <MemoryConfigFields
              panel={panel}
              values={values}
              busy={busy}
              requireMissingValues={requireMissingValues}
              autoFocusFirst={allowAutoFocus}
              onChange={onChange}
            />
            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs ring-1 ring-destructive/20"
              >
                {error}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {t("memory.runtime.draftRetained")}
            </p>
          </AppDialogBody>

          <DialogFooter className="mt-4 shrink-0 flex-row justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="pill"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              size="pill"
              disabled={busy}
              className="min-w-[7rem]"
            >
              {busy && <Loader2 className="motion-safe:animate-spin" />}
              {busy
                ? t("memory.runtime.savingConfig")
                : t("memory.runtime.submitRestart")}
            </Button>
          </DialogFooter>
        </form>
      </AppDialogContent>
    </Dialog>
  );
}

/* 卸载确认与面板同源一文件（与重建三件同一模式）：入口按钮在版本行的
   图标排里，对话框由视图持有 open 态。文案必须把三件事说满：删什么
   （运行时 + 其中全部记忆数据）、留什么（授权账本与聊天）、然后会
   发生什么（该后端在用则自动关闭；重装后可重建回灌）。 */
export function MemoryUninstallDialog({
  open,
  onOpenChange,
  providerName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  providerName: string;
  onConfirm(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("memory.runtime.uninstallTitle", { provider: providerName })}
      description={
        <span className="space-y-3">
          <span className="block">
            {t("memory.runtime.uninstallDescription")}
          </span>
          <span className="block">
            {t("memory.runtime.uninstallRetention")}
          </span>
        </span>
      }
      confirmLabel={t("memory.runtime.uninstallConfirm")}
      confirmTone="destructive"
      onConfirm={onConfirm}
    />
  );
}
