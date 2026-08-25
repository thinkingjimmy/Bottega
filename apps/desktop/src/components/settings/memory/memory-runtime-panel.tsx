/**
 * [INPUT]: Depends on i18n/renderer Intl locale, lucide icons, shared MemoryRuntimeSnapshot/descriptor/configuration panel agreement, settings-layout with SettingsButton and Dialog/Input/Button with @ai-chat/ui
 * [OUTPUT]: Provides MemoryRuntimePanel (four-quadrant installation/repair, focused running progress, token+revision fenced and fence, directory of versions for retesting promptings, distribution/upgrading of distribution according to versionSource, 44px version input, configuration/unloading and logging), configuration and unloading bullet windows
 * [POS]: The settings/memory service file is the area of action; From the same quadrant, the children of SettingsChoiceRow are judged by the actions and texts of the derivatives
 */

import { useEffect, useRef, useState } from "react";
import {
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  GitBranch,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type {
  MemoryConfigIssue,
  MemoryConfigIssueAction,
  MemoryConfigPanel,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
  MemoryRuntimeVersionsResult,
} from "../../../../shared/memory-ipc";
import { SettingsButton } from "@/components/settings/settings-layout";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { intlLocale } from "@/lib/i18n-locale";
import type { MemoryRuntimeStance, MemoryTranslate } from "@/lib/memory-view";
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
import { MemoryVersionDialog } from "./memory-version-dialog";
import { openExternal } from "@/lib/agent-client";

/* ============================================================
 * 叙事查表：stance 决定这块在说什么，别处一个分支都不必再写。
 *
 * 两档从前共用一份「安装承诺」文案，于是对已经装好的人复述
 * 「安装 OpenViking 0.4.11（独立 Python 环境…）」——承诺早已兑现，
 * 再读一遍只是废话。只有 absent 档保留三行：那一档要说服一个什么都
 * 还没有的人。
 *
 * managed 档现在连那句现状交代也不留：「OpenViking 0.4.11 由产品托管」
 * 里唯一没被说过的事实是版本号，而它排在第三层最小的字里。版本、安装
 * 来源与生效地址一并升进上面那行状态事实，这里只剩动作——同一个后端的
 * 身份，一页之内说三遍不会让人更确信。等待配置是例外：那是真状态，不是
 * 复述。
 * ============================================================ */

type RuntimeNarrative = {
  /** null = 这一档没有话要说：动作自己就是全部内容。 */
  heading: string | null;
  lines: string[];
  action: string;
  /** 安装只在「什么都没有」那一档是主行动，别处它是可选的另一条路。 */
  primary: boolean;
};

const STANCE_NARRATIVE: Record<
  MemoryRuntimeStance,
  (
    descriptor: MemoryProviderDescriptor,
    runtime: MemoryRuntimeSnapshot,
    translate: MemoryTranslate
  ) => RuntimeNarrative
> = {
  absent: (descriptor, _runtime, translate) => ({
    heading: translate("memory.runtime.installHeading"),
    lines: [
      /* 只承诺两家都真的做到的事：版本锁定对两家都成立；SHA256 校验
         只有提供单一 sdist 的后端才有（EverOS 有、OV 是 per-arch wheel
         没有），细节在安装日志里逐条可见，不在这里一概而论。 */
      translate("memory.runtime.installPackage", {
        provider: descriptor.displayName,
        version: descriptor.lockedVersion ?? "",
      }),
      translate("memory.runtime.installAutostart", {
        url: descriptor.defaultBaseUrl,
      }),
      translate("memory.runtime.installStorage"),
    ],
    action: translate("memory.runtime.installAction"),
    primary: true,
  }),
  managed: (descriptor, runtime, translate) => ({
    heading: null,
    /* 待配置阶段 plist 还没写：此时说「已注册登录自启」是撒谎——注册与
       首次启动都发生在密钥提交那一刻（writeConfig）。装好且在跑的那一
       档无话可说，版本与来源已由上面那行状态事实交代。 */
    lines:
      runtime.phase === "configuration-required"
        ? [
            translate("memory.runtime.managedNeedsConfig", {
              provider: descriptor.displayName,
              version: runtime.installedVersion ?? runtime.lockedVersion ?? "",
            }),
          ]
        : [],
    action: translate("memory.runtime.repairAction"),
    primary: false,
  }),
};

export const blankMemoryConfigValues = (panel: MemoryConfigPanel | null) =>
  Object.fromEntries((panel?.fields ?? []).map((field) => [field.key, ""]));

export function MemoryRuntimePanel({
  descriptor,
  runtime,
  stance,
  panel,
  onInstall,
  onRepair,
  onUpgrade,
  onCheckUpdates,
  onListVersions,
  onSwitchVersion,
  checkingUpdates,
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
  onInstall(): void;
  onRepair(): void;
  onUpgrade(): void;
  onCheckUpdates(): void;
  onListVersions(): Promise<MemoryRuntimeVersionsResult>;
  onSwitchVersion(version: string): Promise<unknown> | void;
  checkingUpdates: boolean;
  /** 打开卸载确认（对话框归调用方，与重建同一模式）。 */
  onUninstall(): void;
  onConfigure(): void;
  onResolveConfigIssue(issue: MemoryConfigIssue, action: MemoryConfigIssueAction): void;
  onRecheck(): void;
}) {
  const { t } = useAppTranslation();
  const translate = (key: string, options?: Record<string, unknown>) =>
    t(key, options);
  const running = runtime.phase === "running";
  const narrative = STANCE_NARRATIVE[stance](descriptor, runtime, translate);
  const [logsRequestedOpen, setLogsRequestedOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versions, setVersions] = useState<string[]>([]);
  const [listingVersions, setListingVersions] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
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
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running, runtime.operationStartedAt]);
  const elapsed = runtime.operationStartedAt
    ? Math.max(0, Math.floor((now - runtime.operationStartedAt) / 1_000))
    : 0;
  /* 两个正交事实，从前被同一个 manual 判过：
     manual  = ov.conf 由谁写（configModes），只管配置披露与配置按钮；
     lockedTarget = 安装目标由谁定（versionSource），只管版本失配与升级。 */
  const manual = Object.values(runtime.configModes).includes("manual");
  const lockedTarget = runtime.versionSource === "locked";
  const switchInProgress = switching || runtime.operation === "switch-version";
  const needsConfig = runtime.phase === "configuration-required";
  const hasInstallIdentity = runtime.installed || runtime.instanceId !== null;
  const mirrorWithoutMarker = runtime.installed && !runtime.instanceId && !runtime.ownershipMarkerPresent;
  const idleAction = mirrorWithoutMarker
    ? t("memory.runtime.installAction")
    : hasInstallIdentity
      ? t("memory.runtime.repairAction")
      : narrative.action;

  /* 瞬时态压过叙事：正在跑就报步骤，装失败过就说「重试」——
     后者只在 absent 档成立，另两档的动作本来就叫修复或改用。 */
  const actionLabel = running
    ? (runtime.step ?? t("memory.runtime.running"))
    : stance === "absent" && runtime.error
      ? t("memory.runtime.retryInstall")
      : idleAction;

  /* 只画内容，连内边距都不画：它现在住在自己那一档服务的动作区里，
     盒子归调用方——从前那份 px-4 py-3.5 是页签面板时代留下的。 */
  return (
    <div className="space-y-3">
      {(narrative.heading || narrative.lines.length > 0) && (
        <div>
          {narrative.heading && (
            <p className="font-medium text-sm">{narrative.heading}</p>
          )}
          {/* 标记的意义是复数：一条承诺没有第二条可与之分辨，那个圆点
              就只是墨水。absent 档三行才需要它。 */}
          <ul
            className={cn(
              "space-y-1 text-muted-foreground text-xs leading-relaxed",
              narrative.heading && "mt-1.5",
              narrative.lines.length > 1 &&
                "list-disc pl-4 marker:text-muted-foreground/40"
            )}
          >
            {narrative.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {!runtime.supported && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          {t("memory.runtime.unsupported")}
        </p>
      )}
      {/* 版本失配是可用 + 警示，不是一票否决——沿用 OV 的 compat 先例。
          但它只对「装的是当时的锁定版」成立：用户自选 0.4.16 之后，
          这条琥珀会永远挂着反对他自己刚做的选择。判据是 versionSource，
          与 configModes 的手工接管无关（那条披露在下面自己独立成立）。 */}
      {lockedTarget && runtime.versionMatch === false && (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          {t("memory.runtime.versionMismatch", {
            installed: runtime.installedVersion,
            locked: runtime.lockedVersion,
          })}
        </p>
      )}
      {runtime.error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs"
        >
          {runtime.step
            ? t("memory.runtime.stepFailed", { step: runtime.step })
            : ""}
          {runtime.error}
        </p>
      )}
      {runtime.configIssue && (
        <div role="alert" className="space-y-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs">
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
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          {t("memory.runtime.manualDetail")}
        </p>
      )}
      {(running || switchInProgress) && (
        <div
          ref={operationFocusRef}
          tabIndex={-1}
          role="status"
          data-testid="memory-runtime-focus-target"
          className="rounded-md text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {running
            ? <>{runtime.step ?? t("memory.runtime.preparing")} ·{" "}
                {new Intl.NumberFormat(intlLocale(), {
                  style: "unit",
                  unit: "second",
                  unitDisplay: "narrow",
                }).format(elapsed)}</>
            : t("memory.runtime.preparing")}
        </div>
      )}
      {running && runtime.stepTotal > 0 && (
        <div data-testid="memory-runtime-progress" className="space-y-2">
          <div
            className="flex gap-1"
            aria-label={t("memory.runtime.steps", {
              current: runtime.stepIndex,
              total: runtime.stepTotal,
            })}
          >
            {Array.from({ length: runtime.stepTotal }, (_, index) => (
              <span
                key={index}
                data-complete={index < runtime.stepIndex}
                className={cn(
                  "h-1.5 min-w-0 flex-1 rounded-full bg-muted",
                  index < runtime.stepIndex && "bg-foreground"
                )}
              />
            ))}
          </div>
        </div>
      )}
      {running && runtime.transfer && (
        <div className="space-y-1" data-testid="memory-runtime-transfer">
          <div
            role="progressbar"
            aria-label={t("memory.runtime.modelTransferAria")}
            aria-valuemin={0}
            aria-valuemax={runtime.transfer.totalBytes}
            aria-valuenow={runtime.transfer.receivedBytes}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full origin-left rounded-full bg-foreground motion-safe:transition-transform"
              style={{
                transform: `scaleX(${Math.min(1, runtime.transfer.totalBytes
                  ? runtime.transfer.receivedBytes / runtime.transfer.totalBytes
                  : 0)})`,
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs tabular-nums">
            {t("memory.runtime.modelTransfer", {
              received: (runtime.transfer.receivedBytes / 1024 / 1024).toFixed(1),
              total: (runtime.transfer.totalBytes / 1024 / 1024).toFixed(1),
            })}
          </p>
          {runtime.transfer.recovered && (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              {t("memory.runtime.modelRecovered")}
            </p>
          )}
        </div>
      )}
      {!runtime.installed && runtime.instanceId && !runtime.versionChange && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          {t("memory.runtime.interruptedInstall", {
            version: runtime.installedVersion ?? runtime.lockedVersion ?? "",
          })}
        </p>
      )}
      {runtime.versionChange && (
        <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          {t(runtime.versionChange.phase === "candidate-installed"
            ? "memory.runtime.versionCandidateAwaitingReadiness"
            : "memory.runtime.versionIntentRecoveryRequired", {
            version: runtime.versionChange.targetVersion,
          })}
        </p>
      )}
      {runtime.installed && !runtime.instanceId && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
          {runtime.ownershipMarkerPresent
            ? t("memory.runtime.identityRepair")
            : t("memory.runtime.identityMissing")}
        </p>
      )}
      {/* 动作并成一排：重新检测从前孤零零吊在整块面板之下，读起来
          像是页面末尾的残留，而它其实是改完地址后紧接着要按的那一下。

          配置提取模型也归这一排。它曾自带标题与说明独占一块——一句
          「密钥只保存在本机」为一颗按钮供养出整个段落，而那句承诺在
          填密钥的弹窗里还要再说一遍。承诺该待在动手的那一刻，入口就
          只是入口：托管运行时能做的事，一排看完。 */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 待配置阶段它才是主行动：此时服务根本没起来，修复安装无从修
            起。两个 variant 判据互斥（待配置必已安装），一排里永远只有
            一颗实心按钮，不必再写第三个分支去仲裁。 */}
        {panel && runtime.installed && (
          <SettingsButton
            data-testid="memory-config-panel"
            variant={needsConfig ? undefined : "outline"}
            disabled={running || manual}
            onClick={onConfigure}
          >
            <KeyRound />
            {t("memory.runtime.configureAction")}
          </SettingsButton>
        )}
        <SettingsButton
          variant={narrative.primary ? undefined : "outline"}
          disabled={!runtime.supported || running}
          onClick={mirrorWithoutMarker ? onInstall : hasInstallIdentity ? onRepair : onInstall}
        >
          {running ? <Loader2 className="motion-safe:animate-spin" /> : <Download />}
          {actionLabel}
        </SettingsButton>
        {/* 「升级到 {locked}」对自选版本是彻头彻尾的谎话：0.4.16 上按下去
            会静默降回 0.4.11。自选者要换版本，走上面那颗「选择版本」。 */}
        {lockedTarget && runtime.installed && runtime.versionMatch === false && (
          <SettingsButton variant="outline" disabled={running} onClick={onUpgrade}>
            <Wrench />
            {t("memory.runtime.upgradeTo", { version: runtime.lockedVersion })}
          </SettingsButton>
        )}
        {runtime.versionCatalogSupported && hasInstallIdentity && (
          <SettingsButton
            variant="outline"
            className="min-h-11"
            disabled={running || switching || listingVersions}
            aria-busy={listingVersions}
            onClick={() => {
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
                     会让按钮转完一圈又回到原样，读者只能猜自己是不是没点中。
                     可重试的提示 + 仍可点的按钮，才是「什么都没发生」的诚实说法。 */
                  if (
                    catalog.providerId !== descriptor.id ||
                    current.revision > catalog.revision
                  ) {
                    setCatalogError(t("memory.version.listStale"));
                    return;
                  }
                  setVersions(catalog.versions);
                  setVersionOpen(true);
                })
                .catch(() => {
                  if (token === versionRequest.current) {
                    setCatalogError(t("memory.version.listFailed"));
                  }
                })
                .finally(() => {
                  if (token === versionRequest.current) setListingVersions(false);
                });
            }}
          >
            {listingVersions
              ? <Loader2 className="motion-safe:animate-spin" />
              : <GitBranch />}
            {t("memory.version.action")}
          </SettingsButton>
        )}
        {runtime.versionCatalogSupported && (
          <SettingsButton className="min-h-11" variant="ghost" disabled={checkingUpdates} onClick={onCheckUpdates}>
            <RefreshCw className={checkingUpdates ? "motion-safe:animate-spin" : ""} />
            {runtime.updateAvailable
              ? t("memory.version.available", { version: runtime.latestVersion })
              : t("memory.version.check")}
          </SettingsButton>
        )}
        {runtime.versionCatalogSupported && descriptor.homepage && (
          <SettingsButton
            className="min-h-11"
            variant="ghost"
            onClick={() => void openExternal(`${descriptor.homepage}/releases`)}
          >
            {t("memory.version.changelog")}
          </SettingsButton>
        )}
        <SettingsButton variant="ghost" onClick={onRecheck}>
          {t("memory.runtime.recheck")}
        </SettingsButton>
        {/* 卸载是安装的反向承诺：没有它，拖走 app 之后 daemon 会
            永远开机自启——孤儿进程不配存在。

            但它从前与「重新检测」同排同尺寸同权重，只靠红色分——一个
            永久删除全部记忆数据，一个只是重新握手一次。红在静止态就喊，
            等于把音量用在最不该常驻的地方：ml-auto 把它推到行尾与例行
            动作分家，静止态收成 muted，hover 才转红，严重性交给那道必经
            的卸载确认承担（它已写明「永久删除全部长期记忆数据」）。 */}
        {hasInstallIdentity && (
          <SettingsButton
            variant="ghost"
            disabled={running}
            className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onUninstall}
          >
            <Trash2 />
            {t("memory.runtime.uninstall")}
          </SettingsButton>
        )}
        {running && (
          <span className="text-muted-foreground text-xs">
            {t("memory.runtime.downloadHint")}
          </span>
        )}
      </div>
      {catalogError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-xs">
          {catalogError}
        </p>
      )}
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
                className="max-h-40 overflow-y-auto rounded-md bg-muted/60 p-3 font-mono text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap"
              >
                {runtime.log.join("\n")}
              </pre>
            </SlimScroller>
          )}
        </div>
      )}
      <MemoryVersionDialog
        open={versionOpen}
        runtime={runtime}
        providerName={descriptor.displayName}
        versions={versions}
        busy={switchInProgress}
        error={switchError}
        onOpenChange={(next) => {
          setVersionOpen(next);
          if (!next) setSwitchError(null);
        }}
        onCloseAutoFocus={(event) => {
          if (!switchInProgress) return;
          event.preventDefault();
          operationFocusRef.current?.focus();
        }}
        onConfirm={(version) => {
          setSwitching(true);
          setSwitchError(null);
          Promise.resolve(onSwitchVersion(version))
            .then((succeeded) => {
              if (succeeded === false) {
                setSwitchError(t("memory.version.switchFailed"));
                return;
              }
              setVersionOpen(false);
            }, () => {
              setSwitchError(t("memory.version.switchFailed"));
            })
            .finally(() => setSwitching(false));
        }}
      />
    </div>
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
            <DialogTitle className="text-xl/7 font-semibold">
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
            {panel.fields.map((field, index) => {
              const inputId = `memory-config-${panel.panelId}-${field.key}`;
              const descriptionId = `${inputId}-description`;
              return (
                <div key={field.key} className="space-y-1.5">
                  <label htmlFor={inputId} className="block text-sm font-medium">
                    {t(
                      `memory.provider.${panel.providerId}.field.${field.key}.label`,
                      { defaultValue: field.label }
                    )}
                  </label>
                  <Input
                    id={inputId}
                    name={field.key}
                    type={field.secret ? "password" : "text"}
                    autoFocus={index === 0 && allowAutoFocus}
                    autoComplete={field.secret ? "new-password" : "off"}
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore
                    required={requireMissingValues && field.required}
                    aria-describedby={descriptionId}
                    placeholder={
                      field.retainedWhenBlank
                        ? t("memory.runtime.retainBlank")
                        : field.defaultValue ?? ""
                    }
                    value={values[field.key] ?? ""}
                    disabled={busy}
                    onChange={(event) =>
                      onChange({ ...values, [field.key]: event.target.value })
                    }
                    className="h-9 w-full font-mono text-base md:text-base"
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

/* 卸载确认与面板同源一文件（与重建三件同一模式）：入口按钮在上面的
   动作排里，对话框由视图持有 open 态。文案必须把三件事说满：删什么
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
