/**
 * [INPUT]: Depends on React review state, lucide Check/ExternalLink/Loader2 icons, shared descriptor/runtime/config-panel contracts, settings-layout alerts/choice rows/label actions, MemoryConfigFields/MemoryOperationProgress, external-open IPC, and i18n
 * [OUTPUT]: Provides memorySetupTarget/memorySetupStage (which engine setup is about and how far its runtime got), memoryRuntimeStepText, and useMemorySetupFlow — the runtime-derived choose → install → connect flow as a surface-agnostic view (progress, per-step title and description, body, Back and primary action descriptors, running/done flags) whose review never rewrites runtime facts or provider-bound drafts
 * [POS]: The state machine behind MemorySetupDialog and the not-set-up Settings row; the dialog draws it, the row reads the same target and stage so both always tell the same story
 */

import { useId, useState, type ReactNode } from "react";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import type {
  MemoryConfigPanel,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
} from "../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { MemoryConfigFields } from "@/components/settings/memory/memory-runtime-dialogs";
import { MemoryOperationProgress } from "@/components/settings/memory/memory-runtime-panel";
import {
  SettingsAlert,
  SettingsChoiceRow,
  SettingsLabelAction,
} from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";

/* ============================================================
 * 三步的顺序就是依赖的顺序：选引擎 → 装依赖 → 交密钥。每一步都由
 * 运行时快照自己派生，而不是靠向导自持一个 step 游标：装到一半关掉
 * App 再回来，快照说到哪就还在哪；游标则会从头开始，或者更糟——停在
 * 一个与磁盘事实不符的步骤上。
 *
 * 这里只产出「视图」，不画外壳：外壳是共享的分步弹窗，Settings 里那一行
 * 读同一个 target 与 stage，于是行上的徽标与弹窗停在哪一步永远一致。
 * ============================================================ */

export type MemorySetupStage = 1 | 2 | 3;

export type MemorySetupProps = {
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
};
/** One action of the flow; the surface decides the button it becomes. */
export type MemorySetupAction = {
  label: string;
  onClick?: () => void;
  /** Submits the connect form instead of clicking. */
  submit?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: "download";
};
export type MemorySetupFlow = {
  /** 1-based, as the step dialog counts. */
  step: MemorySetupStage;
  total: number;
  title: string;
  description: string;
  body: ReactNode;
  formId: string;
  back: (() => void) | null;
  primary: MemorySetupAction | null;
  /** The viewed step is a running install: the only honest exit is "continue in the background". */
  running: boolean;
  /** The target passed the configuration gate; nothing is left to set up. */
  done: boolean;
};

export function memorySetupStage(runtime: MemoryRuntimeSnapshot | null): MemorySetupStage {
  if (runtime?.installed && !runtime.configured) return 3;
  if (
    runtime?.phase === "running" ||
    (runtime && !runtime.installed && Boolean(runtime.error || runtime.instanceId))
  ) {
    return 2;
  }
  return 1;
}

/* 没有显式选择时，磁盘事实决定恢复谁；一旦用户回退并改选，选择本身
   就是下一次安装/配置的明确意图，不能再被另一档的旧待配置态顶掉。 */
export function memorySetupTarget(
  descriptors: MemoryProviderDescriptor[],
  runtimes: MemorySetupProps["runtimes"],
  selectedId: string | null
): { active: MemoryProviderDescriptor; explicit: MemoryProviderDescriptor | null; working: boolean } {
  const runtimeOf = (id: string) => runtimes[id] ?? null;
  const working = descriptors.find((item) => runtimeOf(item.id)?.phase === "running");
  const awaitingConfig = descriptors.find((item) => {
    const runtime = runtimeOf(item.id);
    return runtime?.installed && !runtime.configured;
  });
  const attempted = descriptors.find((item) => {
    const runtime = runtimeOf(item.id);
    return Boolean(runtime && !runtime.installed && (runtime.error || runtime.instanceId));
  });
  const explicit = selectedId
    ? descriptors.find((item) => item.id === selectedId) ?? null
    : null;
  return {
    active: explicit ?? working ?? awaitingConfig ?? attempted ?? descriptors[0],
    explicit,
    working: Boolean(working),
  };
}

export function memoryRuntimeStepText(
  runtime: MemoryRuntimeSnapshot,
  t: ReturnType<typeof useAppTranslation>["t"]
) {
  return runtime.step
    ? t(`memory.runtime.step.${runtime.step.kind}`, {
        context: runtime.step.context,
        version: runtime.step.version ?? "",
      })
    : null;
}

export function useMemorySetupFlow({
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
}: MemorySetupProps): MemorySetupFlow {
  const { t } = useAppTranslation();
  const runtimeOf = (id: string) => runtimes[id] ?? null;
  const { active, explicit, working: installBusy } = memorySetupTarget(descriptors, runtimes, selectedId);
  const activeRuntime = runtimeOf(active.id);
  const progressStep = memorySetupStage(activeRuntime);
  /* review 只记「看哪一页」，不伪造运行时进度；换引擎或进度倒退时旧值
     因 provider/上界不匹配自然失效，不需要 effect 补一套同步状态机。 */
  const [review, setReview] = useState<{
    providerId: string;
    step: MemorySetupStage;
  } | null>(null);
  const viewStep =
    review?.providerId === active.id && review.step <= progressStep
      ? review.step
      : progressStep;
  const selectedEngineId = explicit?.id ?? active.id;
  const selectedRuntime = runtimeOf(selectedEngineId);
  const panel =
    panels.find((item) => item.panelId === active.configPanelId) ?? null;
  const formId = useId();

  const showStep = (next: MemorySetupStage) => {
    setReview(
      next === progressStep ? null : { providerId: active.id, step: next }
    );
  };
  const proceed: MemorySetupAction = { label: t("common.continue"), onClick: () => setReview(null) };
  /* An engine that is already past step one (installed, installing, or a failed attempt) continues to its own
     progress instead of offering a second install. */
  const selectedProgress = memorySetupStage(selectedRuntime);
  const selectedName =
    descriptors.find((item) => item.id === selectedEngineId)?.displayName ??
    active.displayName;
  const provider = active.displayName;
  const running = viewStep === 2 && activeRuntime?.phase === "running";

  let title = t("memory.setup.chooseTitle");
  let description = t("memory.setup.chooseDescription");
  let body: ReactNode = null;
  let back: (() => void) | null = null;
  let primary: MemorySetupAction | null = null;
  if (viewStep === 1) {
    body = (
      <>
        <div
          role="radiogroup"
          aria-label={t("memory.engines.aria")}
          className="divide-inset rounded-lg ring-1 ring-foreground/10"
        >
          {descriptors.map((descriptor) => (
            <EngineRow
              key={descriptor.id}
              descriptor={descriptor}
              checked={descriptor.id === selectedEngineId}
              recommended={descriptor.id === descriptors[0]?.id}
              onSelect={() => onSelectEngine(descriptor.id)}
            />
          ))}
        </div>
        {selectedRuntime && !selectedRuntime.supported && (
          <SettingsAlert tone="warn">{t("memory.runtime.unsupported")}</SettingsAlert>
        )}
      </>
    );
    primary = selectedProgress > 1 ? proceed : {
      label: t("memory.engines.installAction", { provider: selectedName }),
      icon: "download",
      disabled: installBusy || !selectedRuntime?.supported,
      onClick: () => {
        setReview(null);
        onInstall(selectedEngineId);
      },
    };
  } else if (viewStep === 2 && activeRuntime) {
    const awaiting = activeRuntime.installed && !activeRuntime.configured;
    title = running
      ? t("memory.setup.installingTitle", { provider })
      : awaiting
        ? t("memory.setup.installedTitle", { provider })
        : t("memory.setup.installFailedTitle", { provider });
    description = awaiting && !running
      ? t("memory.runtime.managedNeedsConfig", {
          provider,
          version: activeRuntime.installedVersion ?? active.lockedVersion,
        })
      : t("memory.setup.installingDescription");
    body = (
      <>
        <div
          data-memory-install-panel=""
          className="space-y-3 rounded-lg px-4 py-3.5 ring-1 ring-foreground/10"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px]">{provider}</span>
            {active.lockedVersion && (
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {active.lockedVersion}
              </span>
            )}
            {running && (
              <Loader2 className="ml-auto size-3.5 text-muted-foreground motion-safe:animate-spin" aria-hidden="true" />
            )}
            {!running && awaiting && (
              <span className="ml-auto flex items-center gap-1.5 text-muted-foreground text-xs">
                <Check className="size-3.5" aria-hidden="true" />
                {activeRuntime.installedVersion
                  ? t("memory.backend.installedNeedsConfigVersion", {
                      version: activeRuntime.installedVersion,
                    })
                  : t("memory.backend.installedNeedsConfig")}
              </span>
            )}
          </div>
          {running && (
            <MemoryOperationProgress
              runtime={activeRuntime}
              stepText={memoryRuntimeStepText(activeRuntime, t)}
            />
          )}
          {/* The panel is the one surface here: a failure is red text inside it, not a tinted box inside a box. */}
          {activeRuntime.error && (
            <p role="alert" className="text-destructive text-xs leading-relaxed">
              {activeRuntime.error}
            </p>
          )}
        </div>
        {running && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            {t("memory.setup.backgroundNote")}
          </p>
        )}
      </>
    );
    back = () => showStep(1);
    primary = activeRuntime.error ? {
      label: t("memory.runtime.retryInstall"),
      icon: "download",
      disabled: installBusy,
      onClick: () => {
        setReview(null);
        onInstall(active.id);
      },
    } : awaiting ? proceed : null;
  } else if (viewStep === 3 && panel) {
    title = t("memory.setup.connectTitle");
    description = t("memory.setup.connectDescription");
    body = (
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onConfigSubmit(active.id);
        }}
      >
        <MemoryConfigFields
          panel={panel}
          values={getConfigValues(active.id)}
          busy={configBusy}
          requireMissingValues
          autoFocusFirst={typeof window === "undefined" || !("ontouchstart" in window)}
          onChange={(values) => onConfigChange(active.id, values)}
        />
        {configError && <SettingsAlert>{configError}</SettingsAlert>}
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("memory.setup.draftKept")}
        </p>
      </form>
    );
    back = () => showStep(2);
    primary = {
      label: configBusy ? t("memory.runtime.savingConfig") : t("memory.setup.connectSubmit"),
      submit: true,
      disabled: configBusy,
      busy: configBusy,
    };
  }

  return {
    step: viewStep,
    total: 3,
    title,
    description,
    body,
    formId,
    back,
    primary,
    running,
    done: Boolean(activeRuntime?.installed && activeRuntime.configured),
  };
}

/* 引擎行就是 Settings 的单选行：名称 · 锁定版本 · 推荐徽标一行、摘要一行；
   推荐只给第一档——两档都戴徽标等于没有推荐。主页入口是行标题旁的独立
   按钮，不在单选的命中区里：打开项目页不等于选中这一行。 */
function EngineRow({
  descriptor,
  checked,
  recommended,
  onSelect,
}: {
  descriptor: MemoryProviderDescriptor;
  checked: boolean;
  recommended: boolean;
  onSelect(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <SettingsChoiceRow
      label={descriptor.displayName}
      checked={checked}
      onSelect={onSelect}
      labelMeta={
        <>
          {descriptor.lockedVersion && (
            <span
              data-memory-provider-version=""
              className="font-mono text-muted-foreground text-xs tabular-nums"
            >
              {descriptor.lockedVersion}
            </span>
          )}
          {recommended && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-400">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              {t("memory.setup.recommended")}
            </span>
          )}
        </>
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
    />
  );
}
