/**
 * [INPUT]: Depends on the controlled ACP session configuration of the Codex-acp lock, the unified model directory kernel, shared model vocabulary and Codex runtime/workspace
 * [OUTPUT]: Provides codexModelCatalog/createCodexModelCatalog, and reads the model from standard configuration options, Effort and Speed; Cancelled or invalidated
 * [POS]: The model directory boundary of the backends/codex; Cache/singleflight/generation is a synonym for model-catalog core
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { BackendModelInfo } from "../../../../shared/agent-ipc";
import { inspectAcpSession } from "../acp/probe";
import { MODEL_ID_PATTERN } from "../capability-validation";
import {
  createModelCatalog,
  type ModelCatalog,
} from "../model-catalog";
import type { ResolvedRuntime } from "../types";
import {
  codexAcpArgs,
  codexAcpEnvironment,
  validateCodexSessionId,
} from "./adapter-entry";

const MODEL_LIMIT = 128;

type ConfigState = { configOptions?: SessionConfigOption[] | null };
type SelectConfig = Extract<SessionConfigOption, { type: "select" }>;

export type CodexModelCatalogDependencies = {
  inspectSession?: typeof inspectAcpSession;
  now?: () => number;
  ttlMs?: number;
};

function state(value: unknown): ConfigState {
  const configOptions = (value as ConfigState | null)?.configOptions;
  if (!Array.isArray(configOptions)) {
    throw new Error("Codex ACP 未返回 session config options");
  }
  return { configOptions };
}

function select(config: ConfigState, id: string) {
  const value = config.configOptions?.find(
    (option) => option.type === "select" && option.id === id
  );
  return value?.type === "select" ? value : undefined;
}

function entries(config: SelectConfig) {
  return config.options.flatMap((option) =>
    "value" in option ? [option] : option.options
  );
}

function effort(config: ConfigState) {
  const option = select(config, "reasoning_effort");
  if (!option) return {};
  const choices = entries(option);
  const values = choices.map((choice) => choice.value);
  if (
    values.length === 0 ||
    values.some((value) => !MODEL_ID_PATTERN.test(value)) ||
    new Set(values).size !== values.length ||
    typeof option.currentValue !== "string" ||
    !values.includes(option.currentValue)
  ) {
    throw new Error("Codex ACP Effort 目录无效");
  }
  return {
    defaultReasoningEffort: option.currentValue,
    supportedReasoningEfforts: choices.map((choice) => ({
      effort: choice.value,
      description: choice.description ?? "",
    })),
  };
}

async function discover(
  runtime: ResolvedRuntime,
  workspace: string,
  inspect: typeof inspectAcpSession,
  signal: AbortSignal
) {
  return inspect(
    {
      backend: "codex",
      command: process.execPath,
      args: codexAcpArgs(),
      env: codexAcpEnvironment(runtime),
      cwd: workspace,
      signal,
      validateSessionId: validateCodexSessionId,
    },
    async ({ created, sessionId, request }) => {
      let current = state(created);
      const models = select(current, "model");
      if (!models) throw new Error("Codex ACP 未返回模型目录");
      const choices = entries(models);
      const values = choices.map((choice) => choice.value);
      if (
        choices.length === 0 ||
        choices.length > MODEL_LIMIT ||
        values.some((value) => !MODEL_ID_PATTERN.test(value)) ||
        new Set(values).size !== values.length ||
        typeof models.currentValue !== "string" ||
        !values.includes(models.currentValue)
      ) {
        throw new Error("Codex ACP 模型目录无效");
      }
      const defaultModel = models.currentValue;
      const serviceTiers = select(current, "fast-mode")
        ? [
            { id: "default", displayName: "Standard" },
            { id: "priority", displayName: "Fast" },
          ]
        : [{ id: "default", displayName: "Standard" }];
      const result: BackendModelInfo[] = [];
      for (const choice of choices) {
        if (select(current, "model")?.currentValue !== choice.value) {
          current = state(
            await request("session/set_config_option", {
              sessionId,
              configId: models.id,
              value: choice.value,
            })
          );
        }
        result.push({
          slug: choice.value,
          displayName: choice.name || choice.value,
          isDefault: choice.value === defaultModel,
          ...effort(current),
          serviceTiers,
        });
      }
      return result;
    }
  );
}

export function createCodexModelCatalog(
  dependencies: CodexModelCatalogDependencies = {}
): ModelCatalog<ResolvedRuntime> {
  const inspect = dependencies.inspectSession ?? inspectAcpSession;
  return createModelCatalog<ResolvedRuntime>({
    label: "Codex 模型目录",
    key: (runtime, workspace) =>
      `${runtime.executable}\0${runtime.version}\0${workspace}`,
    read: (runtime, workspace, signal) =>
      discover(runtime, workspace, inspect, signal),
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.ttlMs !== undefined ? { ttlMs: dependencies.ttlMs } : {}),
  });
}

export const codexModelCatalog = createCodexModelCatalog();
