/**
 * [INPUT]: Depends on the canonical current user, saved recovery candidates and the existing notice writer.
 * [OUTPUT]: Supplies main-only session replay admission and durable fallback disclosure.
 * [POS]: Bridge between folder recovery and ACP; no restored session binds before proof succeeds.
 */
import type { ChatsService } from "../../chats/chats-service";
import type { BackendTurnOptions } from "../../backends/types";
import type { HandoffCoverage } from "../../../../shared/chat-agent/contracts";
import { sessionBoundary, sessionCwdDigest } from "./boundary";
export async function prepareSessionRecovery(chats: ChatsService, input: { chatId: string; incarnationId: string; userMessageId: string;
  workspace: string; backend: BackendTurnOptions["payload"]["turnOptions"]["backend"]; coverage?: HandoffCoverage }): Promise<BackendTurnOptions["sessionRecovery"]> {
  const registry = chats.store.library.sessions, saved = await registry.read(input.chatId);
  if (!saved?.pending || saved.incarnationId !== input.incarnationId) return undefined;
  const record = await chats.store.get(input.chatId); if (!record || record.session) return undefined;
  const user = record.messages.find(message => message.id === input.userMessageId && message.role === "user");
  if (!user) throw new Error("SESSION_RECOVERY_USER_MISSING");
  const history = (await chats.store.library.transcript(input.chatId)).messages.filter(message => message.seq < user.seq && message.role !== "notice");
  const actual = sessionBoundary(history);
  const candidate = saved.hints.find(hint => hint.backend === input.backend && hint.cwdDigest === sessionCwdDigest(input.workspace) &&
    hint.headSeq === saved.headSeq && hint.messageId === saved.messageId && actual.userTurns === hint.boundary.userTurns &&
    actual.lastTurnHash === hint.boundary.lastTurnHash && history.at(-1)?.seq === hint.headSeq) ?? null;
  return { candidate, async complete(outcome) {
    if (outcome === "replayed") {
      const seq = user.seq - 1;
      const occupied = record.messages.find(message => message.seq === seq);
      if (!occupied && seq > saved.headSeq) {
        const notice = { kind: "agent-switched" as const, from: input.backend, to: input.backend, at: user.createdAt,
          agentRevision: record.agentRevision, context: input.coverage ?? { mode: "none" as const, historyIncluded: false, notInjected: true, storageTrimmed: false, lookup: "unavailable" as const } };
        await chats.appendCanonical(input.chatId, { id: `restore_${sessionCwdDigest(user.id).slice(0, 32)}`, role: "notice", seq, createdAt: user.createdAt,
          content: `Conversation continued in a new ${input.backend} session`, notice });
      }
    }
    await registry.complete(input.chatId, input.incarnationId);
  } };
}
