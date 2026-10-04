/**
 * [INPUT]: Depends on the shared ACP failure classifier and the ACP spawn config type
 * [OUTPUT]: Provides validateClaudeSessionId, claudeSessionMissing (the adapter's exact absent-session report), CLAUDE_INTERACTIVE_LOCKDOWN (a sandboxed turn's setting sources, shared with the model probe), CLAUDE_SERVICE_TIER, claudeTurnValues (the launch-independent half of the Claude ACP turn config) and claudeHeadlessParseLine (`claude -p --output-format stream-json` output, shared by the executor and the bridge)
 * [POS]: Shared by the in-process Claude turn (providers/claude/index.ts) and the Claude Provider bridge. The launch (the bundled adapter through the runtime port, the environment) and the session `_meta` (Claude's sandbox settings, tools and plugins: its fence) are built only in main, so nothing here may import them; the validator lives here because environment.ts carries the launch port
 */
import { acpRequestDetails, classifyAcpFailure } from "../../backends/acp/failure";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import type { HeadlessParserState } from "../../backends/types";

const SESSION_PATTERN = /^[A-Za-z0-9._:/-]{1,128}$/;

export const validateClaudeSessionId = (id: string) => SESSION_PATTERN.test(id);

/* claude-agent-acp 0.70.0 wraps an absent session as -32603 with exactly this detail; any other report is a real failure (F-46 ⑥). */
export const claudeSessionMissing = (sessionId: string, cause: unknown) =>
  acpRequestDetails(cause) === `Session ${sessionId} not found in any project directory`;

/* The setting sources and MCP lockdown of a sandboxed turn (the reasons are at claudeInteractiveSessionMeta in index.ts); the
   model catalog probe loads the same, so the list it offers is the list a turn can run with (TASK-13 G). */
export const CLAUDE_INTERACTIVE_LOCKDOWN = {
  strictMcpConfig: true,
  settingSources: ["user", "project"],
} as const;

export const CLAUDE_SERVICE_TIER = {
  configOptionId: "fast",
  values: { default: "off", priority: "on" },
} as const;

export const claudeTurnValues = {
  validateSessionId: validateClaudeSessionId,
  sessionMissing: claudeSessionMissing,
  resumeWithoutReplay: true,
  modeValues: { default: "default", plan: "plan", approveForMe: ["auto", "acceptEdits"] },
  serviceTierValues: CLAUDE_SERVICE_TIER.values,
  serviceTierConfigId: CLAUDE_SERVICE_TIER.configOptionId,
  classifyFailure: classifyAcpFailure,
  reviewResidualApprovals: true,
} as const satisfies Omit<AcpSpawnConfig, "command" | "args" | "env">;

function parseText(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((item) =>
    item &&
    typeof item === "object" &&
    (item as { type?: unknown }).type === "text" &&
    typeof (item as { text?: unknown }).text === "string"
      ? [(item as { text: string }).text]
      : []
  );
  return text.length > 0 ? text.join("") : undefined;
}

function setText(text: string, state: HeadlessParserState) {
  state.text = text;
}

/** `claude -p --output-format stream-json`: shared by the in-process executor and the Claude bridge's `headless.run` (TASK-11 D8). */
export function claudeHeadlessParseLine(
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
  if (!event || typeof event !== "object") return;
  const record = event as {
    type?: unknown;
    result?: unknown;
    structured_output?: unknown;
    is_error?: unknown;
    message?: { content?: unknown };
  };
  if (record.type === "result") {
    if (typeof record.result === "string") setText(record.result, state);
    if (record.is_error === true) {
      state.error =
        typeof record.result === "string"
          ? `Claude headless 失败：${record.result}`
          : "Claude headless 返回错误结果";
      return;
    }
    if (!wantsJson) return;
    if (record.structured_output === undefined) {
      state.json = undefined;
      state.error = "Claude 未返回 --json-schema 对应的 structured_output";
      return;
    }
    state.json = record.structured_output;
    if (!state.text) state.text = JSON.stringify(record.structured_output);
    return;
  }
  if (record.type !== "assistant") return;
  const text = parseText(record.message?.content);
  if (text !== undefined) setText(text, state);
}
