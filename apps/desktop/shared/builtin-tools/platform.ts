/**
 * [INPUT]: Depends on zod, Agent backend identity and shared Bases schema/budget
 * [OUTPUT]: Provides built-in tool platform types, the English socket-path backstop, per-domain budgets, Plan exclusion, cross-referencing, timeouts, common id schemas, the `read_base` query shape, and annotation constants
 * [POS]: Domain-neutral foundation of builtin-tools; domain specs depend only downward on this file and never on the index barrel
 */

import { z } from "zod";
import type { AgentBackendId } from "../ipc/agent/agent-ipc";
import {
  BASE_COLUMN_LIMIT,
  BASE_WIRE_BYTE_LIMIT,
} from "../bases/model/bases-ipc";

export type BuiltinToolAccess = "read" | "mutate";

export type BuiltinToolDomainSpec = {
  id:
    | "sections"
    | "bases"
    | "subagents"
    | "projects"
    | "history"
    | "search"
    | "browser"
    | "design"
    | "apps"
    | "plugins"
    | "preview"
    | "skills"
    | "workflows";
  rateLimit: number;
  rateWindowMs: number;
  logicalResultByteLimit: number;
};

export const BUILTIN_TOOL_DOMAINS = {
  preview: { id: "preview", rateLimit: 6, rateWindowMs: 60_000, logicalResultByteLimit: 16 * 1024 },
  history: { id: "history", rateLimit: 8, rateWindowMs: 60_000, logicalResultByteLimit: 16 * 1024 },
  sections: {
    id: "sections",
    rateLimit: 12,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 512 * 1024,
  },
  bases: {
    id: "bases",
    rateLimit: 30,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 768 * 1024,
  },
  subagents: {
    id: "subagents",
    rateLimit: 6,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 256 * 1024,
  },
  projects: {
    id: "projects",
    rateLimit: 3,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 16 * 1024,
  },
  search: {
    id: "search",
    rateLimit: 10,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 256 * 1024,
  },
  browser: {
    id: "browser",
    rateLimit: 30,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 512 * 1024,
  },
  design: {
    id: "design",
    rateLimit: 4,
    rateWindowMs: 60_000,
    logicalResultByteLimit: BASE_WIRE_BYTE_LIMIT,
  },
  /* 自检是编辑循环里的低频动作：改一批文件跑一次，不是逐文件轮询。 */
  apps: {
    id: "apps",
    rateLimit: 10,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 64 * 1024,
  },
  skills: {
    id: "skills",
    rateLimit: 16,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 40 * 1024,
  },
  plugins: { id: "plugins", rateLimit: 10, rateWindowMs: 60_000, logicalResultByteLimit: 64 * 1024 },
  /* One report per attempt; a few retransmissions at most. */
  workflows: {
    id: "workflows",
    rateLimit: 6,
    rateWindowMs: 60_000,
    logicalResultByteLimit: 4 * 1024,
  },
} as const satisfies Record<string, BuiltinToolDomainSpec>;

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

export type BuiltinToolSpec = {
  name: string;
  domainId: keyof typeof BUILTIN_TOOL_DOMAINS;
  description: string;
  /** 仅当 mentions 全部已签发时才拼到 description，避免泄漏已关闭工具名。 */
  crossReferences?: readonly Readonly<{
    mentions: readonly string[];
    text: string;
  }>[];
  access: BuiltinToolAccess;
  backendAllowlist?: readonly AgentBackendId[];
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
