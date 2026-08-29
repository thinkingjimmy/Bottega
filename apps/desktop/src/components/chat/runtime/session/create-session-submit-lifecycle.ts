/**
 * [INPUT]: Depends on React layout lifecycle, submitting transaction status setter, session refs, message projection and attachment preview combinator
 * [OUTPUT]: Provides keyed mount-aware useSessionViewFence with generation-scoped createSessionSubmitLifecycle
 * [POS]: The renderer lifecycle adapter for chat/runtime/session; The naked setter is isolated and blocks the old Chat that has been transferred to the main from re-infesting the current view. Post-send navigation is deliberately absent: the fence rightly voids late receipts after a keyed remount, so page switching belongs to the route's draft-residence observation, never to receipts
 */

import {
  useCallback,
  useLayoutEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ChatStatus } from "ai";
import type {
  SessionRef,
} from "../../../../../shared/agent-ipc";
import type {
  ChatMessage,
} from "../../../../../shared/chats-ipc";
import type {
  ManualTurnReceipt,
} from "../../../../../shared/sections-ipc";
import {
  createDraft,
  type TurnDraft,
} from "../../../../../shared/chat-turn-reducer";
import type { CodexRequest } from "@/lib/agent-client";
import { errorMessage } from "@/lib/errors";
import {
  appendLivePreviews,
  type LiveAttachmentPreview,
} from "../chat-attachments";

type Setter<T> = Dispatch<SetStateAction<T>>;

function createViewFence() {
  let active: { chatId: string } | null = null;
  return {
    enter(chatId: string) {
      const token = { chatId };
      active = token;
      return () => {
        if (active === token) active = null;
      };
    },
    capture(chatId: string) {
      const token = active;
      return () =>
        token !== null && token.chatId === chatId && active === token;
    },
  };
}

export function useSessionViewFence(chatId: string) {
  const [fence] = useState(createViewFence);
  useLayoutEffect(() => fence.enter(chatId), [chatId, fence]);
  return useCallback(() => fence.capture(chatId), [chatId, fence]);
}

type SessionSubmitLifecycleInput = {
  isCurrent: () => boolean;
  appendProjected: (message: ChatMessage) => void;
  appendLocalAssistant: (content: string, isError?: boolean) => void;
  refs: {
    draft: MutableRefObject<TurnDraft | null>;
    recordExists: MutableRefObject<boolean>;
    request: MutableRefObject<CodexRequest | null>;
  };
  set: {
    activeRequestId: Setter<string | null>;
    agentSession: Setter<SessionRef | undefined>;
    attachmentNotice: Setter<string>;
    draft: Setter<TurnDraft | null>;
    livePreviews: Setter<ReadonlyMap<string, LiveAttachmentPreview[]>>;
    cancelPending: Setter<boolean>;
    persisted: Setter<boolean>;
    queued: Setter<boolean>;
    queueNotice: Setter<string>;
    status: Setter<ChatStatus>;
  };
};

export type SessionSubmitLifecycle = {
  isCurrent: () => boolean;
  begin: () => void;
  clearAttachmentNotice: () => void;
  rejectBeforeAdmission: (message: string) => void;
  holdAmbiguousAdmission: (message: string) => void;
  showLocalAssistant: (content: string, isError?: boolean) => void;
  syncSession: (session: SessionRef | undefined) => void;
  accept: (
    receipt: ManualTurnReceipt,
    previews: LiveAttachmentPreview[]
  ) => void;
  reportAcceptedSyncFailure: (cause: unknown) => void;
  attachRequest: (request: CodexRequest) => void;
  projectFallback: (
    message: ChatMessage,
    previews: LiveAttachmentPreview[]
  ) => void;
};

export function createSessionSubmitLifecycle({
  isCurrent,
  appendProjected,
  appendLocalAssistant,
  refs,
  set,
}: SessionSubmitLifecycleInput): SessionSubmitLifecycle {
  const clearDraft = () => {
    refs.draft.current = null;
    set.draft(null);
  };
  const createTurnDraft = () => {
    refs.draft.current = createDraft(Date.now());
    set.draft(refs.draft.current);
  };
  const appendPreviews = (
    messageId: string,
    previews: LiveAttachmentPreview[]
  ) => {
    if (!previews.length) return;
    set.livePreviews((current) =>
      appendLivePreviews(current, messageId, previews)
    );
  };
  /* 只翻事实位，不导航：切页由路由观察「草稿 id 已入列表」独立完成。
     受理回执经不起换槽重挂——fence 会如实作废它，导航挂在这儿就是竞态。 */
  const markPersisted = () => {
    if (refs.recordExists.current) return;
    refs.recordExists.current = true;
    set.persisted(true);
  };

  return {
    isCurrent,
    begin() {
      if (!isCurrent()) return;
      set.status("submitted");
      set.queued(false);
    },
    clearAttachmentNotice() {
      if (!isCurrent()) return;
      set.attachmentNotice("");
    },
    rejectBeforeAdmission(message) {
      if (!isCurrent()) return;
      refs.request.current = null;
      set.activeRequestId(null);
      set.cancelPending(false);
      set.status("ready");
      set.queued(false);
      clearDraft();
      appendLocalAssistant(`**消息未发送：** ${message}`, true);
    },
    holdAmbiguousAdmission(message) {
      if (!isCurrent()) return;
      refs.request.current = null;
      set.activeRequestId(null);
      set.cancelPending(false);
      set.status("ready");
      set.queued(false);
      clearDraft();
      appendLocalAssistant(
        `**消息状态未知：** ${message}。已保留原提交身份，请在队列中选择重发或删除。`,
        true
      );
    },
    showLocalAssistant(content, isError) {
      if (!isCurrent()) return;
      appendLocalAssistant(content, isError);
    },
    syncSession(session) {
      if (!isCurrent()) return;
      set.agentSession(session);
    },
    accept(receipt, previews) {
      if (!isCurrent()) return;
      if (receipt.phase !== "queued" && receipt.phase !== "started") return;
      const isQueued = receipt.phase === "queued";
      set.queued(isQueued);
      set.queueNotice("");
      if (receipt.blockedBy === "chain-paused") {
        set.queueNotice(
          "消息已排队：该 Section 的接力链已暂停，请先处理聊天顶部的“继续”提示。"
        );
      } else if (receipt.blockedBy === "relay-queue") {
        set.queueNotice("消息已排队：该 Section 有待处理的接力消息。");
      }
      appendPreviews(receipt.userMessage.id, previews);
      appendProjected(receipt.userMessage);
      createTurnDraft();
      markPersisted();
    },
    reportAcceptedSyncFailure(cause) {
      if (!isCurrent()) return;
      const notice =
        `消息已被 Agent 接受，但本地会话状态刷新失败：${errorMessage(cause)}` +
        "。请勿重复发送；当前任务仍会继续。";
      set.queueNotice((current) =>
        current ? `${current} ${notice}` : notice
      );
    },
    attachRequest(request) {
      if (!isCurrent()) {
        request.dispose();
        return;
      }
      refs.request.current = request;
      set.activeRequestId(request.requestId);
    },
    projectFallback(message, previews) {
      if (!isCurrent()) return;
      appendPreviews(message.id, previews);
      appendProjected(message);
      createTurnDraft();
    },
  };
}
