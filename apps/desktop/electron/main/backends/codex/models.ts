/**
 * [INPUT]: Depends on the controlled ACP session configuration of the Codex-acp lock, the unified model directory kernel, shared model vocabulary and Codex runtime/workspace
 * [OUTPUT]: Provides codexModelCatalog/createCodexModelCatalog with discovery-only handshake budgets and a runtime family key for cross-workspace reuse, and reads the model from standard configuration options, Effort and Speed; description-less placeholder options this CLI cannot run are excluded and the first runnable model becomes the default; Cancelled or invalidated
 * [POS]: The model directory boundary of the backends/codex; Cache/singleflight/generation is a synonym for model-catalog core
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { BackendModelInfo } from "../../../../shared/agent-ipc";
import { inspectAcpSession } from "../acp/probe";
import {
  MODEL_ID_PATTERN,
  OPAQUE_CONFIG_VALUE_PATTERN,
} from "../capability-validation";
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
    values.some((value) => !OPAQUE_CONFIG_VALUE_PATTERN.test(value)) ||
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
      /* Cold discovery shares CODEX_HOME with the auth check, the quota reader
         and sibling probes, and every session/new refetches the remote model
         cache, so a queued handshake legitimately needs more patience than a
         readiness probe. */
      timeoutMs: 20_000,
      totalTimeoutMs: 40_000,
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
      /* codex-acp inserts a description-less placeholder for a configured model
         this CLI cannot run (`~/.codex/config.toml` ahead of `availableModels`);
         the service rejects every prompt on it with "requires a newer version of
         Codex". Described options are the ones the CLI actually knows, so the
         placeholder never reaches the composer. */
      const runnable = choices.filter((choice) => choice.description?.trim());
      if (runnable.length === 0) throw new Error("Codex ACP 模型目录无效");
      const configured = models.currentValue;
      const defaultModel = runnable.some((choice) => choice.value === configured)
        ? configured
        : runnable[0]!.value;
      if (defaultModel !== configured) {
        /* The composer must always open on a model that can answer; slugs are
           adapter metadata, not account data, so naming both is safe. */
        console.warn(
          `[models:codex] configured model ${configured} is not runnable by this CLI; offering ${defaultModel} instead`
        );
      }
      const result: BackendModelInfo[] = [];
      for (const choice of runnable) {
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
          serviceTiers: select(current, "fast-mode")
            ? [
                { id: "default", displayName: "Standard" },
                { id: "priority", displayName: "Fast" },
              ]
            : [{ id: "default", displayName: "Standard" }],
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
    backend: "codex",
    label: "Codex 模型目录",
    key: (runtime, workspace) =>
      `${runtime.executable}\0${runtime.version}\0${workspace}`,
    /* Same binary, same account: the list a sibling workspace already proved is
       the same list, so a new project never pays for a cold handshake. */
    family: (runtime) => `${runtime.executable}\0${runtime.version}\0`,
    read: (runtime, workspace, signal) =>
      discover(runtime, workspace, inspect, signal),
    ...(dependencies.now ? { now: dependencies.now } : {}),
    ...(dependencies.ttlMs !== undefined ? { ttlMs: dependencies.ttlMs } : {}),
  });
}

export const codexModelCatalog = createCodexModelCatalog();
