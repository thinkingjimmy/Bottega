/**
 * [INPUT]: Depends on OpenCode CLI `models --verbose`Supervised short-command host, ResolvedRuntime, opencodeEnvironment and app-owned probe cwd
 * [OUTPUT]: Provides model/effort analysis, AbortSignal can cancel directory reading and generation-fenced TTL single-fly caching
 * [POS]: The model directory boundary of the OpenCode descriptor; The probe goes into the supervisor, doesn't touch the auth.json, doesn't bring the workspace into the cwd, old flight can't be filled back
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackendModelInfo } from "../../../../shared/agent-ipc";
import type { ResolvedRuntime } from "../types";
import { OPAQUE_CONFIG_VALUE_PATTERN } from "../capability-validation";
import { createModelCatalog } from "../model-catalog";
import { runSupervisedCommand } from "../supervised-command";
import { opencodeEnvironment } from "./home";

const CATALOG_TIMEOUT_MS = 15_000;
/* `--verbose` 每个模型多带一段 pretty JSON：实测 26 个模型 ≈30KiB，
   按 MODEL_LIMIT 满载留一个数量级的余量。 */
const CATALOG_BYTE_LIMIT = 4 * 1024 * 1024;
const LINE_BYTE_LIMIT = 2048;
/** 与 settings 的 optionValue 上限同口径；超出者存不进档案，列出来只会骗人。 */
const SLUG_LIMIT = 200;
const MODEL_LIMIT = 512;
const EFFORT_LIMIT = 32;

const hasControlCharacter = (value: string) =>
  [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });

export function isOpencodeModelSlug(value: string) {
  const separator = value.indexOf("/");
  return (
    separator > 0 &&
    separator < value.length - 1 &&
    Buffer.byteLength(value, "utf8") <= SLUG_LIMIT &&
    !hasControlCharacter(value)
  );
}

/* 「什么是一个合法的 effort」只有一处定义：解析器与 turn 选项校验共用它，
   二者才不会在同一个值上给出相反的结论。 */
export const isOpencodeEffort = (value: string) =>
  OPAQUE_CONFIG_VALUE_PATTERN.test(value);

/**
 * 探针 cwd 必须是 app 自己的空目录：workspace 里可能躺着项目级 opencode
 * 配置，把它当 cwd 等于让被探测的对象决定探测的行为。用 os.tmpdir() 下的
 * 固定子目录（macOS 上它是 per-user 私有目录），0700 建出来。
 */
export function opencodeProbeCwd() {
  const path = join(tmpdir(), "ai-chat-opencode-probe");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

/**
 * 详情块恒是 `JSON.stringify(model, null, 2)`：开括号独占一行、闭括号顶格。
 * JSON 字符串里不可能出现裸换行，所以「顶格的 `}`」是无歧义的终止符——
 * 不必数括号，也就不会被字符串里的括号骗到。
 */
function readDetailBlock(lines: string[], start: number) {
  if (lines[start] !== "{") {
    throw new Error("OpenCode 模型目录缺少详情块");
  }
  let end = start + 1;
  while (end < lines.length && lines[end] !== "}") end += 1;
  if (end >= lines.length) throw new Error("OpenCode 模型详情块未闭合");
  try {
    return {
      detail: JSON.parse(lines.slice(start, end + 1).join("\n")) as unknown,
      next: end + 1,
    };
  } catch (cause) {
    throw new Error("OpenCode 模型详情块不是合法 JSON", { cause });
  }
}

/**
 * variants 的键就是 ACP `effort` 配置项的值词表——实测逐字对齐：
 * `set_config_option(model=X)` 的响应里 effort 选项恒等于 X 的 variants 键，
 * 顺序也一致（JSON 非数字键保持插入序），currentValue 恒取第一个。
 *
 * `variants` 恒存在（无档位的模型给 `{}`），所以「字段缺席」意味着上游改了
 * 模型 schema，而不是这个模型没档位——fail-closed 让它当场暴露，
 * 而不是静默退化成"全线没有 Effort 可调"。
 */
function variantEfforts(detail: unknown, slug: string) {
  const variants = (detail as { variants?: unknown })?.variants;
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) {
    throw new Error(`OpenCode 模型详情缺少 variants：${slug.slice(0, 80)}`);
  }
  const efforts = Object.keys(variants);
  if (efforts.length > EFFORT_LIMIT) {
    throw new Error(`OpenCode 模型档位数量超过上限：${slug.slice(0, 80)}`);
  }
  for (const effort of efforts) {
    if (!isOpencodeEffort(effort)) {
      throw new Error(`OpenCode 模型档位格式无效：${effort.slice(0, 40)}`);
    }
  }
  /* displayName 交给 renderer 的 effortLabel 统一口径，别让同一个 "high"
     在 opencode 与 codex 之间长出两个名字。 */
  return efforts.map((effort) => ({ effort, description: "" }));
}

/**
 * 解析 `opencode models --verbose`：一行 `provider/model`，紧跟一段该模型的
 * pretty JSON 详情。
 *
 * model id 是 branded string，上游不保证字符集，所以不假设首字符、
 * 不套正则白名单——只按**首个** `/` 切分并要求两段非空。任何一行不成形
 * 就整体抛错（fail-closed）：上游哪天改了输出格式，宁可当场暴露，
 * 也不要静默交出一个半截目录让用户以为模型消失了。
 */
export function parseOpencodeModels(output: string): BackendModelInfo[] {
  if (Buffer.byteLength(output, "utf8") > CATALOG_BYTE_LIMIT) {
    throw new Error("OpenCode 模型目录超过大小上限");
  }
  /* 行尾方言（CRLF、尾随空格）在这里一次性抹平——解析器后面对 `{`/`}` 用
     严格相等，那是**顶格**判据，一个 `\r` 就能让整份目录炸掉，而爆炸半径
     盖住所有带 model 的 turn。注意绝不能改成 `trim()`：pretty JSON 里嵌套
     对象的闭括号正是带缩进的 `  }`，抹掉缩进就会提前终止块。 */
  const lines = output.split("\n").map((line) => line.trimEnd());
  const models: BackendModelInfo[] = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const line = lines[cursor]!.trim();
    cursor += 1;
    if (line.length === 0) continue;
    if (Buffer.byteLength(line, "utf8") > LINE_BYTE_LIMIT) {
      throw new Error("OpenCode 模型目录存在超长行");
    }
    if (!isOpencodeModelSlug(line)) {
      throw new Error(`OpenCode 模型目录格式无效：${line.slice(0, 80)}`);
    }
    const { detail, next } = readDetailBlock(lines, cursor);
    cursor = next;
    models.push({
      slug: line,
      displayName: line,
      /* 默认模型的真相在用户自己的 opencode config 里，CLI 不在这份
         输出中标注。TurnOptions.model 缺省即透传，由 CLI 自己决定——
         在这里挑一个"看起来像默认"的，就是替用户做了他没做的选择。
         defaultReasoningEffort 同理：缺省即由 CLI 自己取 variants 首项。 */
      isDefault: false,
      supportedReasoningEfforts: variantEfforts(detail, line),
    });
  }
  if (models.length > MODEL_LIMIT) {
    throw new Error("OpenCode 模型数量超过上限");
  }
  return models;
}

async function readModelsOutput(
  runtime: ResolvedRuntime,
  signal: AbortSignal
) {
  try {
    /* `--verbose` 是拿到 variants（= Effort 档位）的唯一途径，它把每行
       slug 后面接一段 pretty JSON——所以解析器必须是块状的（见上）。
       `--refresh` 仍恒不带：它会额外打印一行缓存提示，污染行流。 */
    const { stdout } = await runSupervisedCommand({
      backend: "opencode",
      command: runtime.executable,
      args: ["models", "--verbose"],
      cwd: opencodeProbeCwd(),
      env: opencodeEnvironment(runtime),
      timeoutMs: CATALOG_TIMEOUT_MS,
      maxBuffer: CATALOG_BYTE_LIMIT,
      label: "OpenCode 模型目录读取",
      signal,
    });
    return stdout;
  } catch (cause) {
    signal.throwIfAborted();
    throw new Error("OpenCode 模型目录读取失败", { cause });
  }
}

const catalog = createModelCatalog<ResolvedRuntime>({
  label: "OpenCode 模型目录",
  /* 目录是账号级事实，workspace 不进 key（探针 cwd 恒为 app-owned 空目录）。 */
  key: (runtime) => `${runtime.executable}\0${runtime.version}`,
  read: (runtime, _workspace, signal) =>
    readModelsOutput(runtime, signal).then(parseOpencodeModels),
});

export const listOpencodeModels = (
  runtime: ResolvedRuntime,
  signal?: AbortSignal
) => catalog.list(runtime, "", signal);

export const invalidateOpencodeModels = catalog.invalidate;
