/**
 * [INPUT]: Depends on Kimi CLI `provider list`Supervised short-command hosts, Unified Model Directory kernels, shared model/effort vocabulary and KIMI_CODE_HOME environment
 * [OUTPUT]: Provides parseKimiModels/listKimiModels/invalidateKimiModels, and returns the data in CLI JSON to Thinking Effort
 * [POS]: The limits of the model/thinking capability of the Kimi descriptor; Only extract the public data, probe into the supervisor, cache/defeat the semantics into the model-catalog core
 */

import type { BackendModelInfo } from "../../../../shared/agent-ipc";
import type { ResolvedRuntime } from "../types";
import {
  EFFORT_ID_PATTERN,
  MODEL_ID_PATTERN,
} from "../capability-validation";
import { createModelCatalog } from "../model-catalog";
import { runSupervisedCommand } from "../supervised-command";
import { kimiEnvironment, resolveKimiCodeHome } from "./home";

const CATALOG_TIMEOUT_MS = 8_000;
const CATALOG_BYTE_LIMIT = 512 * 1024;
const MODEL_LIMIT = 256;
const EFFORT_LIMIT = 16;
const CAPABILITY_LIMIT = 64;
const DEFAULT_MODEL_PATTERN = /^Default model:\s*(\S+)\s*$/m;

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fixedThinkingEffort(
  record: Record<string, unknown> | undefined
) {
  const capabilities = record?.capabilities;
  if (
    !Array.isArray(capabilities) ||
    capabilities.length > CAPABILITY_LIMIT ||
    capabilities.some(
      (capability) =>
        typeof capability !== "string" ||
        !EFFORT_ID_PATTERN.test(capability)
    )
  ) {
    return undefined;
  }
  return capabilities.includes("thinking") &&
    capabilities.includes("always_thinking")
    ? "on"
    : undefined;
}

function reasoningEfforts(record: Record<string, unknown> | undefined) {
  if (record?.supportEfforts === undefined) {
    const effort = fixedThinkingEffort(record);
    return effort
      ? {
          defaultReasoningEffort: effort,
          supportedReasoningEfforts: [{ effort, description: "" }],
        }
      : {};
  }
  if (
    !Array.isArray(record.supportEfforts) ||
    record.supportEfforts.length === 0 ||
    record.supportEfforts.length > EFFORT_LIMIT ||
    record.supportEfforts.some(
      (effort) =>
        typeof effort !== "string" || !EFFORT_ID_PATTERN.test(effort)
    ) ||
    typeof record.defaultEffort !== "string" ||
    !record.supportEfforts.includes(record.defaultEffort)
  ) {
    throw new Error("Kimi Thinking Effort 目录格式无效");
  }
  return {
    defaultReasoningEffort: record.defaultEffort,
    supportedReasoningEfforts: record.supportEfforts.map((effort) => ({
      effort,
      description: "",
    })),
  };
}

export function parseKimiModels(
  catalogOutput: string,
  summaryOutput: string
): BackendModelInfo[] {
  if (Buffer.byteLength(catalogOutput, "utf8") > CATALOG_BYTE_LIMIT) {
    throw new Error("Kimi 模型目录超过大小上限");
  }
  const catalog = objectValue(JSON.parse(catalogOutput));
  const records = objectValue(catalog?.models);
  const defaultModel = summaryOutput.match(DEFAULT_MODEL_PATTERN)?.[1];
  if (!records || !defaultModel || !MODEL_ID_PATTERN.test(defaultModel)) {
    throw new Error("Kimi 模型目录格式无效");
  }
  const entries = Object.entries(records);
  if (entries.length > MODEL_LIMIT) {
    throw new Error("Kimi 模型数量超过上限");
  }
  const models = entries.flatMap(([slug, raw]) => {
    if (!MODEL_ID_PATTERN.test(slug)) return [];
    const record = objectValue(raw);
    const displayName =
      typeof record?.displayName === "string" &&
      record.displayName.trim() &&
      Buffer.byteLength(record.displayName, "utf8") <= 200
        ? record.displayName.trim()
        : slug;
    return [{
      slug,
      displayName,
      isDefault: slug === defaultModel,
      ...reasoningEfforts(record),
    }];
  });
  if (
    models.length === 0 ||
    !models.some((model) => model.slug === defaultModel)
  ) {
    throw new Error("Kimi 默认模型不在候选目录中");
  }
  return models;
}

async function readProviderOutput(
  runtime: ResolvedRuntime,
  json: boolean,
  signal: AbortSignal
) {
  try {
    const { stdout } = await runSupervisedCommand({
      backend: "kimi",
      command: runtime.executable,
      args: ["provider", "list", ...(json ? ["--json"] : [])],
      env: kimiEnvironment(runtime),
      timeoutMs: CATALOG_TIMEOUT_MS,
      maxBuffer: CATALOG_BYTE_LIMIT,
      label: "Kimi 模型目录读取",
      signal,
    });
    return stdout;
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error("Kimi 模型目录读取失败", { cause });
  }
}

const catalog = createModelCatalog<ResolvedRuntime>({
  label: "Kimi 模型目录",
  /* 目录内容随二进制版本与状态根（KIMI_CODE_HOME 里的 provider 配置）漂移，
     两者都进 key；workspace 与 Kimi 目录无关，不进。 */
  key: (runtime) =>
    `${runtime.executable}\0${runtime.version}\0${resolveKimiCodeHome()}`,
  async read(runtime, _workspace, signal) {
    const sibling = new AbortController();
    const childSignal = AbortSignal.any([signal, sibling.signal]);
    const reads = [
      readProviderOutput(runtime, true, childSignal),
      readProviderOutput(runtime, false, childSignal),
    ] as const;
    try {
      const [catalogOutput, summary] = await Promise.all(reads);
      return parseKimiModels(catalogOutput, summary);
    } catch (cause) {
      sibling.abort(cause);
      /* Promise.all 首个拒绝不代表兄弟进程已清理；对外拒绝必须晚于两个
         supervisor settled，调用方此时观测到的 auxiliary 数量才是真零。 */
      await Promise.allSettled(reads);
      throw cause;
    }
  },
});

export const listKimiModels = (
  runtime: ResolvedRuntime,
  signal?: AbortSignal
) => catalog.list(runtime, "", signal);

export const invalidateKimiModels = catalog.invalidate;
