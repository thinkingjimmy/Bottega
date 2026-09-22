/**
 * [INPUT]: Current owner identity, retained encrypted command session, native dialog and exact-head reader.
 * [OUTPUT]: Remote fork choices with private preflight and navigation only after the child head arrives.
 * [POS]: Shared fork host adapter; immutable per-choice attempts survive lost acknowledgements.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { RemoteCommandInput } from "../../../platform/remote/contracts";
import type { ChatListSource } from "../../../platform/contracts";
import type { RemoteCommandSession } from "../../../platform/remote/commands/session";
import { awaitRemoteResult } from "../../../platform/remote/commands/result";
import { awaitChatHead } from "../../../platform/remote/commands/await-head";
import { useComposerTranslation } from "../../composer/controls/copy/translation";
import { ForkChatDialog, type ForkDialogPorts, type ForkDialogInput } from "../../conversation/interactions/fork";
import { remoteCopy } from "../../../i18n/remote";
export function RemoteForkDialog({ head, anchor, session, chats, navigate, onClose, locale }: {
  head: CloudChatHead; anchor: { id: string; seq: number }; session: RemoteCommandSession; chats: ChatListSource;
  navigate(chatId: string): void; onClose(): void; locale: string;
}) {
  const translate = useComposerTranslation(locale), copy = remoteCopy(locale);
  const t = useCallback((key: string, values?: Record<string, unknown>) => translate(key.replace(/^chat\./, ""), values), [translate]);
  const lifetime = useMemo(() => new AbortController(), []);
  useEffect(() => () => lifetime.abort(), [lifetime]);
  const attempts = useRef(new Map<string, RemoteCommandInput>());
  const ports = useMemo<ForkDialogPorts>(() => {
    const run = async (input: ForkDialogInput, checkOnly: boolean, signal = lifetime.signal) => {
      const key = `${head.chat.id}/${head.chat.incarnationId}/${input.anchorMessageId}/${input.mode}/${checkOnly}`, prior = attempts.current.get(key);
      const command: RemoteCommandInput = prior ?? { commandId: crypto.randomUUID(), chatId: head.chat.id, incarnationId: head.chat.incarnationId,
        targetDeviceId: head.ownerDeviceId!, payload: { kind: "fork-chat", fromMessageId: input.anchorMessageId,
          execution: input.mode === "new-worktree" ? "managed-worktree" : "same-workspace", ...(checkOnly ? { checkOnly: true } : {}) } };
      attempts.current.set(key, command);
      const result = await awaitRemoteResult(session, command, signal);
      if (result.output?.kind === "fork-error") throw new Error(result.output.code);
      if (result.state !== "done" || !result.output) throw new Error(result.state === "outcome-unknown" ? copy.receiptUnknown : copy.requestFailed);
      return result.output;
    };
    return {
      preflight: async (input, signal) => {
        const result = await run(input, true, signal);
        if (result.kind !== "fork-preflight") throw new Error(copy.requestFailed);
        return result;
      },
      fork: async input => {
        const result = await run(input, false);
        if (result.kind !== "fork-chat") throw new Error(copy.requestFailed);
        await awaitChatHead(chats, result, lifetime.signal);
        return { id: result.chatId };
      },
    };
  }, [attempts, head.chat.id, head.chat.incarnationId, head.ownerDeviceId, chats, session, lifetime, copy]);
  return <ForkChatDialog anchor={anchor} context={{ summary: head.chat, navigateToChat: navigate }} ports={ports} onClose={onClose}
    t={t} />;
}
