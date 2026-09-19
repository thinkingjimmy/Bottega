/**
 * [INPUT]: React, shared selector trigger and lazy menu, native model-selection rules and i18next.
 * [OUTPUT]: Native selector and ModelMenuState with host-owned drafts, commit/error state and capability projections.
 * [POS]: The advanced model controller in the composer models surface; list.tsx carries the list-only variant.
 */

import type { ReactNode } from "react";
import { compactModelLabel, DEFAULT_QUICK_CHAT_OPTIONS, effortLabel, findModel, quickEffortIndex, speedReasonKey } from "./selection";
import { ModelSelectorTrigger } from "@ai-chat/ui/components/ui/model-selector";
import { Popover, PopoverTrigger } from "@ai-chat/ui/components/ui/popover";
import { Zap } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useComposerTranslation, type ComposerTranslate } from "../controls/copy/translation";
import type { CodexTurnOptions, SessionServiceTierEffective } from "./contracts";
import type { CodexModelInfo } from "./contracts";

type SelectorView = "quick" | "advanced" | "model" | "effort" | "speed";

export type ChatModelSelectorProps = {
  locale?: string; translate?: ComposerTranslate; defaultOptions?: CodexTurnOptions;
  value: CodexTurnOptions;
  effectiveServiceTier?: SessionServiceTierEffective;
  models: CodexModelInfo[];
  modelsLoading: boolean;
  modelsError: ReactNode;
  settingsError: string;
  disabled?: boolean;
  streaming?: boolean;
  saving?: boolean;
  onChange: (
    options: CodexTurnOptions,
    resetSessionEffective?: boolean
  ) => Promise<void>;
  onRetryModels: () => void;
};


const ModelMenu = lazy(() => import("./menu"));
function speedLabel(tier: string, model?: CodexModelInfo) {
  return model?.serviceTiers?.find((entry) => entry.id === tier)?.displayName ?? tier;
}

function useSelectorState({
  value,
  effectiveServiceTier,
  models,
  modelsLoading,
  modelsError,
  settingsError,
  disabled = false,
  streaming = false,
  saving = false,
  onChange,
  onRetryModels, locale = "en", translate, defaultOptions = DEFAULT_QUICK_CHAT_OPTIONS,
}: ChatModelSelectorProps) {
  const fallback = useComposerTranslation(locale), t = translate ?? fallback;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<SelectorView>("quick");
  const [draftIndex, setDraftIndex] = useState(0);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = disabled || saving || localBusy;
  const triggerLoading = saving || localBusy || (disabled && !streaming);
  const currentModel = findModel(models, value.model);
  const sliderEfforts = (currentModel?.supportedReasoningEfforts ?? []).filter(
    (entry) => !entry.hidden
  );
  const quickIndex = quickEffortIndex(value, currentModel);
  const preferredTier = value.serviceTier;
  const fast = preferredTier !== "default";
  const effectiveTier = effectiveServiceTier?.value ?? preferredTier;
  const speedDiverged = effectiveTier !== preferredTier;
  const speedSummary = speedDiverged
    ? `${speedLabel(preferredTier, currentModel)} → ${speedLabel(effectiveTier, currentModel)}`
    : speedLabel(preferredTier, currentModel);
  /* 原因只在意图与实际分叉时才是信息；没分叉时它只是噪音。 */
  const speedReason =
    speedDiverged && effectiveServiceTier
      ? t(speedReasonKey(effectiveServiceTier.reason))
      : undefined;

  const efforts = currentModel?.supportedReasoningEfforts ?? [];
  const speeds = currentModel?.serviceTiers ?? [];
  const supportsSpeed = speeds.some((tier) => tier.id !== "default");

  const commit = async (
    next: CodexTurnOptions,
    resetSessionEffective = false
  ) => {
    setLocalBusy(true);
    try {
      await onChange(next, resetSessionEffective);
      return true;
    } catch {
      return false;
    } finally {
      setLocalBusy(false);
    }
  };

  const changeEffort = async (index: number) => {
    const effort = sliderEfforts[index]?.effort;
    if (!effort) return;
    await commit({ ...value, reasoningEffort: effort });
  };

  const toggleFast = async () => {
    /* 档位只从当前模型自己广告的目录里取——能力检查就是这一句 find，
       产品侧不再养第二张会漂移的模型能力表。 */
    const nextTier = fast
      ? "default"
      : speeds.find((tier) => tier.id !== "default")?.id;
    if (!nextTier) return;
    await commit({ ...value, serviceTier: nextTier }, true);
  };

  const returnToQuick = () => {
    setView("quick");
  };

  const resetToDefault = async () => {
    const ok = await commit(
      {
        ...defaultOptions,
        permissionMode: value.permissionMode,
      },
      true
    );
    if (!ok) return;
    setDraftIndex(
      Math.max(0, quickEffortIndex(defaultOptions, currentModel))
    );
    setView("quick");
  };

  const triggerModel = compactModelLabel(
    currentModel?.displayName ?? value.model
  );

  return { t, value, models, modelsLoading, modelsError, settingsError, onRetryModels, open, setOpen, view, setView, draftIndex, setDraftIndex, busy, triggerLoading, currentModel, sliderEfforts, quickIndex, preferredTier, fast, speedDiverged, speedSummary, speedReason, efforts, speeds, supportsSpeed, commit, changeEffort, toggleFast, returnToQuick, resetToDefault, triggerModel };
}
export type ModelMenuState = ReturnType<typeof useSelectorState>;
export function ChatModelSelector(props: ChatModelSelectorProps) {
  const state = useSelectorState(props);
  const { t, value, open, setOpen, setView, setDraftIndex, busy, triggerLoading, quickIndex, fast, triggerModel } = state;
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
        <ModelSelectorTrigger disabled={busy} aria-label={t("chat.composer.modelSelector.currentModel", { model: triggerModel, effort: effortLabel(value.reasoningEffort) })} pending={false} loading={triggerLoading} open={open} model={triggerModel} effort={effortLabel(value.reasoningEffort)} title={`${triggerModel} · ${effortLabel(value.reasoningEffort)}`} icon={fast ? <Zap className="size-4 shrink-0 fill-current" aria-hidden="true" /> : undefined} />
      </PopoverTrigger>
      {/* 面板与触发器共边同宽：下限 18rem 是内容可读的底，上限 24rem 由最宽
          视图（effort 列表实测 361px）决定——再宽只是空气。跟随的是触发器而非
          自身内容，视图切换才不会晃。 */}
      {open && <Suspense fallback={null}><ModelMenu state={state} /></Suspense>}
    </Popover>
  );
}
