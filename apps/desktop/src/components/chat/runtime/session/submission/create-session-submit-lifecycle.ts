/**
 * [INPUT]: Depends on React layout lifecycle, renderer locale/catalog runtime, submission status setters, the Sections recovery-wait query, session refs, message projection, and attachment preview combinator
 * [OUTPUT]: Provides keyed submission lifecycle, acknowledges unsequenced queues without fabricating canonical messages, and useRecoveryWaitNotice (the Chat view names why startup recovery holds its queued message once it has waited 15 s)
 * [POS]: apps/desktop/src/components/chat/runtime/session/submission; The renderer lifecycle adapter for chat/runtime/session; The naked setter is isolated and blocks the old Chat that has been transferred to the main from re-infesting the current view. Post-send navigation is deliberately absent: the fence rightly voids late receipts after a keyed remount, so page switching belongs to the route's draft-residence observation, never to receipts
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ChatStatus } from "ai";
import type {
  SessionRef,
} from "../../../../../../shared/ipc/agent/agent-ipc";
import type {
  ChatMessage,
} from "../../../../../../shared/ipc/content/chats-ipc";
import type {
  ManualTurnReceipt,
} from "../../../../../../shared/ipc/content/sections-ipc";
import {
  createDraft,
  type TurnDraft,
} from "../../../../../../shared/chats/model/chat-turn-reducer";
import type { AgentRequest } from "@/lib/agent/agent-client";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { translate } from "../../../../../../shared/i18n/runtime";
import { getRecoveryWait } from "@/lib/clients/sections-client";
import {
  appendLivePreviews,
  type LiveAttachmentPreview,
} from "../../files/chat-attachments";

type Setter<T> = Dispatch<SetStateAction<T>>;

/* A message held by startup recovery waits quietly at first; past this it says why, and keeps the reason current until it sends. */
const RECOVERY_NOTICE_DELAY_MS = 15_000;
const RECOVERY_NOTICE_POLL_MS = 5_000;

/**
 * The composer's startup-recovery line, owned by the Chat view rather than one submission: it survives the blank page becoming the new
 * Chat. Asks once on mount and whenever a message turns queued; stops as soon as nothing of this Chat waits to start.
 */
export function useRecoveryWaitNotice(chatId: string, queued: boolean, setNotice: Setter<string>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined, shown = "", stopped = false;
    const show = (notice: string) => {
      if (notice === shown) return;
      const previous = shown;
      shown = notice;
      setNotice((current) => (current === previous ? notice : current));
    };
    const poll = async () => {
      const wait = await Promise.resolve().then(() => getRecoveryWait(chatId)).catch(() => null);
      if (stopped) return;
      if (!wait) return show("");
      const due = wait.since + RECOVERY_NOTICE_DELAY_MS - Date.now();
      show(wait.reason && due <= 0 ? translate(effectiveLocale(), `agentFailure.recovery.queued.${wait.reason}`) : "");
      timer = setTimeout(poll, due > 0 ? due : RECOVERY_NOTICE_POLL_MS);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [chatId, queued, setNotice]);
}

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
    request: MutableRefObject<AgentRequest | null>;
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
  /** `whole`: the message is already a complete sentence, so it goes without the "Message not sent:" lead. */
  rejectBeforeAdmission: (message: string, options?: { whole?: boolean }) => void;
  holdAmbiguousAdmission: (message: string) => void;
  showLocalAssistant: (content: string, isError?: boolean) => void;
  syncSession: (session: SessionRef | undefined) => void;
  accept: (
    receipt: ManualTurnReceipt,
    previews: LiveAttachmentPreview[]
  ) => void;
  reportAcceptedSyncFailure: (cause: unknown) => void;
  attachRequest: (request: AgentRequest) => void;
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
  const settleWithoutTurn = (line: string) => {
    if (!isCurrent()) return;
    refs.request.current = null;
    set.activeRequestId(null);
    set.cancelPending(false);
    set.status("ready");
    set.queued(false);
    clearDraft();
    appendLocalAssistant(line, true);
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
    rejectBeforeAdmission(message, options) {
      settleWithoutTurn(options?.whole ? message : translate(effectiveLocale(), "chat.runtime.submission.notSent", { message }));
    },
    holdAmbiguousAdmission(message) {
      settleWithoutTurn(translate(effectiveLocale(), "chat.runtime.submission.stateUnknown", { message }));
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
      if (receipt.userMessage) {
        appendPreviews(receipt.userMessage.id, previews);
        appendProjected(receipt.userMessage);
      }
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
  };
}
