/**
 * [INPUT]: Depends on the composer model catalog and effort labels, configuration field states, desktop factory defaults and shared Select primitives.
 * [OUTPUT]: Provides ConfigModelFields with catalog-only model and reasoning choices, inherited defaults and preserved unavailable values.
 * [POS]: Model fields inside AgentConfigDialog; discovery cannot rewrite an existing configuration.
 */
import type { AgentConfigPayload } from "@ai-chat/cloud-protocol/agent-config/payload";
import { effortLabel } from "@ai-chat/chat-ui/models/selection";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import type { WorkbenchCopy } from "@ai-chat/ui/lib/workbench-copy";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { isAgentBackendId } from "@/lib/agent/agent-backends";
import { DEFAULT_CHAT_OPTIONS_BY_BACKEND } from "../../../../../shared/chat-agent/options";
import { useConfigModels } from "./catalog";

type Choice = AgentConfigPayload["model"];
type Selection = Pick<AgentConfigPayload, "model" | "reasoningEffort">;
const INHERIT = { mode: "inherit" } as const;
const choiceKey = (value: Choice) => value.mode === "explicit" ? `explicit:${JSON.stringify(value.value)}` : value.mode;
const choiceOf = (value: string): Choice => value.startsWith("explicit:")
  ? { mode: "explicit", value: JSON.parse(value.slice(9)) as string }
  : value === "reset" ? { mode: "reset" } : INHERIT;

export function ConfigModelFields({ id, provider, value, copy, modelTiming, effortTiming, disabled, onChange }: {
  id: string; provider: string; value: Selection; copy: WorkbenchCopy["agentConfigs"];
  modelTiming: string; effortTiming: string; disabled: boolean; onChange(value: Selection): void;
}) {
  const { t } = useAppTranslation();
  const inventory = useConfigModels(provider);
  const factory = isAgentBackendId(provider) ? DEFAULT_CHAT_OPTIONS_BY_BACKEND[provider] : undefined;
  const resolveModel = (choice: Choice) => {
    if (choice.mode === "inherit") {
      if (!inventory.defaults) return undefined;
      return inventory.defaults.model == null ? inventory.models.find(model => model.isDefault)
        : inventory.models.find(model => model.slug === inventory.defaults!.model);
    }
    const slug = choice.mode === "reset" ? factory?.model : choice.value;
    return slug == null ? inventory.models.find(model => model.isDefault) : inventory.models.find(model => model.slug === slug);
  };
  const modelValue = value.model.mode === "explicit" ? value.model.value : undefined;
  const effortValue = value.reasoningEffort.mode === "explicit" ? value.reasoningEffort.value : undefined;
  const current = resolveModel(value.model);
  const efforts = (current?.supportedReasoningEfforts ?? []).filter(option => !option.hidden);
  const modelUnknown = value.model.mode === "explicit" && !inventory.models.some(model => model.slug === modelValue);
  const effortUnknown = value.reasoningEffort.mode === "explicit" && !efforts.some(option => option.effort === effortValue);
  const settled = !inventory.loading && !inventory.failed;
  const savedLabel = (choice: Choice) => choice.mode !== "explicit" ? copy.agentDefault : String(choice.value);
  const chooseModel = (next: string) => {
    const model = choiceOf(next);
    const target = resolveModel(model);
    const supported = target?.supportedReasoningEfforts ?? [];
    const defaults = value.reasoningEffort.mode === "reset" ? factory : inventory.defaults;
    const requested = value.reasoningEffort.mode === "explicit" ? effortValue
      : defaults && "reasoningEffort" in defaults ? defaults.reasoningEffort : undefined;
    // Unknown capabilities cannot justify clearing a saved request. Only a deliberate model change reconciles it.
    const incompatible = target && requested && !supported.some(option => option.effort === requested);
    const advertisedDefault = supported.find(option => option.effort === target?.defaultReasoningEffort);
    const reasoningEffort: Choice = incompatible ? advertisedDefault
      ? { mode: "explicit", value: advertisedDefault.effort } : { mode: "reset" } : value.reasoningEffort;
    onChange({ model, reasoningEffort });
  };
  const modelHint = !provider ? copy.chooseProvider : inventory.loading ? t("chat.composer.modelSelector.loadingModels")
    : inventory.failed ? copy.modelsFailed : !inventory.supported ? copy.resourceUnavailable
    : inventory.models.length === 0 ? t("chat.composer.modelSelector.noModels") : modelUnknown ? copy.optionUnavailable : undefined;
  const waitingDefaults = value.model.mode === "inherit" && inventory.defaultsLoading;
  const failedDefaults = value.model.mode === "inherit" && inventory.defaultsFailed;
  const effortHint = !provider ? copy.chooseProvider : waitingDefaults ? t("chat.composer.modelSelector.loadingModels")
    : failedDefaults ? copy.defaultsFailed : inventory.loading || inventory.failed ? undefined
    : effortUnknown ? copy.optionUnavailable : !current ? copy.chooseModelForEffort
    : efforts.length === 0 ? t("chat.composer.modelSelector.effortUnavailable") : undefined;
  return <div className="flex flex-col gap-4">
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3"><label htmlFor={`${id}-model`} className="font-medium text-sm">{copy.model}</label><span className="text-xs text-muted-foreground">{modelTiming}</span></div>
      <Select value={choiceKey(value.model)} disabled={disabled || !provider} onValueChange={chooseModel}>
        <SelectTrigger id={`${id}-model`} aria-describedby={modelHint ? `${id}-model-hint` : undefined} className="w-full min-w-0 pointer-coarse:h-11"><SelectValue /></SelectTrigger>
        <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
          <SelectItem value="inherit">{copy.providerDefault}</SelectItem>
          {value.model.mode === "reset" && <SelectItem value="reset">{copy.agentDefault}</SelectItem>}
          {modelUnknown && <SelectItem value={choiceKey(value.model)} disabled>{savedLabel(value.model)}{settled ? ` · ${copy.resourceUnavailable}` : ""}</SelectItem>}
          {inventory.models.map(model => <SelectItem key={model.slug} value={choiceKey({ mode: "explicit", value: model.slug })}>{model.displayName}</SelectItem>)}
        </SelectContent>
      </Select>
      {modelHint && <p id={`${id}-model-hint`} role={inventory.failed ? "alert" : "status"} className="text-xs text-muted-foreground">{modelHint}</p>}
    </div>
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3"><label htmlFor={`${id}-effort`} className="font-medium text-sm">{copy.reasoningEffort}</label><span className="text-xs text-muted-foreground">{effortTiming}</span></div>
      {/* Remount the native form select when its option catalog changes, so removing its old option cannot emit an inherited value. */}
      <Select key={`${provider}:${current?.slug ?? choiceKey(value.model)}`} value={choiceKey(value.reasoningEffort)} disabled={disabled || !provider || (efforts.length === 0 && value.reasoningEffort.mode === "inherit")} onValueChange={next => {
        const reasoningEffort = choiceOf(next);
        // Explicit effort belongs to this exact model, including a Provider that normally chooses its own default.
        onChange({ model: reasoningEffort.mode === "explicit" && current ? { mode: "explicit", value: current.slug } : value.model, reasoningEffort });
      }}>
        <SelectTrigger id={`${id}-effort`} aria-describedby={effortHint ? `${id}-effort-hint` : undefined} className="w-full min-w-0 pointer-coarse:h-11"><SelectValue /></SelectTrigger>
        <SelectContent className="max-w-[min(32rem,calc(100vw-2rem))]">
          <SelectItem value="inherit">{copy.providerDefault}</SelectItem>
          {value.reasoningEffort.mode === "reset" && <SelectItem value="reset">{copy.agentDefault}</SelectItem>}
          {effortUnknown && <SelectItem value={choiceKey(value.reasoningEffort)} disabled>{savedLabel(value.reasoningEffort)}{settled && !waitingDefaults && !failedDefaults ? ` · ${copy.resourceUnavailable}` : ""}</SelectItem>}
          {efforts.map(option => <SelectItem key={option.effort} value={choiceKey({ mode: "explicit", value: option.effort })}>{option.displayName ?? effortLabel(option.effort)}</SelectItem>)}
        </SelectContent>
      </Select>
      {effortHint && <p id={`${id}-effort-hint`} role={failedDefaults ? "alert" : "status"} className="text-xs text-muted-foreground">{effortHint}</p>}
    </div>
    {(inventory.failed || failedDefaults) && <Button type="button" size="sm" variant="outline" className="self-start" disabled={disabled} onClick={inventory.retry}>{t("chat.composer.modelSelector.retryModels")}</Button>}
  </div>;
}
