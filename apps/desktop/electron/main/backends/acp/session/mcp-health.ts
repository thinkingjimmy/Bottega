/**
 * [INPUT]: Depends on BackendTurnOptions' third-party MCP plan, AcpSpawnConfig transport facts and a redaction function supplied by the caller
 * [OUTPUT]: Provides observeAcpSessionAccepted and observeAcpSessionRejected, which project ACP session accept/reject into per-server MCP protocol health observations
 * [POS]: The MCP-health half of ACP session establishment; AcpTurn only decides when a session was accepted or rejected, never which server that implicates
 */

import { asError } from "../../../errors";
import type { BackendTurnOptions } from "../../types";
import type { AcpSpawnConfig } from "../turn/setup";

/**
 * session/new|load 成功意味着 backend 已协议确认这份精确 inclusion plan。
 * 这比 spawn 强，但不冒充某次 tool call；证据文字把层级说清楚。
 */
export function observeAcpSessionAccepted(
  options: BackendTurnOptions,
  config: AcpSpawnConfig
) {
  for (const entry of options.thirdPartyMcpPlan?.entries ?? []) {
    options.callbacks.onThirdPartyMcpProtocol?.({
      outcome: "success",
      subject: entry.healthSubject,
      evidence: [
        "acp-session-accepted",
        options.payload.turnOptions.backend,
        options.runtime.version,
        config.thirdPartyMcpTransport ?? "acp",
        entry.identity,
        entry.configDigest,
      ].join("\0"),
    });
  }
}

/**
 * generic session 失败不能连坐多台 server。只有诊断点名 alias/identity，或
 * 单 server 且明确提到 MCP，才写 protocol-failure；其余保持 unobserved。
 */
export function observeAcpSessionRejected(
  options: BackendTurnOptions,
  redact: (value: string) => string,
  cause: unknown
) {
  const entries = options.thirdPartyMcpPlan?.entries ?? [];
  if (!entries.length) return;
  const evidence = redact(asError(cause).message);
  const named = entries.filter(
    (entry) =>
      evidence.includes(entry.backendAlias) || evidence.includes(entry.identity)
  );
  const failed = named.length
    ? named
    : entries.length === 1 && /\bmcp\b/i.test(evidence)
      ? entries
      : [];
  for (const entry of failed) {
    options.callbacks.onThirdPartyMcpProtocol?.({
      outcome: "failure",
      subject: entry.healthSubject,
      evidence: [
        "acp-session-rejected",
        options.payload.turnOptions.backend,
        options.runtime.version,
        entry.identity,
        entry.configDigest,
        evidence,
      ].join("\0"),
    });
  }
}
