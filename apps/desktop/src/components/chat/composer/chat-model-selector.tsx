/**
 * [INPUT]: Depends on React, Lucide icons, UI Button/Popover/Slider/SlimScroller, Fast Star Wars style, Shared model directory and chat model selection
 * [OUTPUT]: Provides full capability ChatModelSelector, which includes five-tiered fast sliders with Model/Effort/Speed high-level configuration; The size of the trigger only varies with the content and width of the trigger, with the geometry unchanged, the model name omitted and the Effort preserved, while the panel follows the trigger width between 18 and 24 rem; Only the model setup submits to show local loading, session streaming reverts back to Sidebar
 * [POS]: The Codex model controller for chat/composer; list-only Back end is carried by independent chat-model-list-selector
 */

import { useMemo, useState, type CSSProperties } from "react";
import {
  Check,
  Circle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  RotateCcw,
  RotateCw,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import { Slider } from "@ai-chat/ui/components/ui/slider";
import { cn } from "@ai-chat/ui/lib/utils";
import {
  compactModelLabel,
  DEFAULT_QUICK_CHAT_OPTIONS,
  effortLabel,
  findModel,
  modelSupportsTier,
  optionsForModel,
  quickPresetIndex,
  QUICK_CHAT_PRESETS,
} from "@/lib/chat-model-selection";
import type { CodexTurnOptions } from "../../../../shared/agent-ipc";
import type {
  CodexModelInfo,
  CodexServiceTierInfo,
} from "../../../../shared/settings-ipc";
import "./chat-model-selector.css";

type SelectorView = "quick" | "advanced" | "model" | "effort" | "speed";

type ChatModelSelectorProps = {
  value: CodexTurnOptions;
  models: CodexModelInfo[];
  modelsLoading: boolean;
  modelsError: string;
  settingsError: string;
  disabled?: boolean;
  streaming?: boolean;
  saving?: boolean;
  onChange: (options: CodexTurnOptions) => Promise<void>;
  onRetryModels: () => void;
};

const FALLBACK_SPEEDS: CodexServiceTierInfo[] = [
  { id: "default", displayName: "Standard" },
  { id: "priority", displayName: "Fast" },
];

const sparkleStyles = ["-0.1s", "-0.45s", "-0.8s", "-1.15s", "-1.5s"];

// fallback 词表与 FALLBACK_SPEEDS 同源，避免两份 id→displayName 映射漂移
function speedLabel(tier: string, model?: CodexModelInfo) {
  return (
    model?.serviceTiers?.find((entry) => entry.id === tier)?.displayName ??
    FALLBACK_SPEEDS.find((entry) => entry.id === tier)?.displayName ??
    tier
  );
}

function OptionButton({
  label,
  description,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  description?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {description && (
          <span className="block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
      {selected && <Check className="size-4 text-primary" aria-hidden="true" />}
    </button>
  );
}

export function ChatModelSelector({
  value,
  models,
  modelsLoading,
  modelsError,
  settingsError,
  disabled = false,
  streaming = false,
  saving = false,
  onChange,
  onRetryModels,
}: ChatModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SelectorView>("quick");
  const [draftIndex, setDraftIndex] = useState(() =>
    Math.max(0, quickPresetIndex(value))
  );
  const [localBusy, setLocalBusy] = useState(false);
  const busy = disabled || saving || localBusy;
  const triggerLoading = saving || localBusy || (disabled && !streaming);
  const currentModel = findModel(models, value.model);
  const quickIndex = quickPresetIndex(value);
  const fast = value.serviceTier === "priority";

  const efforts = useMemo(
    () => currentModel?.supportedReasoningEfforts ?? [],
    [currentModel]
  );
  const speeds = currentModel?.serviceTiers?.length
    ? [
        FALLBACK_SPEEDS[0],
        ...currentModel.serviceTiers.filter((tier) => tier.id !== "default"),
      ]
    : FALLBACK_SPEEDS;

  const commit = async (next: CodexTurnOptions) => {
    setLocalBusy(true);
    try {
      await onChange(next);
      return true;
    } catch {
      return false;
    } finally {
      setLocalBusy(false);
    }
  };

  const changePreset = async (index: number) => {
    const preset = QUICK_CHAT_PRESETS[index];
    if (!preset) return;
    const serviceTier = modelSupportsTier(
      models,
      preset.model,
      value.serviceTier
    )
      ? value.serviceTier
      : "default";
    await commit({ ...preset, serviceTier, permissionMode: value.permissionMode });
  };

  const toggleFast = async () => {
    const nextTier = fast ? "default" : "priority";
    if (!modelSupportsTier(models, value.model, nextTier)) return;
    await commit({ ...value, serviceTier: nextTier });
  };

  const returnToQuick = () => {
    setView("quick");
  };

  const resetToDefault = async () => {
    const ok = await commit({
      ...DEFAULT_QUICK_CHAT_OPTIONS,
      permissionMode: value.permissionMode,
    });
    if (!ok) return;
    setDraftIndex(quickPresetIndex(DEFAULT_QUICK_CHAT_OPTIONS));
    setView("quick");
  };

  const triggerModel = compactModelLabel(
    currentModel?.displayName ?? value.model
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) {
          setDraftIndex(Math.max(0, quickIndex));
          setView(quickIndex < 0 ? "advanced" : "quick");
        }
      }}
    >
      <PopoverTrigger asChild>
        {/* 触发器的几何只是内容的函数：展开只换底色，不换尺寸。宽度一旦改由
            open 决定，长模型名就会在点击时缩回去，而这行本就不该有多余的位移。 */}
        <button
          type="button"
          disabled={busy}
          aria-label={`当前模型 ${triggerModel}，Effort ${effortLabel(value.reasoningEffort)}`}
          title={`${triggerModel} · ${effortLabel(value.reasoningEffort)}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-1.5 font-normal text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            open ? "bg-muted hover:bg-muted/80" : "hover:bg-muted"
          )}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {fast && (
              <Zap className="size-4 shrink-0 fill-current" aria-hidden="true" />
            )}
            {/* 名长者让位：模型名省略，Effort 短且不可猜，整块保留 */}
            <span className="truncate">{triggerModel}</span>
            <span className="shrink-0 text-muted-foreground">
              {effortLabel(value.reasoningEffort)}
            </span>
          </span>
          {triggerLoading ? (
            <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>
      {/* 面板与触发器共边同宽：下限 18rem 是内容可读的底，上限 24rem 由最宽
          视图（effort 列表实测 361px）决定——再宽只是空气。跟随的是触发器而非
          自身内容，视图切换才不会晃。 */}
      <PopoverContent
        side="top"
        align="end"
        className="w-(--radix-popover-trigger-width) min-w-72 max-w-[min(24rem,100vw-2rem)] p-3 [&_button:not(:disabled)]:cursor-pointer"
        aria-label="聊天模型选择器"
      >
        {view === "quick" ? (
          <div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setView("advanced")}
                className="flex items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                Advanced <ChevronRight className="size-4" aria-hidden="true" />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy || (!fast && !modelSupportsTier(models, value.model, "priority"))}
                aria-label={fast ? "关闭 Fast speed" : "开启 Fast speed"}
                aria-pressed={fast}
                onClick={() => void toggleFast()}
                className={cn(fast && "text-[#3598f6] hover:text-[#3598f6]")}
              >
                <Zap className={cn("size-4", fast && "fill-current")} />
              </Button>
            </div>
            <div className="relative mt-3 overflow-hidden rounded-full">
              <div className="pointer-events-none absolute inset-x-3.5 top-1/2 z-10 flex -translate-y-1/2 justify-between" aria-hidden="true">
                {QUICK_CHAT_PRESETS.map((preset, index) => (
                  <Circle
                    key={`${preset.model}-${preset.reasoningEffort}`}
                    className={cn(
                      "size-1.5 fill-current",
                      index <= draftIndex
                        ? "text-white/45"
                        : "text-muted-foreground/50"
                    )}
                  />
                ))}
              </div>
              <Slider
                min={0}
                max={4}
                step={1}
                value={[draftIndex]}
                disabled={busy}
                onValueChange={([index]) => setDraftIndex(index ?? 0)}
                onValueCommit={([index]) => void changePreset(index ?? 0)}
                aria-label="快速模型档位"
                aria-valuetext={`${compactModelLabel(QUICK_CHAT_PRESETS[draftIndex]?.model ?? value.model)} ${effortLabel(QUICK_CHAT_PRESETS[draftIndex]?.reasoningEffort ?? value.reasoningEffort)}`}
                className="h-7 cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-100 [&_[data-slot=slider-range]]:bg-[#3598f6] [&_[data-slot=slider-track]]:h-7 [&_[data-slot=slider-thumb]]:size-7"
              />
              {fast && (
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
                  {sparkleStyles.map((delay, index) => (
                    <Sparkles
                      key={delay}
                      className="model-speed-sparkle absolute left-0 size-2.5 text-white/80 motion-reduce:hidden"
                      style={
                        {
                          top: `${4 + (index % 3) * 6}px`,
                          "--spark-delay": delay,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>
            {view === "advanced" && (
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => setView("model")}
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <span className="font-medium">Model</span>
                  <span className="ml-auto truncate text-muted-foreground">{triggerModel}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("effort")}
                  disabled={busy || !currentModel}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <span className="font-medium">Effort</span>
                  <span className="ml-auto truncate text-muted-foreground">{effortLabel(value.reasoningEffort)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("speed")}
                  disabled={busy || !currentModel}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <span className="font-medium">Speed</span>
                  <span className="ml-auto truncate text-muted-foreground">{speedLabel(value.serviceTier, currentModel)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              </div>
            )}

            {view !== "advanced" && (
              <div>
                <button
                  type="button"
                  onClick={() => setView("advanced")}
                  className="mb-1 flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  {view === "model" ? "Model" : view === "effort" ? "Effort" : "Speed"}
                </button>
                <SlimScroller className="max-h-64 overflow-y-auto">
                  {view === "model" &&
                    models.map((model) => (
                      <OptionButton
                        key={model.slug}
                        label={compactModelLabel(model.displayName)}
                        selected={model.slug === value.model}
                        disabled={busy}
                        onClick={() => void commit(optionsForModel(value, model)).then((ok) => ok && setView("advanced"))}
                      />
                    ))}
                  {view === "effort" &&
                    efforts.map((effort) => (
                      <OptionButton
                        key={effort.effort}
                        label={effortLabel(effort.effort)}
                        description={effort.description}
                        selected={effort.effort === value.reasoningEffort}
                        disabled={busy}
                        onClick={() => void commit({ ...value, reasoningEffort: effort.effort }).then((ok) => ok && setView("advanced"))}
                      />
                    ))}
                  {view === "speed" &&
                    speeds.map((speed) => (
                      <OptionButton
                        key={speed.id}
                        label={speed.displayName}
                        selected={speed.id === value.serviceTier}
                        disabled={busy}
                        onClick={() => void commit({ ...value, serviceTier: speed.id }).then((ok) => ok && setView("advanced"))}
                      />
                    ))}
                </SlimScroller>
              </div>
            )}

            {modelsLoading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" /> 正在读取模型目录…
              </p>
            )}
            {modelsError && (
              <div role="alert" className="mt-2 flex items-center gap-2 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                <span className="min-w-0 flex-1">{modelsError}</span>
                <Button variant="ghost" size="icon-sm" onClick={onRetryModels} aria-label="重试模型目录">
                  <RotateCw className="size-3" />
                </Button>
              </div>
            )}
          </div>
        )}

        {settingsError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {settingsError}
          </p>
        )}

        {view !== "quick" && quickIndex < 0 && (
          <div className="mt-2 border-t pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void resetToDefault()}
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            >
              <span>Reset to default</span>
              <RotateCcw className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
        {view !== "quick" && quickIndex >= 0 && (
          <div className="mt-2 border-t pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={returnToQuick}
              className="flex items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            >
              Advanced <ChevronUp className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
