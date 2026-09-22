/**
 * [INPUT]: Depends on original local Chat outboxes, frozen manual admissions and the existing ledger handoff.
 * [OUTPUT]: Captures owner-scoped turns from a turn-scoped outbox scan and transfers result evidence, including prepared results arriving after cloud settlement.
 * [POS]: Local-only adapter: every mutation targets the profile's SQLite worker, with no network transport.
 */
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { portableChatSchema } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatStore } from "../../chats/chat-store";
import type { RelayLedger } from "../../sections/coordinator/relay-ledger";
import { stableId } from "../../sections/coordinator/coordinator-values";
import { assertPreparedContentHash, type PreparedManualTurn } from "../../sections/coordinator/admission/prepared-manual-turn";
import { cloudActionSchema, handoffIdentity, type CloudAction } from "../../chats/sqlite/cloud/protocol";
import { localTurnAdmissionSchema, type LocalTurnAdmission } from "../../chats/sqlite/cloud/delivery/turns/model";
import { messageSchema, subagentsSchema } from "../../chats/chat-schema";
import { cloudRequestHash } from "../../chats/store/sync/api";
import { handoffLedgerTurn, recoverLedgerHandoffs } from "../../chats/store/sync/ledger-handoff";
import { readOutboxSource, type ChatOutboxItem, type ChatSyncStore } from "../sync/chats/sources";
async function readOutboxPages(store: ChatSyncStore, scope: SyncScope, filter: { entityKind?: "turn"; chatId?: string }) {
  const items: ChatOutboxItem[] = []; let afterId: string | null = null;
  for (;;) {
    const page = await store.read(scope, { type: "outbox", afterId, limit: 100, ...filter });
    if (page.type !== "outbox") throw new Error("CHAT_OUTBOX_UNAVAILABLE"); items.push(...page.value);
    if (items.length > 10000) throw new Error("CHAT_OUTBOX_READ_BUDGET");
    if (page.value.length < 100) return items; afterId = page.value.at(-1)!.id;
  }
}
// Turn scheduling only ever looks at turn rows, so the scan is proportional to live turns rather than the whole outbox.
export const readTurnOutbox = (store: ChatSyncStore, scope: SyncScope) => readOutboxPages(store, scope, { entityKind: "turn" });
// Result evidence spans a conversation's turn and business rows, which the query narrows by chat instead of by kind.
export const readChatOutbox = (store: ChatSyncStore, scope: SyncScope, chatId: string) => readOutboxPages(store, scope, { chatId });
type TurnSourcePorts = { store: ChatStore; ledger: RelayLedger; scope: SyncScope; deviceId: string; current(): void };
export async function captureTurnAdmissions(ports: TurnSourcePorts, items: ChatOutboxItem[]) {
  const existing = new Set(items.filter(item => item.kind === "live-turn").map(item => item.entity_id));
  type Source = { chat: unknown; message?: unknown; messages?: unknown[]; notices?: unknown[] };
  // An admission is built from the conversation's own business commits, which the turn-scoped scan above deliberately excludes.
  const cached = new Map<string, Source>(), conversations = new Map<string, ChatOutboxItem[]>();
  const business = async (chatId: string) => {
    let value = conversations.get(chatId);
    if (!value) { value = await readChatOutbox(ports.store.sync, ports.scope, chatId); conversations.set(chatId, value); }
    return value;
  };
  const intents = Object.values(ports.ledger.snapshot().manualIntents).filter(intent => intent.payload && intent.userSeq && intent.assistantSeq && intent.requestId && !existing.has(intent.requestId));
  for (const intent of intents) {
    ports.current();
    const receipt = await ports.store.sync.read(ports.scope, { type: "turn-receipt", turnId: intent.requestId! });
    if (receipt.type === "turn-receipt" && receipt.value?.settlementState === "settled") continue;
    const prepared = intent.payload as PreparedManualTurn;
    if (!prepared.turn || !prepared.contentHash || !intent.userMessage) continue;
    assertPreparedContentHash(prepared);
    const current = await ports.store.sync.read(ports.scope, { type: "local-execution", chatId: intent.conversationId });
    if (current.type !== "local-execution") throw new Error("EXECUTION_STATE_UNAVAILABLE");
    const confirmed = current.value?.head;
    if (confirmed && confirmed.ownerDeviceId !== ports.deviceId) continue;
    const user = messageSchema.parse({ ...intent.userMessage as object, seq: intent.userSeq });
    for (const item of await business(intent.conversationId)) {
      if (item.entity_kind === "turn" || JSON.parse(item.payload_json).chatId !== intent.conversationId) continue;
      let source = cached.get(item.id);
      if (!source) { source = (await readOutboxSource(ports.store.sync, ports.scope, item)).payload as Source;
        if (!source || !source.chat) continue; cached.set(item.id, source); }
      const messages = [source.message, ...(source.messages ?? []), ...(source.notices ?? [])].filter(Boolean);
      if (!messages.some(message => hashChatContent(message) === hashChatContent(user))) continue;
      const chat = portableChatSchema.parse(source.chat), sequences = { noticeSeq: intent.noticeSeq,
        userSeq: intent.userSeq!, assistantSeq: intent.assistantSeq! };
      const notices = [sequences.noticeSeq].filter(seq => seq !== undefined).map(seq => {
        const found = messages.map(message => messageSchema.parse(message)).find(message => message.seq === seq);
        if (!found || found.role !== "notice") throw new Error("TURN_NOTICE_SOURCE_UNAVAILABLE"); return found;
      });
      const admission = localTurnAdmissionSchema.parse({ ledgerIntentId: intent.id, turnId: intent.requestId, chat, sequences,
        ownerDeviceId: ports.deviceId,
        assistantMessageId: stableId("assistant", intent.id), user, notices,
        expectedAgentRevision: prepared.expectedAgentRevision ?? chat.agentRevision - (intent.noticeSeq ? 1 : 0),
        options: prepared.turn.turnOptions, planRequested: prepared.turn.planMode ?? false, createdAt: intent.createdAt });
      ports.current(); await ports.store.sync.mutate(ports.scope, hashChatContent(["live-turn", ports.scope, admission.chat.id, admission.turnId]),
        { type: "capture-live-turn", sourceId: item.id, payloadDigest: item.payload_digest, admission });
      break;
    }
  }
}
export type HandoffEvidence = Extract<CloudAction, { type: "handoff-turn" }>["evidence"];
type HandoffAdmission = Pick<LocalTurnAdmission, "ledgerIntentId" | "turnId" | "sequences" | "user" | "assistantMessageId"> & { chat: { id: string } };
export async function transferTurnEvidence(ports: TurnSourcePorts, admission: HandoffAdmission, live: boolean) {
  await recoverLedgerHandoffs(ports.ledger, ports.store); ports.current();
  const state = ports.ledger.snapshot(), intent = state.manualIntents[admission.ledgerIntentId];
  if (!intent) return;
  const result = state.manualResultOutbox[intent.id], available = result && ["stored", "empty"].includes(result.outcome);
  if (intent.cloudHandoff?.state === "confirmed" && (!available || intent.cloudHandoff.command.action.type !== "handoff-turn" ||
      intent.cloudHandoff.command.action.evidence.resultKind !== "pending")) return;
  if (!available && live || !available && !live && !["failed", "claimed", "settled"].includes(intent.phase)) return;
  const attempt = intent.attempts.at(-1) ?? null;
  const dispatch = !attempt || attempt.phase === "claimed" ? "not-started" : ["dispatched", "result-prepared", "persisted"].includes(attempt.phase) ? "dispatched" : "outcome-unknown";
  const message = available && result.assistantMessage ? messageSchema.parse(result.assistantMessage) : null;
  const action: Extract<CloudAction, { type: "handoff-turn" }> = { type: "handoff-turn", chatId: admission.chat.id,
    turnId: admission.turnId, evidence: {
      ledgerIntentId: intent.id, identityHash: "0".repeat(64), dispatch, attempt, ...admission.sequences,
      userMessageId: admission.user.id, userMessage: admission.user, assistantMessageId: admission.assistantMessageId,
      resultKind: available ? message ? "message" : "empty" : "pending", resultHash: available ? hashChatContent(message ? { ...message, resultHash: undefined } : null) : null,
      resultMessage: message, ...(result?.terminal ? { terminal: result.terminal } : {}),
      ...(result?.subagents ? { subagents: subagentsSchema.parse(result.subagents) } : {}),
    } };
  action.evidence.identityHash = hashChatContent(handoffIdentity(action));
  const command = { kind: "cloud-mutate" as const, operationId: hashChatContent(["turn-handoff", ports.scope, admission.turnId, action.evidence.resultKind, action.evidence.resultHash]),
    deviceId: ports.deviceId, scope: ports.scope, action: cloudActionSchema.parse(action) };
  ports.current(); await handoffLedgerTurn(ports.ledger, ports.store, intent.id, { ...command, requestHash: cloudRequestHash(command) });
}
export async function recoverLateTurnEvidence(ports: TurnSourcePorts) {
  const state = ports.ledger.snapshot();
  for (const intent of Object.values(state.manualIntents)) {
    if (!intent.requestId || !intent.userMessage || !state.manualResultOutbox[intent.id]) continue;
    ports.current(); const local = await ports.store.sync.read(ports.scope, { type: "turn-receipt", turnId: intent.requestId });
    if (local.type !== "turn-receipt" || local.value?.settlementState !== "settled") continue;
    const receipt = local.value, user = messageSchema.parse({ ...intent.userMessage as object, seq: intent.userSeq });
    if (receipt.ownerDeviceId !== ports.deviceId || receipt.chatId !== intent.conversationId || receipt.userMessageId !== user.id ||
      receipt.userSeq !== intent.userSeq || receipt.assistantSeq !== intent.assistantSeq || receipt.assistantMessageId !== stableId("assistant", intent.id)) throw new Error("LATE_TURN_IDENTITY_CHANGED");
    await transferTurnEvidence(ports, { ledgerIntentId: intent.id, turnId: receipt.turnId, chat: { id: receipt.chatId }, user,
      assistantMessageId: receipt.assistantMessageId,
      sequences: { noticeSeq: intent.noticeSeq, userSeq: receipt.userSeq, assistantSeq: receipt.assistantSeq } }, false);
  }
}
