/**
 * [INPUT]: Depends on React review state, lucide Check/ChevronRight/Download/ExternalLink/Loader2/Shield icons, shared descriptor/runtime/config-panel contracts, settings-layout primitives including SettingsLabelAction, MemoryConfigFields/MemoryOperationProgress, external-open IPC, and i18n
 * [OUTPUT]: Provides MemorySetup — a runtime-derived choose → install → connect flow whose reached steps support non-destructive navigation and whose config drafts remain provider-bound
 * [POS]: First-run Settings › Memory surface; MemorySettingsView selects it until one managed engine passes the configuration gate
 */

import { useState } from "react";
import {
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type {
  MemoryConfigPanel,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
} from "../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  MemoryConfigFields,
  MemoryOperationProgress,
} from "@/components/settings/memory/memory-runtime-panel";
import {
  SettingsAlert,
  SettingsChoiceRow,
  SettingsLabelAction,
  SettingsList,
  SettingsSection,
  SettingsSurface,
} from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";

/* ============================================================
 * 装好之前，这一页只有这三步。
 *
 * 从前空装机进来看到的是完整的设置页：一个点不动的开关、一句「暂不
 * 可启用」、以及一片对还没有服务的人毫无意义的共享范围与观测格。那是
 * 把「还没设置」画成了「坏了」——用户读到的第一句话是一个否定。
 *
 * 三步的顺序就是依赖的顺序：选引擎 → 装依赖 → 交密钥。每一步都由
 * 运行时快照自己派生，而不是靠向导自持一个 step 游标：装到一半关掉
 * App 再回来，快照说到哪就还在哪；游标则会从头开始，或者更糟——停在
 * 一个与磁盘事实不符的步骤上。
 * ============================================================ */

type SetupStep = 1 | 2 | 3;

const SETUP_ACTION_ROW = "flex min-h-11 items-center gap-4";

/* 段落几何照抄 TabsList 的触发器：25px 高、rounded-md、text-xs。
   border-transparent 不是占位——深色下当前段要显 --input 边框，基线先留出
   这 1px，切换才不会把整条轨顶高一格。 */
const STEP_SEGMENT =
  "relative inline-flex h-[25px] items-center gap-1.5 whitespace-nowrap rounded-md border border-transparent pr-2.5 pl-[7px] font-medium text-xs leading-none";

/* 「看起来多大」与「点得中多大」是两个问题，分开问就不冲突：段落留在
   25px，::after 独自把命中区撑到 44px——与 Button size="pill" 同一手法。 */
const STEP_HIT_AREA =
  "after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']";

function runtimeSetupStep(runtime: MemoryRuntimeSnapshot | null): SetupStep {
  if (runtime?.installed && !runtime.configured) return 3;
  if (
    runtime?.phase === "running" ||
    (runtime && !runtime.installed && Boolean(runtime.error || runtime.instanceId))
  ) {
    return 2;
  }
  return 1;
}

export function MemorySetup({
  descriptors,
  runtimes,
  panels,
  selectedId,
  onSelectEngine,
  onInstall,
  getConfigValues,
  configBusy,
  configError,
  onConfigChange,
  onConfigSubmit,
}: {
  descriptors: MemoryProviderDescriptor[];
  runtimes: Record<string, MemoryRuntimeSnapshot | undefined>;
  panels: MemoryConfigPanel[];
  /** 用户显式选择的目标；null 时才从 runtime 快照恢复。 */
  selectedId: string | null;
  onSelectEngine(providerId: string): void;
  onInstall(providerId: string): void;
  getConfigValues(providerId: string): Record<string, string>;
  configBusy: boolean;
  configError: string;
  onConfigChange(providerId: string, values: Record<string, string>): void;
  onConfigSubmit(providerId: string): void;
}) {
  const { t } = useAppTranslation();
  const runtimeOf = (id: string) => runtimes[id] ?? null;

  /* 没有显式选择时，磁盘事实决定恢复谁；一旦用户回退并改选，选择本身
     就是下一次安装/配置的明确意图，不能再被另一档的旧待配置态顶掉。 */
  const working = descriptors.find(
    (item) => runtimeOf(item.id)?.phase === "running"
  );
  const awaitingConfig = descriptors.find((item) => {
    const runtime = runtimeOf(item.id);
    return runtime?.installed && !runtime.configured;
  });
  const attempted = descriptors.find((item) => {
    const runtime = runtimeOf(item.id);
    return Boolean(runtime && !runtime.installed && (runtime.error || runtime.instanceId));
  });
  const explicit = selectedId
    ? descriptors.find((item) => item.id === selectedId)
    : null;
  const active = explicit ?? working ?? awaitingConfig ?? attempted ?? descriptors[0];
  const activeRuntime = runtimeOf(active.id);
  const progressStep = runtimeSetupStep(activeRuntime);
  /* review 只记「看哪一页」，不伪造运行时进度；换引擎或进度倒退时旧值
     因 provider/上界不匹配自然失效，不需要 effect 补一套同步状态机。 */
  const [review, setReview] = useState<{
    providerId: string;
    step: SetupStep;
  } | null>(null);
  const viewStep =
    review?.providerId === active.id && review.step <= progressStep
      ? review.step
      : progressStep;
  const selectedEngineId = explicit?.id ?? active.id;
  const selectedRuntime = runtimeOf(selectedEngineId);
  const installBusy = Boolean(working);
  const panel =
    panels.find((item) => item.panelId === active.configPanelId) ?? null;

  const showStep = (next: SetupStep) => {
    setReview(
      next === progressStep ? null : { providerId: active.id, step: next }
    );
  };

  return (
    <SettingsSection
      title={t("memory.setup.title")}
      description={
        viewStep === 1
          ? t("memory.setup.description")
          : viewStep === 2
            ? activeRuntime?.installed
              ? t("memory.runtime.managedNeedsConfig", {
                  provider: active.displayName,
                  version:
                    activeRuntime.installedVersion ?? active.lockedVersion,
                })
              : t("memory.setup.installingTitle", {
                  provider: active.displayName,
                })
            : t("memory.setup.connectDescription")
      }
    >
      <Stepper
        viewStep={viewStep}
        progressStep={progressStep}
        onSelectStep={showStep}
      />

      {viewStep === 1 && (
        <div className="space-y-3">
          <SettingsList role="radiogroup" aria-label={t("memory.engines.aria")}>
            {descriptors.map((descriptor) => (
              <SettingsChoiceRow
                key={descriptor.id}
                label={descriptor.displayName}
                labelMeta={
                  descriptor.lockedVersion ? (
                    <span
                      data-memory-provider-version=""
                      className="font-mono text-muted-foreground/80 text-xs tabular-nums"
                    >
                      {descriptor.lockedVersion}
                    </span>
                  ) : undefined
                }
                labelAction={
                  descriptor.homepage ? (
                    <SettingsLabelAction
                      label={t("memory.backend.homepage")}
                      onClick={() => void openExternal(descriptor.homepage!)}
                    >
                      <ExternalLink />
                    </SettingsLabelAction>
                  ) : undefined
                }
                description={t(`memory.provider.${descriptor.id}.summary`, {
                  defaultValue: descriptor.summary,
                })}
                checked={descriptor.id === selectedEngineId}
                onSelect={() => onSelectEngine(descriptor.id)}
                trailing={
                  /* 推荐只给第一档：两档都戴徽标等于没有推荐。它不是
                     排名，只是「不知道选哪个就选它」。 */
                  descriptor.id === descriptors[0]?.id ? (
                    <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-400">
                      {t("memory.setup.recommended")}
                    </span>
                  ) : undefined
                }
              />
            ))}
          </SettingsList>

          {selectedRuntime && !selectedRuntime.supported && (
            <SettingsAlert tone="warn">
              {t("memory.runtime.unsupported")}
            </SettingsAlert>
          )}

          <div
            data-setup-action-row=""
            className={cn(SETUP_ACTION_ROW, "justify-between")}
          >
            <p className="flex min-w-0 items-start gap-2 text-muted-foreground text-xs leading-relaxed">
              <ShieldCheck className="mt-px size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              {t("memory.setup.privacy")}
            </p>
            {selectedRuntime?.installed ? (
              <Button
                className="shrink-0 touch-manipulation"
                size="pill"
                onClick={() => setReview(null)}
              >
                {t("common.continue")}
              </Button>
            ) : (
              <Button
                className="shrink-0 touch-manipulation"
                size="pill"
                disabled={installBusy || !selectedRuntime?.supported}
                onClick={() => {
                  setReview(null);
                  onInstall(selectedEngineId);
                }}
              >
                <Download />
                {t("memory.engines.installAction", {
                  provider:
                    descriptors.find((item) => item.id === selectedEngineId)
                      ?.displayName ?? active.displayName,
                })}
              </Button>
            )}
          </div>
        </div>
      )}

      {viewStep === 2 && activeRuntime && (
        <div className="space-y-3">
          <SettingsSurface className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{active.displayName}</span>
              {active.lockedVersion && (
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {active.lockedVersion}
                </span>
              )}
              {activeRuntime.phase === "running" && (
                <span className="ml-auto flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="size-3.5 motion-safe:animate-spin" />
                  {t("memory.runtime.running")}
                </span>
              )}
            </div>
            {activeRuntime.phase === "running" ? (
              <MemoryOperationProgress
                runtime={activeRuntime}
                stepText={
                  activeRuntime.step
                    ? t(`memory.runtime.step.${activeRuntime.step.kind}`, {
                        context: activeRuntime.step.context,
                        version: activeRuntime.step.version ?? "",
                      })
                    : null
                }
              />
            ) : activeRuntime.installed ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {activeRuntime.installedVersion
                  ? t("memory.backend.installedNeedsConfigVersion", {
                      version: activeRuntime.installedVersion,
                    })
                  : t("memory.backend.installedNeedsConfig")}
              </p>
            ) : null}
            {activeRuntime.phase === "running" && (
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t("memory.setup.leaveSafe")}
              </p>
            )}
            {activeRuntime.error && (
              <SettingsAlert>{activeRuntime.error}</SettingsAlert>
            )}
          </SettingsSurface>
          {(activeRuntime.error ||
            (activeRuntime.installed && !activeRuntime.configured)) && (
            <div
              data-setup-action-row=""
              className={cn(SETUP_ACTION_ROW, "justify-end")}
            >
              {activeRuntime.error ? (
                <Button
                  className="touch-manipulation"
                  size="pill"
                  disabled={installBusy}
                  onClick={() => {
                    setReview(null);
                    onInstall(active.id);
                  }}
                >
                  <Download />
                  {t("memory.runtime.retryInstall")}
                </Button>
              ) : (
                <Button
                  className="touch-manipulation"
                  size="pill"
                  onClick={() => setReview(null)}
                >
                  {t("common.continue")}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {viewStep === 3 && panel && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfigSubmit(active.id);
          }}
        >
          <SettingsSurface className="space-y-4 p-5">
            <MemoryConfigFields
              panel={panel}
              values={getConfigValues(active.id)}
              busy={configBusy}
              requireMissingValues
              autoFocusFirst={
                typeof window === "undefined" || !("ontouchstart" in window)
              }
              onChange={(values) => onConfigChange(active.id, values)}
            />
            {configError && <SettingsAlert>{configError}</SettingsAlert>}
            <p className="flex items-start gap-2 border-border border-t pt-3 text-muted-foreground text-xs leading-relaxed">
              <ShieldCheck className="mt-px size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              {t("memory.setup.changeLater")}
            </p>
          </SettingsSurface>
          <div
            data-setup-action-row=""
            className={cn(SETUP_ACTION_ROW, "justify-between")}
          >
            <p className="text-muted-foreground text-xs">
              {t("memory.setup.draftKept")}
            </p>
            <Button type="submit" size="pill" disabled={configBusy}>
              {configBusy && <Loader2 className="motion-safe:animate-spin" />}
              {configBusy
                ? t("memory.runtime.savingConfig")
                : t("memory.setup.connectSubmit")}
            </Button>
          </div>
        </form>
      )}
    </SettingsSection>
  );
}

/* 三步走完之前，进度条本身就是「还差什么」的唯一答案。走过的那几步
   收成一个勾——数字留给还没到的，勾留给已经过去的。

   形状不是新造的：这排东西就是 TabsList——同一条 32px 轨、3px 内边距、
   25px 圆角段落。从前它自造了一套方言：44px 的盒子里装 22px 内容（一半
   是死高，正是 button.tsx 点名的那个反面教材），外加白底 + 1px 描边 +
   投影——而那恰好是 SettingsSurface 的形状。在这个 App 里，那道边框说的
   是「我是装内容的容器」，于是走过的步读起来像卡片，不像按钮。它不像能
   点，不是因为不够亮，是因为穿错了衣服。

   三态各自成立，都不依赖 hover：当前段是唯一填充的那一格，可跳转段是
   完整墨色且是唯一有按下、聚焦与命中区的，未达段退成 muted 且根本不进
   tab 序。 */
function Stepper({
  viewStep,
  progressStep,
  onSelectStep,
}: {
  viewStep: SetupStep;
  progressStep: SetupStep;
  onSelectStep(step: SetupStep): void;
}) {
  const { t } = useAppTranslation();
  const labels = [
    t("memory.setup.stepChoose"),
    t("memory.setup.stepInstall"),
    t("memory.setup.stepConnect"),
  ];
  return (
    <ol className="inline-flex h-8 w-fit items-center gap-px rounded-lg bg-muted p-[3px]">
      {labels.map((label, index) => {
        const position = (index + 1) as SetupStep;
        const done = position < progressStep;
        const reached = position <= progressStep;
        const active = position === viewStep;
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full font-semibold text-[10px] tabular-nums",
                active && "bg-foreground text-background"
              )}
            >
              {done ? <Check className="size-[11px]" strokeWidth={3} /> : position}
            </span>
            <span>{label}</span>
          </>
        );
        return (
          <li key={label} className="flex items-center">
            {/* 分隔符只说顺序，不说进度——进度已经由勾与填充说完了。 */}
            {index > 0 && (
              <ChevronRight
                aria-hidden="true"
                className="mx-px size-3 shrink-0 text-foreground/20"
              />
            )}
            {active ? (
              <span
                aria-current="step"
                className={cn(
                  STEP_SEGMENT,
                  "bg-background text-foreground dark:border-input dark:bg-input/30"
                )}
              >
                {content}
              </span>
            ) : reached ? (
              <button
                type="button"
                onClick={() => onSelectStep(position)}
                className={cn(
                  STEP_SEGMENT,
                  STEP_HIT_AREA,
                  "cursor-pointer touch-manipulation text-foreground outline-none transition-colors duration-150 ease-out",
                  "active:translate-y-px focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "motion-reduce:transform-none motion-reduce:transition-none",
                  "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-background/60"
                )}
              >
                {content}
              </button>
            ) : (
              <span className={cn(STEP_SEGMENT, "text-muted-foreground")}>
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
