/**
 * [INPUT]: Depends on the Claude ACP adapter's supervised session configuration options, ResolvedRuntime, workspace and caller AbortSignal
 * [OUTPUT]: Provides Claude model identification, definable listClaudeModels and createClaudeModelCatalog; In the Abort+generation, the old flight is isolated, ACP default sentinel permanently closed and model-by-model Effort cached
 * [POS]: The boundary of the Claude backend model directory; UI candidates and turn pre-test participants share the same ACP fact source, process ownership and cancellation to the Unified Supervisor
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { BackendModelInfo } from "../../../../shared/agent-ipc";
import { inspectAcpSession } from "../acp/probe";
import { EFFORT_ID_PATTERN } from "../capability-validation";
import { createModelCatalog } from "../model-catalog";
import type { ResolvedRuntime } from "../types";
import { claudeAdapterArgs } from "./adapter-entry";
import {
  claudeAdapterEnvironment,
  validateClaudeSessionId,
} from "./environment";

const MODEL_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/-]*(?:\[1m\])?$/;
const MODEL_ID_LIMIT = 200;
const MODEL_LIMIT = 64;
const EFFORT_LIMIT = 16;
const CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MODEL_VALUE = "default";
const DEFAULT_EFFORT_VALUE = "default";
const CLAUDE_DEFAULT_EFFORT = "high";
const MODEL_FAMILY_ORDER = new Map([
  ["fable", 0],
  ["opus", 1],
  ["sonnet", 2],
  ["haiku", 3],
]);
const CLAUDE_EFFORT_NAMES = new Map([
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
  ["max", "Max"],
]);

type ConfigState = {
  configOptions?: SessionConfigOption[] | null;
};

type SelectConfig = Extract<SessionConfigOption, { type: "select" }>;
type SelectEntry = {
  value: string;
  name: string;
  description?: string | null;
};
type InspectSession = typeof inspectAcpSession;

export type ClaudeModelCatalog = {
  (
    runtime: ResolvedRuntime,
    workspace: string,
    signal?: AbortSignal
  ): Promise<BackendModelInfo[]>;
  invalidate(): void;
};

export type ClaudeModelCatalogDependencies = {
  inspectSession?: InspectSession;
  createEnvironment?: (runtime: ResolvedRuntime) => NodeJS.ProcessEnv;
  adapterArgs?: () => string[];
  now?: () => number;
  ttlMs?: number;
};

type CatalogDependencies = Required<ClaudeModelCatalogDependencies>;

export const isClaudeModelId = (value: string) =>
  value !== DEFAULT_MODEL_VALUE &&
  value.length <= MODEL_ID_LIMIT &&
  MODEL_PATTERN.test(value);

function catalogDependencies(
  overrides: ClaudeModelCatalogDependencies
): CatalogDependencies {
  return {
    inspectSession: overrides.inspectSession ?? inspectAcpSession,
    createEnvironment:
      overrides.createEnvironment ?? claudeAdapterEnvironment,
    adapterArgs: overrides.adapterArgs ?? claudeAdapterArgs,
    now: overrides.now ?? Date.now,
    ttlMs: overrides.ttlMs ?? CACHE_TTL_MS,
  };
}

function configState(value: unknown): ConfigState {
  const options = (value as ConfigState | null)?.configOptions;
  if (!Array.isArray(options)) {
    throw new Error("Claude ACP 未返回 session config options");
  }
  return { configOptions: options };
}

function selectConfig(
  state: ConfigState,
  id: "model" | "effort"
): SelectConfig | undefined {
  const option = state.configOptions?.find(
    (item) => item.type === "select" && item.id === id
  );
  return option?.type === "select" ? option : undefined;
}

function selectEntries(config: SelectConfig) {
  return config.options.flatMap((option) =>
    "value" in option
      ? [option]
      : option.options
  );
}

function descriptionHeadline(entry: SelectEntry) {
  return entry.description?.split(" · ", 1)[0]?.trim();
}

function stripContextLabel(value: string) {
  return value
    .replace(/\s+with\s+1M\s+context$/i, "")
    .replace(/\s+\(1M\s+context\)$/i, "")
    .trim();
}

function modelIdentity(value: string, slug = "") {
  const longContext =
    /\[1m\]$/i.test(slug) || /\b1M\s+context\b/i.test(value);
  return `${stripContextLabel(value).toLowerCase()}${longContext ? "[1m]" : ""}`;
}

function modelDisplayName(entry: SelectEntry) {
  const headline = descriptionHeadline(entry);
  const versioned = headline?.match(
    /^(.+?\s+\d+(?:\.\d+)?)(?:\s+with\s+1M\s+context)?$/i
  )?.[1];
  return (versioned ?? entry.name) || entry.value;
}

function resolvedDefaultName(entries: SelectEntry[]) {
  const entry = entries.find(
    (entry) => entry.value === DEFAULT_MODEL_VALUE
  );
  const description = entry?.description;
  const explicit = description
    ?.match(/\(currently\s+(.+)\)\s*(?:·|$)/i)?.[1]
    ?.trim();
  return explicit ?? (entry ? descriptionHeadline(entry) : undefined);
}

function resolvedDefaultSlug(
  entries: SelectEntry[],
  currentValue: string
) {
  if (currentValue !== DEFAULT_MODEL_VALUE) return currentValue;
  const currentName = resolvedDefaultName(entries);
  if (!currentName) return undefined;
  const visible = entries.filter(
    (entry) => entry.value !== DEFAULT_MODEL_VALUE
  );
  const exact = visible.filter(
    (entry) =>
      modelIdentity(
        descriptionHeadline(entry) ?? entry.name,
        entry.value
      ) === modelIdentity(currentName)
  );
  if (exact.length === 1) return exact[0]!.value;
  if (exact.length > 1) return undefined;
  const base = stripContextLabel(currentName).toLowerCase();
  const matches = visible.filter(
    (entry) =>
      stripContextLabel(
        descriptionHeadline(entry) ?? entry.name
      ).toLowerCase() === base
  );
  return matches.length === 1 ? matches[0]!.value : undefined;
}

function projectVisibleModels(
  entries: SelectEntry[],
  discovered: BackendModelInfo[],
  currentValue: string
) {
  const bySlug = new Map(discovered.map((model) => [model.slug, model]));
  const defaultSlug = resolvedDefaultSlug(entries, currentValue);
  if (!defaultSlug) {
    throw new Error("Claude ACP 无法解析实际默认模型");
  }
  const visible = entries
    .filter((entry) => entry.value !== DEFAULT_MODEL_VALUE)
    .flatMap((entry) => {
      const model = bySlug.get(entry.value);
      return model
        ? [{
            ...model,
            displayName: modelDisplayName(entry),
            isDefault: entry.value === defaultSlug,
          }]
        : [];
    });
  return visible.sort(
    (left, right) =>
      (MODEL_FAMILY_ORDER.get(left.displayName.split(" ")[0]!.toLowerCase()) ??
        MODEL_FAMILY_ORDER.size) -
      (MODEL_FAMILY_ORDER.get(right.displayName.split(" ")[0]!.toLowerCase()) ??
        MODEL_FAMILY_ORDER.size)
  );
}

function effortInfo(state: ConfigState) {
  const effort = selectConfig(state, "effort");
  if (!effort) return {};
  const entries = selectEntries(effort);
  const values = entries.map((option) => option.value);
  if (
    values.length === 0 ||
    values.length > EFFORT_LIMIT ||
    values.some((value) => !EFFORT_ID_PATTERN.test(value)) ||
    new Set(values).size !== values.length
  ) {
    throw new Error("Claude ACP Effort 目录格式无效");
  }
  const current = effort.currentValue;
  if (typeof current !== "string" || !values.includes(current)) {
    throw new Error("Claude ACP 默认 Effort 无效");
  }
  const resolved =
    current === DEFAULT_EFFORT_VALUE ? CLAUDE_DEFAULT_EFFORT : current;
  if (!values.includes(resolved)) {
    throw new Error("Claude ACP 无法解析实际默认 Effort");
  }
  return {
    defaultReasoningEffort: resolved,
    supportedReasoningEfforts: entries.map((entry) => ({
      effort: entry.value,
      displayName:
        CLAUDE_EFFORT_NAMES.get(entry.value) || entry.name || entry.value,
      description: entry.description ?? "",
      ...(entry.value === DEFAULT_EFFORT_VALUE ? { hidden: true } : {}),
    })),
  };
}

async function readClaudeModels(
  runtime: ResolvedRuntime,
  workspace: string,
  dependencies: CatalogDependencies,
  signal?: AbortSignal
): Promise<BackendModelInfo[]> {
  const environment = dependencies.createEnvironment(runtime);
  return dependencies.inspectSession(
    {
      backend: "claude",
      command: process.execPath,
      args: dependencies.adapterArgs(),
      env: {
        ...environment,
        ELECTRON_RUN_AS_NODE: "1",
      },
      cwd: workspace,
      signal,
      validateSessionId: validateClaudeSessionId,
    },
    async ({ created, sessionId, request }) => {
      let state = configState(created);
      const modelConfig = selectConfig(state, "model");
      if (!modelConfig) throw new Error("Claude ACP 未返回模型目录");
      const entries = selectEntries(modelConfig);
      const modelValues = entries.map((entry) => entry.value);
      if (
        entries.length === 0 ||
        entries.length > MODEL_LIMIT ||
        new Set(modelValues).size !== modelValues.length
      ) {
        throw new Error("Claude ACP 模型数量无效");
      }
      const defaultModel = modelConfig.currentValue;
      if (
        typeof defaultModel !== "string" ||
        (defaultModel !== DEFAULT_MODEL_VALUE &&
          !isClaudeModelId(defaultModel))
      ) {
        throw new Error("Claude ACP 默认模型无效");
      }
      if (
        modelValues.some(
          (value) =>
            value !== DEFAULT_MODEL_VALUE && !isClaudeModelId(value)
        )
      ) {
        throw new Error("Claude ACP 模型标识无效");
      }
      if (!modelValues.includes(defaultModel)) {
        throw new Error("Claude ACP 默认模型不在目录中");
      }
      const models: BackendModelInfo[] = [];
      for (const entry of entries) {
        if (entry.value === DEFAULT_MODEL_VALUE) continue;
        if (entry.value !== selectConfig(state, "model")?.currentValue) {
          state = configState(
            await request("session/set_config_option", {
              sessionId,
              configId: modelConfig.id,
              value: entry.value,
            })
          );
        }
        models.push({
          slug: entry.value,
          displayName: entry.name || entry.value,
          isDefault: false,
          ...effortInfo(state),
        });
      }
      return projectVisibleModels(entries, models, defaultModel);
    }
  );
}

export function createClaudeModelCatalog(
  overrides: ClaudeModelCatalogDependencies = {}
): ClaudeModelCatalog {
  const dependencies = catalogDependencies(overrides);
  const catalog = createModelCatalog<ResolvedRuntime>({
    label: "Claude 模型目录",
    key: (runtime, workspace) =>
      [runtime.executable, runtime.path, runtime.version, workspace].join("\0"),
    read: (runtime, workspace, signal) =>
      readClaudeModels(runtime, workspace, dependencies, signal),
    now: dependencies.now,
    ttlMs: dependencies.ttlMs,
  });
  const list = ((runtime, workspace, signal) =>
    catalog.list(runtime, workspace, signal)) as ClaudeModelCatalog;
  list.invalidate = catalog.invalidate;
  return list;
}

export const listClaudeModels = createClaudeModelCatalog();
