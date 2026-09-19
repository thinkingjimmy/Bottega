/**
 * [INPUT]: React, shared selector trigger and lazy menu, native model-selection rules and i18next.
 * [OUTPUT]: Native selector and ModelMenuState with host-owned drafts, commit/error state and capability projections.
 * [POS]: The list-only model controller in the composer models surface; separate from selector.tsx's advanced panel, it reuses that trigger formatting and dual-column option language.
 */

import type { ReactNode } from "react";
import { listModelEffortState, listModelSpeedState, speedReasonKey } from "./selection";
import { DropdownMenu, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import { ModelSelectorTrigger } from "@ai-chat/ui/components/ui/model-selector";
import { lazy, Suspense, useState } from "react";
import { useComposerTranslation, type ComposerTranslate } from "../controls/copy/translation";
import type { AgentTurnOptions, BackendModelInfo, SessionServiceTierEffective } from "./contracts";

export type ChatModelListSelectorProps = {
  locale?: string; translate?: ComposerTranslate;
  value: AgentTurnOptions;
  effectiveServiceTier?: SessionServiceTierEffective;
  models: BackendModelInfo[];
  modelsLoading: boolean;
  modelsError: ReactNode;
  settingsError: string;
  disabled?: boolean;
  streaming?: boolean;
  saving?: boolean;
  onChange: (
    options: AgentTurnOptions,
    resetSessionEffective?: boolean
  ) => Promise<void>;
  onRetryModels: () => void;
};


const ModelMenu = lazy(() => import("./list-menu"));
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
  onRetryModels, locale = "en", translate,
}: ChatModelListSelectorProps) {
  const fallback = useComposerTranslation(locale), t = translate ?? fallback;
  const [open, setOpen] = useState(false);
  const [localBusy, setLocalBusy] = useState(false);
  const current =
    models.find((model) => model.slug === value.model) ??
    models.find((model) => model.isDefault);
  const effort = listModelEffortState(value, current);
  const speed = listModelSpeedState(value, current, effectiveServiceTier);
  const effortText = effort.label ?? t(effort.fallbackKey);
  const speedText = speed.label ?? t(speed.fallbackKey);
  const busy = disabled || saving || localBusy;
  const triggerLoading = saving || localBusy || (disabled && !streaming);
  const modelAdjustable = !busy && models.length > 1;
  const effortAdjustable = !busy && effort.adjustable;
  const speedAdjustable = !busy && speed.adjustable;
  /* 目录未到之前，这一行没有任何依据：模型名无处可取，effort 更是
     listModelEffortState 在空目录上只能给出 catalog fallback。骨架屏是"还不知道"
     唯一诚实的形状——而 `未知` 与 `已知的默认` 是两件事，后者（目录已到、
     后端确实自选模型）仍旧照实说出"默认模型"。 */
  const pending = modelsLoading && !current;
  const modelName = current?.displayName ?? value.model;
  const modelText =
    modelName ?? t("chat.composer.modelSelector.backendDefaultModel");
  const triggerText = pending
    ? t("chat.composer.modelSelector.loadingModels")
    : t("chat.composer.modelSelector.currentModel", {
        model: modelText,
        effort: effortText,
      });
  /* 原因只在意图与实际分叉时才是信息（listModelSpeedState 已经把这条判据
     收在 speed.reason 里），文案则永远从目录取。 */
  const speedReason = speed.reason
    ? t(speedReasonKey(speed.reason))
    : undefined;

  /* 成功即退场，失败才留下：菜单选完就关是菜单的常态，但设置提交是会失败的，
     而错误只在这块面板上有地方说。关得太早等于把回执连同重试一起吞掉。 */
  const commitAndClose = (
    next: AgentTurnOptions,
    resetSessionEffective = false
  ) => {
    setLocalBusy(true);
    void onChange(next, resetSessionEffective)
      .then(() => setOpen(false))
      .catch(() => {})
      .finally(() => setLocalBusy(false));
  };

  return { t, value, models, modelsLoading, modelsError, settingsError, onRetryModels, open, setOpen, current, effort, speed, effortText, speedText, busy, triggerLoading, modelAdjustable, effortAdjustable, speedAdjustable, pending, modelText, triggerText, speedReason, commitAndClose };
}
export type ModelMenuState = ReturnType<typeof useSelectorState>;
export function ChatModelListSelector(props: ChatModelListSelectorProps) {
  const state = useSelectorState(props);
  const { open, setOpen, effortText, busy, triggerLoading, pending, modelText, triggerText } = state;
  return (
    /* 非模态：它长在 Composer 上，身后是随时在流式更新的转录。为选一个模型
       把整页设成 inert，代价与收益不成比例。 */
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        {/* 触发器的几何只是内容的函数：展开只换底色，不换尺寸。宽度一旦改由
            open 决定，长模型名就会在点击时缩回去，而这行本就不该有多余的位移。 */}
        <ModelSelectorTrigger disabled={busy} aria-label={triggerText} pending={pending} loading={triggerLoading} open={open} model={modelText} effort={effortText} title={`${modelText} · ${effortText}`} />
      </DropdownMenuTrigger>
      {/* 面板与触发器共边同宽：下限 15rem 恰好容得下「标签 + 完整模型名 + 箭头」，
          再宽就只是空气——而空气是有代价的，一级越宽，与内容定宽的二级越不像
          同一族。上限 24rem 由最长模型名决定。跟随的是触发器而非自身内容，
          开合才不会晃。 */}
      {open && <Suspense fallback={null}><ModelMenu state={state} /></Suspense>}
    </DropdownMenu>
  );
}
