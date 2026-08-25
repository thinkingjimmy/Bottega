/**
 * [INPUT]: Depends on shared Agent/Codex turn options and ability to catalog the Backend/Codex model
 * [OUTPUT]: Provides default quick options, five-tier model pre-set, tag formatting, and full/list-only model switching with backend exclusive Effort
 * [POS]: lib's chat model chooses a pure rule layer that allows UI, perpetuation and testing to share the same set of side-effects-free decisions
 */

import type {
  AgentTurnOptions,
  BackendModelInfo,
  CodexTurnOptions,
} from "../../shared/agent-ipc";
import type { CodexModelInfo } from "../../shared/settings-ipc";

export const QUICK_CHAT_PRESETS: readonly Omit<CodexTurnOptions, "permissionMode">[] = [
  { backend: "codex", model: "gpt-5.6-terra", reasoningEffort: "low", serviceTier: "default" },
  { backend: "codex", model: "gpt-5.6-sol", reasoningEffort: "low", serviceTier: "default" },
  { backend: "codex", model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default" },
  { backend: "codex", model: "gpt-5.6-sol", reasoningEffort: "high", serviceTier: "default" },
  { backend: "codex", model: "gpt-5.6-sol", reasoningEffort: "xhigh", serviceTier: "default" },
] as const;

export const DEFAULT_QUICK_CHAT_OPTIONS: CodexTurnOptions = {
  ...QUICK_CHAT_PRESETS[4]!,
  serviceTier: "priority",
  permissionMode: "approve-for-me",
};

const effortLabels: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Light",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

export const effortLabel = (effort: string) =>
  effortLabels[effort] ?? effort.replace(/(^|[-_])\w/g, (part) => part.replace(/[-_]/, "").toUpperCase());

export const compactModelLabel = (label: string) =>
  label.replace(/^GPT-/i, "").replace(/-/g, " ");

export function findModel(
  models: CodexModelInfo[],
  slug: string
) {
  return models.find((model) => model.slug === slug);
}

export function modelSupportsTier(
  models: CodexModelInfo[],
  modelSlug: string,
  tier: string
) {
  if (tier === "default") return true;
  const model = findModel(models, modelSlug);
  return (
    !model ||
    !Array.isArray(model.serviceTiers) ||
    model.serviceTiers.some((entry) => entry.id === tier)
  );
}

export function quickPresetIndex(options: CodexTurnOptions) {
  return QUICK_CHAT_PRESETS.findIndex(
    (preset) =>
      preset.model === options.model &&
      preset.reasoningEffort === options.reasoningEffort
  );
}

export function optionsForModel(
  current: CodexTurnOptions,
  model: CodexModelInfo
): CodexTurnOptions {
  const serviceTier = (model.serviceTiers ?? []).some(
    (tier) => tier.id === current.serviceTier
  )
    ? current.serviceTier
    : "default";
  return {
    backend: current.backend,
    model: model.slug,
    reasoningEffort: model.defaultReasoningEffort || current.reasoningEffort,
    serviceTier,
    permissionMode: current.permissionMode,
  };
}

export function optionsForListModel(
  current: AgentTurnOptions,
  model: BackendModelInfo
) {
  const next = {
    ...current,
    model: model.slug,
  } as AgentTurnOptions & { reasoningEffort?: string };
  const efforts = model.supportedReasoningEfforts ?? [];
  const selected =
    "reasoningEffort" in current ? current.reasoningEffort : undefined;
  if (selected && efforts.some((entry) => entry.effort === selected)) {
    next.reasoningEffort = selected;
  } else if (model.defaultReasoningEffort) {
    next.reasoningEffort = model.defaultReasoningEffort;
  } else {
    delete next.reasoningEffort;
  }
  return next;
}

export function listModelEffortState(
  current: AgentTurnOptions,
  model?: BackendModelInfo
) {
  const options = (model?.supportedReasoningEfforts ?? [])
    .filter((entry) => !entry.hidden)
    .map((entry) => ({
      ...entry,
      label: entry.displayName ?? effortLabel(entry.effort),
    }));
  const requested =
    "reasoningEffort" in current ? current.reasoningEffort : undefined;
  const selected =
    options.find((entry) => entry.effort === requested) ??
    options.find((entry) => entry.effort === model?.defaultReasoningEffort) ??
    options[0];
  return {
    value: selected?.effort,
    label: selected?.label ?? "Default",
    options,
    adjustable: options.length > 1,
  };
}

export function optionsLabel(
  options: CodexTurnOptions,
  models: CodexModelInfo[]
) {
  const model = findModel(models, options.model);
  return `${compactModelLabel(model?.displayName ?? options.model)} ${effortLabel(options.reasoningEffort)}`;
}
