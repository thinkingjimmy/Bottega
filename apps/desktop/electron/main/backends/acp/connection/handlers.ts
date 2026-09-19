/**
 * [INPUT]: Depends on ACP SDK notification/request payloads and RequestError, the framing-guard violation shape and the prompt-handoff write sink
 * [OUTPUT]: Provides AcpConnectionHandlers (the mutable slot an attached turn installs) and unattachedRequest, the method-not-found answer used while no turn owns the connection
 * [POS]: Contract module of backends/acp/connection; the connection routes wire traffic through this slot and therefore knows no turn
 */

import {
  RequestError,
  type CreateElicitationRequest,
  type CreateElicitationResponse,
  type MaybePromise,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AcpPolicyViolation } from "../turn/framing-guard";
import type { PromptHandoffSink } from "../turn/prompt-handoff";

/**
 * 一个连接同一时刻只服务一个 turn，所以槽是一格而不是一张订阅表。
 * 槽是可变的：常驻连接的寿命长于任何一轮，attach/detach 是它与 turn 的
 * 全部耦合面。
 */
export type AcpConnectionHandlers = {
  /** 本轮的 prompt 写入回执接收者；连接只转发 stdin 写入事实，不解释它。 */
  handoff: PromptHandoffSink;
  onUpdate(params: SessionNotification): void;
  onPermission(
    requestId: string,
    params: RequestPermissionRequest
  ): MaybePromise<RequestPermissionResponse>;
  onElicitation(
    requestId: string,
    params: CreateElicitationRequest
  ): MaybePromise<CreateElicitationResponse>;
  onProcessError(cause: unknown): void;
  onPolicyViolation?(violation: AcpPolicyViolation): void;
  onWire?(direction: "in" | "out", line: string): void;
};

/* ============================================================
 * 空槽期到来的 agent→client 请求必须当场有答案。
 *
 * 对 `session/request_permission` 悬而不答会让 Kimi 的 turn 永久挂起
 * （2026-09-18 取证，PRD §4.3）；method-not-found 是「此刻没有客户端能
 * 决策」的诚实回答，而不是伪造一个批准或拒绝。
 *
 * 注意这与**已 attach** 的 turn 的错误路径正相反：那里必须回 outcome
 * （markStopped 用服务端 reject option 结算），因为那时确实有人在决策。
 * ============================================================ */
export function unattachedRequest(method: string): never {
  throw RequestError.methodNotFound(method);
}
