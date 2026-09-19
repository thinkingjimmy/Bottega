/**
 * [INPUT]: Depends on React review state, lucide Check/Download/ExternalLink/Loader2/ShieldCheck icons, shared descriptor/runtime/config-panel contracts, the shared SetupStep column, settings-layout alerts, MemoryConfigFields/MemoryOperationProgress, external-open IPC, and i18n
 * [OUTPUT]: Provides useMemorySetupFlow — the runtime-derived choose → install → connect flow as a surface-agnostic view (steps, caption, heading, body, Back and primary action descriptors) whose review never rewrites runtime facts or provider-bound drafts — and MemorySetup, that flow drawn as the shared setup column
 * [POS]: First-run Settings › Memory surface and the flow behind the onboarding memory dialog; MemorySettingsView selects the column until one managed engine passes the configuration gate
 */

import { useId, useState, type ReactNode } from "react";
import { Check, Download, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import type {
  MemoryConfigPanel,
  MemoryProviderDescriptor,
  MemoryRuntimeSnapshot,
} from "../../../shared/memory-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { MemoryConfigFields } from "@/components/settings/memory/memory-runtime-dialogs";
import { MemoryOperationProgress } from "@/components/settings/memory/memory-runtime-panel";
import { SettingsAlert } from "@/components/settings/settings-layout";
import { openExternal } from "@/lib/agent-client";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SetupStep as SetupColumn } from "@ai-chat/ui/components/ui/setup-step";
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
 *
 * 画面是 onboarding 与 Sync 设置共用的那条开放列：分段进度只说进度，
 * 回看走动作行左侧的 Back，前进走右侧的 Continue——从前那排可点的
 * 步骤段落说的是同一件事，却是这个 App 里独一份的语法。
 * ============================================================ */

type SetupStep = 1 | 2 | 3;

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
/** One action of the flow; the surface decides the button it becomes (a 32px button in the column, a pill in a dialog). */
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
  steps: string[];
  /** Zero-based, for progress rails. */
  step: number;
  caption: string;
  title: string;
  description: string;
  body: ReactNode;
  formId: string;
  back: (() => void) | null;
  primary: MemorySetupAction | null;
};

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

  const formId = useId();
  const steps = [
    t("memory.setup.stepChoose"),
    t("memory.setup.stepInstall"),
    t("memory.setup.stepConnect"),
  ];
  const caption = `${t("common.stepOf", { current: viewStep, total: steps.length })} · ${steps[viewStep - 1]}`;
  const description =
    viewStep === 1
      ? t("memory.setup.description")
      : viewStep === 2
        ? activeRuntime?.installed
          ? t("memory.runtime.managedNeedsConfig", {
              provider: active.displayName,
              version: activeRuntime.installedVersion ?? active.lockedVersion,
            })
          : t("memory.setup.installingTitle", { provider: active.displayName })
        : t("memory.setup.connectDescription");
  const proceed: MemorySetupAction = { label: t("common.continue"), onClick: () => setReview(null) };
  /* An engine that is already past step one (installed, installing, or a failed attempt) continues to its own
     progress instead of offering a second install. */
  const selectedProgress = runtimeSetupStep(selectedRuntime);
  const selectedName =
    descriptors.find((item) => item.id === selectedEngineId)?.displayName ??
    active.displayName;

  let body: ReactNode = null;
  let back: (() => void) | null = null;
  let primary: MemorySetupAction | null = null;
  if (viewStep === 1) {
    body = (
      <>
        <fieldset
          role="radiogroup"
          aria-label={t("memory.engines.aria")}
          className="space-y-3"
        >
          <legend className="sr-only">{t("memory.setup.stepChoose")}</legend>
          {descriptors.map((descriptor) => (
            <EngineRow
              key={descriptor.id}
              descriptor={descriptor}
              checked={descriptor.id === selectedEngineId}
              recommended={descriptor.id === descriptors[0]?.id}
              onSelect={() => onSelectEngine(descriptor.id)}
            />
          ))}
        </fieldset>
        {selectedRuntime && !selectedRuntime.supported && (
          <SettingsAlert tone="warn">{t("memory.runtime.unsupported")}</SettingsAlert>
        )}
        <ShieldNote>{t("memory.setup.privacy")}</ShieldNote>
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
    const running = activeRuntime.phase === "running";
    const awaiting = activeRuntime.installed && !activeRuntime.configured;
    body = (
      <>
        <div
          data-memory-install-panel=""
          className="space-y-3 rounded-md p-4 ring-1 ring-inset ring-foreground/15"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{active.displayName}</span>
            {active.lockedVersion && (
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {active.lockedVersion}
              </span>
            )}
            {running && (
              <span className="ml-auto flex items-center gap-2 text-muted-foreground text-xs">
                <Loader2 className="size-3.5 motion-safe:animate-spin" />
                {t("memory.runtime.running")}
              </span>
            )}
            {!running && awaiting && (
              <span className="ml-auto flex items-center gap-2 text-muted-foreground text-xs">
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
              stepText={
                activeRuntime.step
                  ? t(`memory.runtime.step.${activeRuntime.step.kind}`, {
                      context: activeRuntime.step.context,
                      version: activeRuntime.step.version ?? "",
                    })
                  : null
              }
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
            {t("memory.setup.leaveSafe")}
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
    body = (
      <form
        id={formId}
        className="flex flex-col gap-4"
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
        <ShieldNote>{t("memory.setup.changeLater")}</ShieldNote>
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

  return { steps, step: viewStep - 1, caption, title: t("memory.setup.title"), description, body, formId, back, primary };
}

/* The column surface: the product's 32px buttons, Back flush with the column edge. */
export function MemorySetup(props: MemorySetupProps) {
  const { t } = useAppTranslation();
  const flow = useMemorySetupFlow(props);
  return (
    <SetupColumn
      steps={flow.steps}
      step={flow.step}
      caption={flow.caption}
      title={flow.title}
      description={flow.description}
      footer={
        <>
          {flow.back ? (
            <Button size="lg" variant="ghost" onClick={flow.back}>
              {t("common.back")}
            </Button>
          ) : (
            <span />
          )}
          {flow.primary ? <MemorySetupButton action={flow.primary} formId={flow.formId} size="lg" /> : <span />}
        </>
      }
    >
      {flow.body}
    </SetupColumn>
  );
}

/** One action descriptor as a Button; the dialog asks for the pill, the column for lg. */
export function MemorySetupButton({
  action,
  formId,
  size,
  variant = "default",
}: {
  action: MemorySetupAction;
  formId: string;
  size: "lg" | "pill";
  variant?: "default" | "outline" | "ghost";
}) {
  return (
    <Button
      size={size}
      variant={variant}
      type={action.submit ? "submit" : "button"}
      form={action.submit ? formId : undefined}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.busy ? <Loader2 className="motion-safe:animate-spin" /> : action.icon === "download" ? <Download /> : null}
      {action.label}
    </Button>
  );
}

/* 引擎行就是「使用方式」那张描边可选行：原生 radio、名称 · 锁定版本 · 主页
   图标一行、摘要一行；推荐只给第一档——两档都戴徽标等于没有推荐。主页
   按钮在 label 里，故 preventDefault 拦下 label 的激活行为：打开项目页不等于
   选中这一行。 */
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
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md p-4 ring-1 ring-inset",
        checked ? "ring-foreground" : "ring-foreground/15"
      )}
    >
      <input
        type="radio"
        name="memory-engine"
        value={descriptor.id}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 accent-foreground"
      />
      <span className="min-w-0 flex-1">
        <span
          data-memory-engine-heading=""
          className="flex min-h-5 items-center gap-2"
        >
          <span className="font-medium text-sm">{descriptor.displayName}</span>
          {descriptor.lockedVersion && (
            <span
              data-memory-provider-version=""
              className="font-mono text-muted-foreground/80 text-xs tabular-nums"
            >
              {descriptor.lockedVersion}
            </span>
          )}
          {descriptor.homepage && (
            <button
              type="button"
              aria-label={t("memory.backend.homepage")}
              className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={(event) => {
                event.preventDefault();
                void openExternal(descriptor.homepage!);
              }}
            >
              <ExternalLink className="size-3.5" />
            </button>
          )}
          {recommended && (
            <span className="ml-auto rounded-full bg-emerald-600/10 px-2 py-0.5 font-medium text-emerald-700 text-xs dark:text-emerald-400">
              {t("memory.setup.recommended")}
            </span>
          )}
        </span>
        <span className="mt-1 block text-muted-foreground text-sm">
          {t(`memory.provider.${descriptor.id}.summary`, {
            defaultValue: descriptor.summary,
          })}
        </span>
      </span>
    </label>
  );
}

function ShieldNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-muted-foreground text-xs leading-relaxed">
      <ShieldCheck className="mt-px size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
      {children}
    </p>
  );
}
