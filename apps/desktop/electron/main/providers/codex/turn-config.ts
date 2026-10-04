/**
 * [INPUT]: Depends on the shared ACP failure classifier and the ACP spawn config type
 * [OUTPUT]: Provides validateCodexSessionId, codexSessionMissing (the adapter's exact absent-thread report), CODEX_SERVICE_TIER, codexTurnValues (the launch-independent half of the Codex ACP turn config) and codexHeadlessParseLine (`codex exec --json` output, shared by the executor and the bridge)
 * [POS]: Shared by the in-process Codex turn (providers/codex/index.ts) and the Codex Provider bridge; the launch half (command, args, environment with MCP secrets) is built only in main by `codexAcpLaunch`, and nothing here may import it: the bridge must not carry the runtime port (__tests__/providers/bridge-graph.test.ts)
 */
import { acpRequestDetails, classifyAcpFailure } from "../../backends/acp/failure";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import type { HeadlessParserState } from "../../backends/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const validateCodexSessionId = (id: string) => UUID_PATTERN.test(id);

/* codex-acp 1.6.2 wraps an absent thread as -32603 with exactly this detail; any other report is a real failure (F-46 ⑥). */
export const codexSessionMissing = (sessionId: string, cause: unknown) =>
  acpRequestDetails(cause) === `no rollout found for thread id ${sessionId}`;

export const CODEX_SERVICE_TIER = {
  configOptionId: "fast-mode",
  values: { default: "off", priority: "on" },
} as const;

export const codexTurnValues = {
  validateSessionId: validateCodexSessionId,
  sessionMissing: codexSessionMissing,
  resumeWithoutReplay: true,
  modeValues: {
    default: "agent",
    plan: "read-only",
    approveForMe: "agent",
    fullAccess: "agent-full-access",
  },
  collaborationValues: { default: "default", plan: "plan" },
  serviceTierValues: CODEX_SERVICE_TIER.values,
  serviceTierConfigId: CODEX_SERVICE_TIER.configOptionId,
  classifyFailure: classifyAcpFailure,
  reviewResidualApprovals: true,
  builtinMcpTransport: "backend-config",
  thirdPartyMcpTransport: "backend-config",
} as const satisfies Omit<AcpSpawnConfig, "command" | "args" | "env">;

// ─── JSONL 解析：只认 item.completed/agent_message 终值，其余行静默 ───
/** `codex exec --json`'s output: shared by the in-process executor and the Codex bridge's `headless.run` (TASK-11 D8). */
export function codexHeadlessParseLine(
  line: string,
  state: HeadlessParserState,
  wantsJson: boolean
) {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const record = event as {
    type?: string;
    item?: { type?: string; text?: string; message?: string };
  };
  if (record.type !== "item.completed") return;
  /* ============================================================
   * codex 把「告警」与「死因」压进同一个 item 类型：2026-08-28 真机
   * 一轮成功的 title 里就带着
   *   {"item":{"type":"error","message":"Skill descriptions were shortened…"}}
   * 而后才是 agent_message。所以无条件判败会把成功轮打红。
   *
   * 它只在**一条正文都没有**时才是死因证据——那时进程仍 exit 0，
   * state.text 空，产品原本只能抛一句与事实无关的「未返回有效标题」，
   * 把 CLI 自己说清楚的原因丢在地上。正文一到即作废，不留分支。
   * ============================================================ */
  if (record.item?.type === "error") {
    if (!state.text) state.error = record.item.message;
    return;
  }
  if (record.item?.type !== "agent_message") return;
  state.text = record.item.text ?? "";
  if (state.text) state.error = undefined;
  if (!wantsJson) return;
  try {
    state.json = JSON.parse(state.text);
  } catch {
    state.json = undefined;
  }
}
