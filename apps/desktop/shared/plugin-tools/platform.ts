/**
 * [INPUT]: Depends on zod and shared Bases schema/budget
 * [OUTPUT]: Provides tool platform types, CLI-bounded history image delivery, domain budgets, Plan exclusion, timeouts, common schemas and annotations
 * [POS]: Domain-neutral foundation of plugin-tools; domain specs depend only downward on this file and never on the index barrel
 */

import { z } from "zod";
import {
  BASE_COLUMN_LIMIT,
  BASE_WIRE_BYTE_LIMIT,
} from "../bases/model/bases-ipc";

export type PluginToolAccess = "read" | "mutate";

export type PluginToolBudget = {
  id: string;
  rateLimit: number;
  rateWindowMs: number;
  logicalResultByteLimit: number;
};

const budgets = new Map<string, PluginToolBudget>();
export const DEFAULT_TOOL_BUDGET: PluginToolBudget = {
  id: "plugin", rateLimit: 30, rateWindowMs: 60_000, logicalResultByteLimit: 512 * 1024,
};
export function registerToolBudget(budget: PluginToolBudget) { budgets.set(budget.id, Object.freeze({ ...budget })); }
export function toolBudget(domainId: string): PluginToolBudget { return budgets.get(domainId) ?? DEFAULT_TOOL_BUDGET; }

const BUILTIN_TOOL_TIMEOUT_MS = 600_000;
export const BUILTIN_CLIENT_TIMEOUT_MS = BUILTIN_TOOL_TIMEOUT_MS + 60_000;

/**
 * 内置 MCP 子进程连回主进程 socket 的期限。
 *
 * 它必须小于启动链 builtin-mcp 步的预算：否则卡住时先命中的是步预算，
 * 用户拿到的是「未就绪」这句泛泛而谈，而不是这里带 socket 路径的确指。
 */
export const BUILTIN_MCP_READY_TIMEOUT_MS = 10_000;

/**
 * macOS `sun_path` 上限 104 字节（含结尾 NUL），Linux 108。跨平台取小者
 * fail-closed。超限时 `listen()` 的表征是 EINVAL/ENAMETOOLONG 之类与「路径太长」
 * 毫无字面关系的错误，所以必须在建 socket 之前就点破。
 */
const UNIX_SOCKET_PATH_BYTE_LIMIT = 104;

/** The backstop's wording; custody/socket-budget.ts (main-only) keeps the same line, pinned equal by a test. */
const unixSocketPathMessage = (path: string) =>
  `Unix socket path is ${Buffer.byteLength(path, "utf8")} bytes (limit ${UNIX_SOCKET_PATH_BYTE_LIMIT - 1}): ${path}`;

/** Backstop at every socket: a path the early check did not cover still fails before listen(), with technical wording. */
export function assertUnixSocketPath(path: string) {
  if (Buffer.byteLength(path, "utf8") < UNIX_SOCKET_PATH_BYTE_LIMIT) return;
  throw new Error(unixSocketPathMessage(path));
}

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
};

export type PluginToolSpec = {
  name: string;
  domainId: string;
  pluginId?: string;
  toolId?: string;
  identity?: string;
  revision?: string;
  providerAlias?: string;
  timeoutMs?: number;
  outputSchema?: z.ZodType;
  outputJsonSchema?: Record<string, unknown>;
  resultByteLimit?: number;
  workflowAllowed?: boolean;
  description: string;
  /** 仅当 mentions 全部已签发时才拼到 description，避免泄漏已关闭工具名。 */
  crossReferences?: readonly Readonly<{
    mentions: readonly string[];
    text: string;
  }>[];
  access: PluginToolAccess;
  backendAllowlist?: readonly string[];
  manualTurnOnly?: true;
  /** 即便 annotations 为 read，也不能进入无外向副作用的 Plan 环境。 */
  planExcluded?: true;
  /** Product infrastructure tool: absent from Settings and ambient policy; only an exact turn issuer may add it. */
  exactIssued?: true;
  inputSchema: z.ZodObject;
  wireInputSchema?: z.ZodObject;
  annotations: ToolAnnotations;
};

export const sectionId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const entityId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const mutation = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
} as const;
export const read = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

/** 递归 Filter 真身只用于 main 校验；wire 替身保证模型侧 JSON Schema 无 `$ref`。 */
export const baseFilterWireSchema = z
  .looseObject({})
  .describe(
    "Filter AST。叶子 {kind:'condition',columnId,operator,value?}，operator ∈ eq|neq|contains|gt|gte|lt|lte|is-empty|not-empty（后两者无 value）；组合 {kind:'and'|'or',filters:[…]} 或 {kind:'not',filter:…}；深度 ≤8、节点 ≤64。"
  );

/** `read_base` 的查询底座：filter/sort/columns 投影加游标分页。 */
export const readBaseShape = (filter: z.ZodType) =>
  z
    .object({
      filter: filter.optional(),
      sort: z
        .array(
          z
            .object({
              column_id: entityId,
              direction: z.enum(["asc", "desc"]),
            })
            .strict()
        )
        .max(BASE_COLUMN_LIMIT)
        .optional(),
      columns: z.array(entityId).max(BASE_COLUMN_LIMIT).optional(),
      cursor: z.string().max(256).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    })
    .strict();

export const BUILTIN_WIRE_BYTE_LIMIT = BASE_WIRE_BYTE_LIMIT;
