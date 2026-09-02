/**
 * [INPUT]: Depends on React layout lifecycle, renderer locale/catalog runtime, submission status setters, session refs, message projection, and attachment preview combinator
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
import { effectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";
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
      appendLocalAssistant(
        translate(effectiveLocale(), "chat.runtime.submission.notSent", {
          message,
        }),
        true
      );
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
        translate(effectiveLocale(), "chat.runtime.submission.stateUnknown", {
          message,
        }),
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
          translate(effectiveLocale(), "chat.runtime.submission.relayPaused")
        );
      } else if (receipt.blockedBy === "relay-queue") {
        set.queueNotice(
          translate(effectiveLocale(), "chat.runtime.submission.relayPending")
        );
      }
      appendPreviews(receipt.userMessage.id, previews);
      appendProjected(receipt.userMessage);
      createTurnDraft();
      markPersisted();
    },
    reportAcceptedSyncFailure(cause) {
      if (!isCurrent()) return;
      const notice = translate(
        effectiveLocale(),
        "chat.runtime.submission.acceptedRefreshFailed",
        { message: errorMessage(cause) }
      );
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
