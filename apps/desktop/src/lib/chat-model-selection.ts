/**
 * [INPUT]: Depends on shared Agent/Codex turn options and ability to catalog the Backend/Codex model
 * [OUTPUT]: Provides default options, catalog-addressed effort/tier fallbacks, preference-versus-effective Speed presentation, Speed reason addressing, external labels, and model switching
 * [POS]: lib's chat model chooses a pure rule layer that allows UI, perpetuation and testing to share the same set of side-effects-free decisions
 */

import type {
  AgentTurnOptions,
  BackendModelInfo,
  CodexTurnOptions,
  SessionServiceTierEffective,
  SessionServiceTierReason,
} from "../../shared/agent-ipc";
import type { CodexModelInfo } from "../../shared/settings-ipc";

export const DEFAULT_QUICK_CHAT_OPTIONS: CodexTurnOptions = {
  backend: "codex",
  model: "gpt-5.6-sol",
  reasoningEffort: "xhigh",
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

/** 运行态判据 → 目录键。文案只住在五语言目录里，规则层只负责寻址。 */
const SPEED_REASON_KEYS = {
  modelUnsupported: "chat.composer.modelSelector.speedReason.modelUnsupported",
  backendOff: "chat.composer.modelSelector.speedReason.backendOff",
  backendOn: "chat.composer.modelSelector.speedReason.backendOn",
} as const satisfies Record<SessionServiceTierReason, string>;

export const speedReasonKey = (reason: SessionServiceTierReason) =>
  SPEED_REASON_KEYS[reason];

export function quickEffortIndex(
  options: CodexTurnOptions,
  model?: BackendModelInfo
) {
  return (model?.supportedReasoningEfforts ?? [])
    .filter((entry) => !entry.hidden)
    .findIndex((entry) => entry.effort === options.reasoningEffort);
}

export function optionsForModel(
  current: CodexTurnOptions,
  model: CodexModelInfo
): CodexTurnOptions {
  const efforts = model.supportedReasoningEfforts ?? [];
  const reasoningEffort = efforts.some(
    (entry) => entry.effort === current.reasoningEffort
  )
    ? current.reasoningEffort
    : model.defaultReasoningEffort || current.reasoningEffort;
  return {
    backend: current.backend,
    model: model.slug,
    reasoningEffort,
    /* Capability changes never consume the persisted user preference. */
    serviceTier: current.serviceTier,
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
  /* List-only and full selectors share the same rule: tier capability is a
     runtime fact and never rewrites the user's persisted preference. */
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
    label: selected?.label,
    fallbackKey: "chat.composer.modelFallback.defaultEffort" as const,
    options,
    adjustable: options.length > 1,
  };
}

export function listModelSpeedState(
  current: AgentTurnOptions,
  model?: BackendModelInfo,
  effective?: SessionServiceTierEffective
) {
  const options = model?.serviceTiers ?? [];
  const requested = "serviceTier" in current ? current.serviceTier : undefined;
  const preferred = options.find((entry) => entry.id === requested) ?? options[0];
  const active = effective
    ? options.find((entry) => entry.id === effective.value) ?? {
        id: effective.value,
        displayName: effective.value,
      }
    : preferred;
  const diverged = Boolean(
    effective && preferred && active && preferred.id !== active.id
  );
  return {
    value: preferred?.id,
    label: diverged && preferred && active
      ? `${preferred?.displayName} → ${active?.displayName}`
      : preferred?.displayName,
    fallbackKey: "chat.composer.modelFallback.standardSpeed" as const,
    preferredLabel: preferred?.displayName,
    activeLabel: active?.displayName,
    reason: diverged ? effective?.reason : undefined,
    diverged,
    options,
    adjustable: options.some((entry) => entry.id !== "default"),
  };
}

export function optionsLabel(
  options: CodexTurnOptions,
  models: CodexModelInfo[]
) {
  const model = findModel(models, options.model);
  return `${compactModelLabel(model?.displayName ?? options.model)} ${effortLabel(options.reasoningEffort)}`;
}
