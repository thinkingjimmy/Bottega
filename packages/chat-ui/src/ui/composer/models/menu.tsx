/**
 * [INPUT]: Host-computed model state and shared menu presentation primitives.
 * [OUTPUT]: Provides the on-demand full model menu — models, reasoning effort and speed — without moving native commit rules.
 * [POS]: The lazy content behind selector.tsx's trigger in the composer models surface; the trigger itself stays in the eager composer.
 */

import { compactModelLabel, effortLabel, optionsForModel } from "./selection";
import { Button } from "@ai-chat/ui/components/ui/button";
import { PopoverContent } from "@ai-chat/ui/components/ui/popover";
import { Slider } from "@ai-chat/ui/components/ui/slider";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { cn } from "@ai-chat/ui/lib/utils";
import { Check, ChevronLeft, ChevronRight, ChevronUp, Circle, LoaderCircle, RotateCcw, RotateCw, Sparkles, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import type { ModelMenuState } from "./selector";
const sparkleStyles = ["-0.1s", "-0.45s", "-0.8s", "-1.15s", "-1.5s"];

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


export default function ModelMenu({ state }: { state: ModelMenuState }) {
  const { t, value, models, modelsLoading, modelsError, settingsError, onRetryModels, view, setView, draftIndex, setDraftIndex, busy, currentModel, sliderEfforts, quickIndex, preferredTier, fast, speedDiverged, speedSummary, speedReason, efforts, speeds, supportsSpeed, commit, changeEffort, toggleFast, returnToQuick, resetToDefault, triggerModel } = state;
  return (
      <PopoverContent
        side="top"
        align="end"
        className="w-(--radix-popover-trigger-width) min-w-72 max-w-[min(24rem,100vw-2rem)] p-3 [&_button:not(:disabled)]:cursor-pointer"
        aria-label={t("chat.composer.modelSelector.selector")}
      >
        {view === "quick" ? (
          <div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setView("advanced")}
                className="flex items-center gap-1 rounded-md px-1 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {t("chat.composer.modelSelector.advanced")} <ChevronRight className="size-4" aria-hidden="true" />
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy || !supportsSpeed}
                aria-label={t(
                  fast
                    ? "chat.composer.modelSelector.disableFast"
                    : "chat.composer.modelSelector.enableFast"
                )}
                aria-pressed={fast}
                title={speedReason}
                onClick={() => void toggleFast()}
                className={cn(fast && "text-[#3598f6] hover:text-[#3598f6]")}
              >
                <Zap className={cn("size-4", fast && "fill-current")} />
              </Button>
            </div>
            <div className="relative mt-3 overflow-hidden rounded-full">
              <div className="pointer-events-none absolute inset-x-3.5 top-1/2 z-10 flex -translate-y-1/2 justify-between" aria-hidden="true">
                {sliderEfforts.map((effort, index) => (
                  <Circle
                    key={effort.effort}
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
                max={Math.max(0, sliderEfforts.length - 1)}
                step={1}
                value={[draftIndex]}
                disabled={busy || sliderEfforts.length <= 1}
                onValueChange={([index]) => setDraftIndex(index ?? 0)}
                onValueCommit={([index]) => void changeEffort(index ?? 0)}
                aria-label={t("chat.composer.modelSelector.quickTier")}
                aria-valuetext={`${compactModelLabel(currentModel?.displayName ?? value.model)} ${effortLabel(sliderEfforts[draftIndex]?.effort ?? value.reasoningEffort)}`}
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
            {speedDiverged && (
              <p
                role="status"
                className="mt-2 text-xs text-muted-foreground"
              >
                <span className="font-medium text-foreground">{speedSummary}</span>
                {speedReason && ` · ${speedReason}`}
              </p>
            )}
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
                  <span className="font-medium">{t("chat.composer.modelSelector.model")}</span>
                  <span className="ml-auto truncate text-muted-foreground">{triggerModel}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                <button
                  type="button"
                  onClick={() => setView("effort")}
                  disabled={busy || !currentModel}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <span className="font-medium">{t("chat.composer.modelSelector.effort")}</span>
                  <span className="ml-auto truncate text-muted-foreground">{effortLabel(value.reasoningEffort)}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
                {supportsSpeed && <button
                  type="button"
                  onClick={() => setView("speed")}
                  disabled={busy || !currentModel}
                  className="flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <span className="font-medium">{t("chat.composer.modelSelector.speed")}</span>
                  <span className="ml-auto min-w-0 text-right text-muted-foreground">
                    <span className="block truncate">{speedSummary}</span>
                    {speedReason && (
                      <span className="block truncate text-xs">
                        {speedReason}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>}
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
                  {view === "model"
                    ? t("chat.composer.modelSelector.model")
                    : view === "effort"
                      ? t("chat.composer.modelSelector.effort")
                      : t("chat.composer.modelSelector.speed")}
                </button>
                <SlimScroller className="max-h-64 overflow-y-auto">
                  {view === "model" &&
                    models.map((model) => (
                      <OptionButton
                        key={model.slug}
                        label={compactModelLabel(model.displayName)}
                        selected={model.slug === value.model}
                        disabled={busy}
                        onClick={() => void commit(optionsForModel(value, model), true).then((ok) => ok && setView("advanced"))}
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
                        selected={speed.id === preferredTier}
                        disabled={busy}
                        onClick={() => void commit({ ...value, serviceTier: speed.id }, true).then((ok) => ok && setView("advanced"))}
                      />
                    ))}
                </SlimScroller>
                {view === "speed" && (
                  <div className="mt-2 space-y-1 border-t pt-2 text-xs text-muted-foreground">
                    <p>{t("chat.composer.modelSelector.speedDescription")}</p>
                    {speedDiverged && (
                      <p role="status">
                        <span className="font-medium text-foreground">{speedSummary}</span>
                        {speedReason && ` · ${speedReason}`}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {modelsLoading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin" /> {t("chat.composer.modelSelector.loadingModels")}
              </p>
            )}
            {modelsError && (
              <div className="mt-2 space-y-1.5">
                {modelsError}
                <Button variant="ghost" size="icon-sm" onClick={onRetryModels} aria-label={t("chat.composer.modelSelector.retryModels")}>
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
              <span>{t("chat.composer.modelSelector.resetDefault")}</span>
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
              {t("chat.composer.modelSelector.advanced")} <ChevronUp className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </PopoverContent>
  );
}
