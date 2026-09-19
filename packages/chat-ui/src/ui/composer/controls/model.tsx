/**
 * [INPUT]: Executor model catalog, host choice and shared native selector views.
 * [OUTPUT]: Remote model/effort/speed adapters using the same quick and list UI as native Chat.
 * [POS]: Capability projection only; the host stores choices and owns submission.
 */
import type { RemoteModel } from "@ai-chat/cloud-protocol/remote/model";
import { ChatModelSelector } from "../models/selector";
import { ChatModelListSelector } from "../models/list";
import type { AgentTurnOptions, CodexModelInfo, CodexTurnOptions } from "../models/contracts";
export type ModelChoice = { model?: string; reasoningEffort?: string; serviceTier?: string };
export function currentModel(models: readonly RemoteModel[] | undefined, value: ModelChoice) {
  return models?.find(model => model.slug === value.model) ?? models?.find(model => model.isDefault);
}
export function ComposerModelSelector({ locale, backend = "claude", models, value, disabled, onChange }: {
  locale: string; backend?: AgentTurnOptions["backend"]; models: readonly RemoteModel[] | undefined; value: ModelChoice; disabled?: boolean; onChange(next: ModelChoice): void;
}) {
  const catalog: CodexModelInfo[] = (models ?? []).map(model => ({ ...model, defaultReasoningEffort: model.defaultReasoningEffort ?? model.supportedReasoningEfforts?.[0]?.id ?? "medium",
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map(effort => ({ effort: effort.id, displayName: effort.displayName, description: "" })),
    serviceTiers: model.serviceTiers ?? [] }));
  const current = currentModel(models, value), defaults = models?.find(model => model.isDefault) ?? models?.[0];
  const props = { locale, models: catalog, disabled, modelsLoading: models === undefined, modelsError: null, settingsError: "", onRetryModels: () => {},
    onChange: async (next: AgentTurnOptions) => onChange({ ...(next.model ? { model: next.model } : {}),
      ...(next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {}), ...("serviceTier" in next && next.serviceTier ? { serviceTier: next.serviceTier } : {}) }) };
  if (backend !== "codex" || !current) return <ChatModelListSelector {...props} value={{ backend, permissionMode: "approve-for-me", ...value } as AgentTurnOptions} />;
  const codex: CodexTurnOptions = { backend, permissionMode: "approve-for-me", model: current.slug,
    reasoningEffort: value.reasoningEffort ?? current.defaultReasoningEffort ?? "medium", serviceTier: value.serviceTier ?? current.serviceTiers?.[0]?.id ?? "default" };
  return <ChatModelSelector {...props} value={codex} defaultOptions={{ ...codex, model: defaults?.slug ?? codex.model,
    reasoningEffort: defaults?.defaultReasoningEffort ?? codex.reasoningEffort, serviceTier: defaults?.serviceTiers?.[0]?.id ?? "default" }} />;
}
