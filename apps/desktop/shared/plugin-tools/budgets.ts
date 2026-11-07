/**
 * [INPUT]: Depends on the shared Base byte budget and the dynamic tool budget registry.
 * [OUTPUT]: Registers the official feature budgets without a domain enum.
 * [POS]: Official declaration budgets; dynamic plugins use their declared result budget and the platform defaults.
 */
import { BASE_WIRE_BYTE_LIMIT } from "../bases/model/bases-ipc";
import { registerToolBudget, type PluginToolBudget } from "./platform";
const OFFICIAL_TOOL_BUDGETS = {
  preview: { id: "preview", rateLimit: 6, rateWindowMs: 60_000, logicalResultByteLimit: 16 * 1024 },
  history: { id: "history", rateLimit: 8, rateWindowMs: 60_000, logicalResultByteLimit: BASE_WIRE_BYTE_LIMIT },
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
    rateLimit: 16,
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
} as const satisfies Record<string, PluginToolBudget>;

Object.values(OFFICIAL_TOOL_BUDGETS).forEach(registerToolBudget);
