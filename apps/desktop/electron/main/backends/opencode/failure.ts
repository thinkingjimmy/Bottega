/**
 * [INPUT]: Depends on General ACP Failure Classification with OpenCode
 * [OUTPUT]: Provides opencodeClassifyFailure
 * [POS]: The following is a list of the most common types of backends/opencode failures: Only the original product diagnosis, no product reference text is generated
 */

import { classifyAcpFailure } from "../acp/failure";
import type { BackendFailure, FailureHints } from "../types";
import { agentRuntimeFailure } from "../../../../shared/product-failure";

const OPENCODE_AUTH_MESSAGES = new Set([
  "Authentication required: provider authentication required",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 真机 wire：code -32000、message 全文
 * `"Authentication required: provider authentication required"`、
 * data `{providerId?}`（小写 d，值可为 undefined）。
 *
 * 通用判据要求 message 恰为 `"Authentication required"` 或 data 命中词表，
 * 两条腿都不成立，故必须专属分支。这里把实机 wire 当成精确协议常量，
 * 不对任意英文做前缀或正则猜测。providerId **不要求存在**——只拒
 * 「存在但不是 string」，那才是形状不对。
 *
 * 诚实边界：prompt 终态路径只把 ProviderAuthError 归 authRequired；
 * API key 缺失走的是另一条路，不保证返 -32000。未识别形态按一般失败
 * 呈现、authStatus 不落 unauthenticated，宁可少判也不误判。
 */
export function opencodeClassifyFailure(
  cause: unknown,
  hints?: FailureHints
): BackendFailure {
  const source = record(cause);
  const code = source?.code ?? record(source?.cause)?.code;
  const message = typeof source?.message === "string" ? source.message : "";
  const providerId = record(source?.data ?? record(source?.cause)?.data)
    ?.providerId;
  if (
    code === -32000 &&
    OPENCODE_AUTH_MESSAGES.has(message) &&
    (providerId === undefined || typeof providerId === "string")
  ) {
    return {
      kind: "auth-required",
      message,
      failure: agentRuntimeFailure("auth-required"),
    };
  }
  return classifyAcpFailure(cause, hints);
}
