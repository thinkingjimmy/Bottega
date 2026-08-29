/**
 * [INPUT]: Depends on nanoid, AbortSignal, shared Agent/App IPC, preload bridges, and browser mocks
 * [OUTPUT]: Provides attach/event subscriptions, send/steer/decision commands, same-session and fresh-session retry, abandon, cancel, and cleanup confirmation
 * [POS]: The renderer's narrow Agent IPC facade; local disposal never cancels a main-owned turn
 */

import { nanoid } from "nanoid";
import type { AgentUserInput } from "../../shared/agent-ipc";
import type { AppBridgeApi } from "../../shared/app-ipc";
import type {
  AgentBridgeApi,
  AgentEvent,
  AgentApprovalDecision,
  AgentScope,
  AgentTurnOptions,
  AgentUserInputResponse,
  ChatActivityEvent,
  SessionRef,
  SteerAdmission,
  SteerDecision,
  SteerIpcReceipt,
  TurnAttachResult,
} from "../../shared/agent-ipc";
import { throwIfSubmissionAborted } from "@ai-chat/ui/lib/prompt-input-submission";
import { createBrowserAgentBridge } from "./agent-client-mock";

declare global {
  interface Window {
    agent?: AgentBridgeApi;
    app?: AppBridgeApi;
  }
}

let browserBridge: AgentBridgeApi | undefined;

// 真假 bridge 的唯一汇合点：Electron 走 preload，纯浏览器懒建 mock。
// 此后所有导出直接调 bridge()，不再各自判断 window.agent。
const bridge = (): AgentBridgeApi =>
  window.agent ?? (browserBridge ??= createBrowserAgentBridge());

export type AgentRequest = {
  requestId: string;
  started: Promise<void>;
  cancel: () => void;
  dispose: () => void;
  respondApproval: (
    approvalId: string,
    decision: AgentApprovalDecision
  ) => Promise<void>;
  respondUserInput: (
    userInputId: string,
    answers: AgentUserInputResponse["answers"]
  ) => Promise<void>;
};

/** @deprecated renderer 正在迁移到 AgentRequest；仅保留源兼容，不进入 IPC。 */
export type CodexRequest = AgentRequest;

export function sendToAgent(
  input: AgentUserInput[],
  session: SessionRef | string | undefined,
  scope: AgentScope,
  turnOptions: AgentTurnOptions,
  planMode: boolean,
  signal?: AbortSignal
): AgentRequest {
  if (signal) throwIfSubmissionAborted(signal);
  const api = bridge();
  const requestId = nanoid();
  let active = true;
  const started = api.send({
    requestId,
    session:
      typeof session === "string"
        ? { backend: turnOptions.backend, id: session }
        : session,
    scope,
    turnOptions,
    input,
    ...(planMode ? { planMode: true } : {}),
  });

  return {
    requestId,
    started,
    cancel() {
      if (active) api.cancel(requestId);
    },
    dispose() {
      active = false;
    },
    respondApproval(approvalId, decision) {
      if (!active) return Promise.reject(new Error("Agent 请求已结束"));
      return api.respondApproval({ requestId, approvalId, decision });
    },
    respondUserInput(userInputId, answers) {
      if (!active) return Promise.reject(new Error("Agent 请求已结束"));
      return api.respondUserInput({ requestId, userInputId, answers });
    },
  };
}

export type CodexAttachment = {
  ready: Promise<void>;
  dispose: () => void;
};

export function attachToAgent(
  conversationId: string,
  handlers: {
    onSnapshot: (snapshot: TurnAttachResult) => void;
    onEvent: (event: AgentEvent) => void;
  }
): CodexAttachment {
  const api = bridge();
  const attachmentId = nanoid();
  let active = true;
  let live = false;
  const buffered: AgentEvent[] = [];
  const unsubscribe = api.onEvent((event) => {
    if (!active || event.conversationId !== conversationId) return;
    if (!live) buffered.push(event);
    else handlers.onEvent(event);
  });
  const ready = api.attachTurn(conversationId, attachmentId).then((snapshot) => {
    if (!active) return;
    handlers.onSnapshot(snapshot);
    for (const event of buffered
      .filter((event) => event.seq > snapshot.lastSeq)
      .sort((left, right) => left.seq - right.seq)) {
      if (!active) return;
      handlers.onEvent(event);
    }
    buffered.length = 0;
    live = true;
  });
  return {
    ready,
    dispose() {
      if (!active) return;
      active = false;
      buffered.length = 0;
      unsubscribe();
      api.detachTurn(conversationId, attachmentId);
    },
  };
}

// 会话活动：与 attach 无关的窗口级广播，后台会话也收得到。
export const onAgentActivity = (
  callback: (event: ChatActivityEvent) => void
) => bridge().onActivity(callback);

export const listAgentActivity = () => bridge().listActivity();

export const abandonFatalTurn = (conversationId: string) =>
  bridge().abandonFatalTurn(conversationId);

export const acknowledgeCleanupFailure = (conversationId: string) =>
  bridge().acknowledgeCleanupFailure(conversationId);

export const retryAgentWithoutSession = (
  conversationId: string,
  retryToken: string
) => bridge().retryWithoutSession(conversationId, retryToken);
export const retryAgentSameSession = (
  requestId: string,
  retryToken: string
) => {
  const retry = bridge().retrySameSession;
  if (!retry) throw new Error("same-session retry is unavailable");
  return retry(requestId, retryToken);
};

export const cancelAgentRequest = (requestId: string) =>
  bridge().cancel(requestId);

export const steerAgent = (
  input: SteerAdmission
): Promise<SteerIpcReceipt> => bridge().steer(input);

export const decideAgentSteer = (
  input: SteerDecision
): Promise<SteerIpcReceipt> => bridge().decideSteer(input);

export const ackAgentSteerIntents = (outboxRefs: string[]) =>
  bridge().ackSteerIntents(outboxRefs);

export const respondAgentApproval = (
  requestId: string,
  approvalId: string,
  decision: AgentApprovalDecision
) => bridge().respondApproval({ requestId, approvalId, decision });

export const respondAgentUserInput = (
  requestId: string,
  userInputId: string,
  answers: AgentUserInputResponse["answers"]
) => bridge().respondUserInput({ requestId, userInputId, answers });

export async function openExternal(url: string) {
  if (window.app) {
    await window.app.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function writeClipboardText(text: string) {
  if (window.app) {
    await window.app.writeClipboard(text);
    return;
  }
  if (!navigator.clipboard?.writeText) {
    throw new Error("当前环境不支持剪贴板写入");
  }
  await navigator.clipboard.writeText(text);
}
