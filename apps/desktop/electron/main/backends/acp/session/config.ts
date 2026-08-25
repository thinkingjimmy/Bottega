/**
 * [INPUT]: Depends on ACP session configOptions and BackendTurnOptions
 * [OUTPUT]: Provides AcpTurnConfigValues, config wire, convergence, and permissions for each application
 * [POS]: The ACP session configures the clear boundaries; AcpTurn is called in fixed order before prompt, and the direction depends on the constant acp-turn → This file
 */

import {
  AGENT_METHODS,
  type ClientContext,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";
import type { BackendTurnOptions } from "../../types";

/**
 * 每 turn 会话配置的三格数据；AcpSpawnConfig 组合本类型，方向恒为
 * acp-turn → session/config，不回头。
 */
export type AcpTurnConfigValues = {
  modeValues?: {
    default: string | readonly string[];
    plan: string | readonly string[];
    approveForMe: string | readonly string[];
    fullAccess?: string | readonly string[];
  };
  collaborationValues?: { default: string; plan: string };
  serviceTierValues?: Record<string, string>;
};

export type SessionConfigState = {
  configOptions?: SessionConfigOption[] | null;
};

type SelectConfig = Extract<SessionConfigOption, { type: "select" }>;

export function sessionConfigState(value: unknown): SessionConfigState {
  if (!value || typeof value !== "object") return {};
  const configOptions = (value as SessionConfigState).configOptions;
  return configOptions === null || Array.isArray(configOptions)
    ? { configOptions }
    : {};
}

function selectValues(config: SelectConfig) {
  return config.options.flatMap((option) =>
    "value" in option
      ? [option.value]
      : option.options.map((entry) => entry.value)
  );
}

function selectConfig(
  state: SessionConfigState,
  value: string,
  match: (option: SelectConfig) => boolean,
  missing: string,
  rejected: string
) {
  const config = state.configOptions?.find(
    (option): option is SelectConfig => option.type === "select" && match(option)
  );
  if (!config) throw new Error(missing);
  if (!selectValues(config).includes(value)) throw new Error(rejected);
  return config;
}

function modelConfig(state: SessionConfigState, model: string) {
  return selectConfig(
    state,
    model,
    (option) => option.category === "model" || option.id === "model",
    "ACP 后端未返回可配置的模型目录",
    "ACP 后端拒绝了当前模型候选"
  );
}

function thinkingConfig(state: SessionConfigState, effort: string) {
  return selectConfig(
    state,
    effort,
    (option) =>
      option.category === "thought_level" ||
      option.id === "thinking" ||
      option.id === "effort",
    "ACP 后端未返回可配置的 Thinking Effort",
    "ACP 后端拒绝了当前 Thinking Effort"
  );
}

function namedSelectConfig(
  state: SessionConfigState,
  id: string,
  value: string
) {
  return selectConfig(
    state,
    value,
    (option) => option.id === id,
    `ACP 后端未返回 ${id} 配置`,
    `ACP 后端拒绝了 ${id}=${value}`
  );
}

function modeConfig(
  state: SessionConfigState,
  requested: string | readonly string[]
) {
  const candidates = typeof requested === "string" ? [requested] : requested;
  const config = state.configOptions?.find(
    (option): option is SelectConfig =>
      option.type === "select" &&
      (option.category === "mode" || option.id === "mode")
  );
  if (!config) throw new Error("ACP 后端未返回可配置的工作模式");
  const available = new Set(selectValues(config));
  const mode = candidates.find((candidate) => available.has(candidate));
  if (!mode) throw new Error("ACP 后端拒绝了当前工作模式");
  return { config, mode };
}

async function applyConfig(
  context: ClientContext,
  sessionId: string,
  state: SessionConfigState,
  config: SelectConfig,
  value: string,
  verify: (state: SessionConfigState, value: string) => SelectConfig,
  errorMessage: string
) {
  if (config.currentValue === value) return state;
  const changed = await context.request(
    AGENT_METHODS.session_set_config_option,
    { sessionId, configId: config.id, value }
  );
  if (verify(changed, value).currentValue !== value) {
    throw new Error(errorMessage);
  }
  return changed;
}

export async function applyTurnConfiguration(
  context: ClientContext,
  sessionId: string,
  state: SessionConfigState,
  payload: BackendTurnOptions["payload"],
  config: AcpTurnConfigValues
) {
  let current = state;
  const turnOptions = payload.turnOptions;
  const model = "model" in turnOptions ? turnOptions.model : undefined;
  if (model) {
    current = await applyConfig(
      context,
      sessionId,
      current,
      modelConfig(current, model),
      model,
      modelConfig,
      "ACP 后端未应用请求的模型"
    );
  }
  const effort =
    "reasoningEffort" in turnOptions
      ? turnOptions.reasoningEffort
      : undefined;
  if (effort) {
    current = await applyConfig(
      context,
      sessionId,
      current,
      thinkingConfig(current, effort),
      effort,
      thinkingConfig,
      "ACP 后端未应用请求的 Thinking Effort"
    );
  }
  if (config.serviceTierValues && "serviceTier" in turnOptions) {
    const value = config.serviceTierValues[turnOptions.serviceTier];
    if (!value) throw new Error("ACP 后端不支持当前 Speed 档位");
    const option = namedSelectConfig(current, "fast-mode", value);
    current = await applyConfig(
      context,
      sessionId,
      current,
      option,
      value,
      (next, expected) => namedSelectConfig(next, "fast-mode", expected),
      "ACP 后端未应用请求的 Speed 档位"
    );
  }
  if (config.collaborationValues) {
    const value = payload.planMode
      ? config.collaborationValues.plan
      : config.collaborationValues.default;
    const option = namedSelectConfig(current, "collaboration_mode", value);
    current = await applyConfig(
      context,
      sessionId,
      current,
      option,
      value,
      (next, expected) =>
        namedSelectConfig(next, "collaboration_mode", expected),
      "ACP 后端未应用请求的协作模式"
    );
  }
  if (!config.modeValues) return;
  const requested = acpTurnMode(payload, config.modeValues);
  const { config: modeOption, mode } = modeConfig(current, requested);
  await applyConfig(
    context,
    sessionId,
    current,
    modeOption,
    mode,
    (next, value) => modeConfig(next, value).config,
    "ACP 后端未应用请求的工作模式"
  );
}

export function acpTurnMode(
  payload: BackendTurnOptions["payload"],
  modeValues: NonNullable<AcpTurnConfigValues["modeValues"]>
) {
  if (payload.planMode) return modeValues.plan;
  if (
    payload.turnOptions.permissionMode === "full-access" &&
    modeValues.fullAccess
  ) {
    return modeValues.fullAccess;
  }
  return payload.turnOptions.permissionMode === "approve-for-me"
    ? modeValues.approveForMe
    : modeValues.default;
}
