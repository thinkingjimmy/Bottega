/**
 * [INPUT]: Depends on the Claude ACP adapter's supervised session configuration options, ResolvedRuntime, workspace, caller AbortSignal and optional model-probe admission
 * [OUTPUT]: Provides Claude model identification, listClaudeModels, claudeModelCatalogKey (keyed on the settings files a turn loads) and createClaudeModelCatalog with probe-only admission, a probe that loads exactly a sandboxed turn's setting sources, generation isolation, hidden default sentinels and per-model Effort
 * [POS]: The boundary of the Claude backend model directory; UI candidates and turn pre-test participants share the same ACP fact source, process ownership and cancellation to the Unified Supervisor
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { BackendModelInfo } from "../../../../../shared/ipc/agent/agent-ipc";
import { inspectAcpSession } from "../../../backends/acp/probe";
import { OPAQUE_CONFIG_VALUE_PATTERN } from "../../../backends/runtime/capability-validation";
import { adapterDigestKey, createModelCatalog, executableFileKey, type ModelCatalogProbeRunner } from "../../../backends/models/model-catalog";
import { claudeAdapterEntry } from "../adapter-entry";
import type { ResolvedRuntime } from "../../../backends/types";
import { adapterLaunch } from "../../../runtime";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_MANAGED_SETTINGS, claudeAdapterEnvironment } from "../environment";
import { CLAUDE_INTERACTIVE_LOCKDOWN, claudeSessionMissing, validateClaudeSessionId } from "../turn-config";

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
    signal?: AbortSignal,
    runProbe?: ModelCatalogProbeRunner
  ): Promise<BackendModelInfo[]>;
  invalidate(): void;
  cached(runtime: ResolvedRuntime, workspace: string): Promise<BackendModelInfo[] | null>;
};

export type ClaudeModelCatalogDependencies = {
  inspectSession?: InspectSession;
  createEnvironment?: (runtime: ResolvedRuntime) => NodeJS.ProcessEnv;
  adapterLaunch?: (env: NodeJS.ProcessEnv) => { command: string; args: string[]; env: Record<string, string> };
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
    adapterLaunch: overrides.adapterLaunch ?? (env => adapterLaunch("claude-agent-acp", env)),
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
  id: "model" | "effort" | "fast"
): SelectConfig | undefined {
  const option = state.configOptions?.find(
    (item) => item.type === "select" && item.id === id
  );
  return option?.type === "select" ? option : undefined;
}

function serviceTiers(state: ConfigState) {
  const standard = { id: "default", displayName: "Standard" };
  return selectConfig(state, "fast")
    ? [standard, { id: "priority", displayName: "Fast" }]
    : [standard];
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

/* slug 是协议里唯一稳定的身份位——`[1m]` 后缀本身就是身份的一部分，
   直接小写比较即可，不能再过 modelIdentity（那会把后缀叠成 `[1m][1m]`）。 */
const slugIdentity = (value: string) => value.toLowerCase();

const defaultEntry = (entries: SelectEntry[]) =>
  entries.find((entry) => entry.value === DEFAULT_MODEL_VALUE);

function resolvedDefaultName(entries: SelectEntry[]) {
  const entry = defaultEntry(entries);
  const description = entry?.description;
  const explicit = description
    ?.match(/\(currently\s+(.+)\)\s*(?:·|$)/i)?.[1]
    ?.trim();
  return explicit ?? (entry ? descriptionHeadline(entry) : undefined);
}

/* ============================================================
 * 判据①（主）：default 条目的 headline 身份直接撞可见条目的 **slug**。
 *
 * 教训（2026-08-27 adapter 0.62.0→0.70.0 真机）：**description 是上游随时
 * 会改的展示文案，不是 identity 源**。0.70.0 把 default 条目的 description
 * 从 "Use the default model (currently Opus 5 (1M context)) · $5/$25 per Mtok"
 * 改成了 "Opus (1M context)"，判据②的 `(currently X)` 正则当场失配，而它的
 * headline 兜底又因为可见条目的 headline 带版本号（"Opus 5 with 1M context"
 * ⇒ `opus 5[1m]`）而对不上——整份 Claude 目录当场抛错、模型选择器全灭。
 * slug 是协议里稳定的那一位，先撞它，文案匹配退为回落。
 * ============================================================ */
function defaultSlugByIdentity(
  entry: SelectEntry | undefined,
  visible: SelectEntry[]
) {
  const headline = entry ? descriptionHeadline(entry) : undefined;
  if (!headline) return undefined;
  const identity = modelIdentity(headline);
  /* slug 唯一性已在 readClaudeModels 里断言 ⇒ 命中至多一条，无歧义分支。 */
  return visible.find(
    (candidate) => slugIdentity(candidate.value) === identity
  )?.value;
}

/* 判据②（回落）：0.62.0 时代的展示文案匹配——先认 `(currently X)`，再拿
   headline 撞 headline，最后剥掉 1M 标签做同名撞。歧义（多条同名）与失配
   都返回 undefined，由调用方响亮抛错：宁可拒绝目录，也不暴露 `default` 哨兵。 */
function defaultSlugByDescription(
  entries: SelectEntry[],
  visible: SelectEntry[]
) {
  const currentName = resolvedDefaultName(entries);
  if (!currentName) return undefined;
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

function resolvedDefaultSlug(
  entries: SelectEntry[],
  currentValue: string
) {
  if (currentValue !== DEFAULT_MODEL_VALUE) return currentValue;
  const visible = entries.filter(
    (entry) => entry.value !== DEFAULT_MODEL_VALUE
  );
  return (
    defaultSlugByIdentity(defaultEntry(entries), visible) ??
    defaultSlugByDescription(entries, visible)
  );
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
    values.some((value) => !OPAQUE_CONFIG_VALUE_PATTERN.test(value)) ||
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
      ...dependencies.adapterLaunch(environment),
      cwd: workspace,
      signal,
      validateSessionId: validateClaudeSessionId,
      sessionMissing: claudeSessionMissing,
      /* The sandboxed turn's setting sources (no workspace settings.local.json) and MCP lockdown; nothing runs, so no fence. */
      sessionMeta: { claudeCode: { options: { ...CLAUDE_INTERACTIVE_LOCKDOWN, settingSources: [...CLAUDE_INTERACTIVE_LOCKDOWN.settingSources] } } },
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
          serviceTiers: serviceTiers(state),
        });
      }
      return projectVisibleModels(entries, models, defaultModel);
    }
  );
}

/* A file's identity for the key: an edit moves size or mtime, and a rewrite that restores mtime still moves ctime. */
function settingsIdentity(path: string) {
  try { const stat = statSync(path); return [path, stat.size, stat.mtimeMs, stat.ctimeMs]; }
  catch { return [path, "absent"]; }
}

/** The catalog key: the CLI file and its adapter (TASK-13 A), the workspace, and the settings files a sandboxed turn loads there (user, project, managed; never
    the workspace's settings.local.json), so editing one of them invalidates the cached list instead of waiting out its TTL. */
export function claudeModelCatalogKey(runtime: ResolvedRuntime, workspace: string, home = claudeAdapterEnvironment(runtime).HOME ?? homedir()) {
  const settings = [join(home, ".claude", "settings.json"), join(workspace, ".claude", "settings.json"), CLAUDE_MANAGED_SETTINGS].map(settingsIdentity);
  return [executableFileKey(runtime.executable), runtime.path, runtime.version, adapterDigestKey(claudeAdapterEntry()), workspace,
    createHash("sha256").update(JSON.stringify(settings)).digest("hex")].join("\0");
}

export function createClaudeModelCatalog(
  overrides: ClaudeModelCatalogDependencies = {}
): ClaudeModelCatalog {
  const dependencies = catalogDependencies(overrides);
  const catalog = createModelCatalog<ResolvedRuntime>({
    backend: "claude",
    label: "Claude 模型目录",
    key: (runtime, workspace) => claudeModelCatalogKey(runtime, workspace),
    read: (runtime, workspace, signal) =>
      readClaudeModels(runtime, workspace, dependencies, signal),
    now: dependencies.now,
    ttlMs: dependencies.ttlMs,
  });
  const list = ((runtime, workspace, signal, runProbe) =>
    catalog.list(runtime, workspace, signal, runProbe)) as ClaudeModelCatalog;
  list.invalidate = catalog.invalidate;
  list.cached = catalog.cached;
  return list;
}

export const listClaudeModels = createClaudeModelCatalog();
