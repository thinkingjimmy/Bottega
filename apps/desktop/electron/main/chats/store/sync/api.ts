/**
 * [INPUT]: Depends on ChatStore's shared queue/state and the strict worker cloud protocol.
 * [OUTPUT]: Provides scoped synchronization, recovered Chat commits, terminal Home and outbox-append hooks whose explicit notifier names the Chat a business metadata edit touched, and device-name projections.
 * [POS]: Main-only Chat facade collaborator; publication follows durable receipt confirmation.
 */
import { hashCanonical } from "@ai-chat/cloud-protocol";
import { projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { chatFactsSchema } from "../../chat-schema";
import type { ChatFacts } from "../../chat-summary";
import type { ChatDatabaseClient } from "../../sqlite/database-client";
import type { CloudAction, CloudQuery } from "../../sqlite/cloud/protocol";
import type { ChatStoreState } from "../state";
import { ChatMutationOutcomeUnknownError } from "../mutation-outcome";
import { homeTurnSchema, type HomeTurn } from "../../sqlite/cloud/home/contracts";
import { ChatRecoveryStore } from "./recovery";

// Cloud actions that append a row to the outbox; publication wakes on these instead of waiting for the next timer tick.
const APPENDING: Partial<Record<CloudAction["type"], "turn" | "chat">> = { "capture-live-turn": "turn", "handoff-turn": "turn",
  "capture-home-job": "chat", "commit-classification": "chat", "request-chat-deletion": "chat" };
/* Title, archive and sortKey are exactly the three values captureMetadataEdit turns into a queued metadata patch,
   so a business mutation that moves one of them appended outbox work and may wake publication now. */
export const metadataEdited = (before: MetadataValues, after: MetadataValues) => before.title !== after.title ||
  (before.archivedAt ?? null) !== (after.archivedAt ?? null) || (before.sortKey ?? null) !== (after.sortKey ?? null);
type MetadataValues = Pick<ChatFacts, "title" | "archivedAt" | "sortKey">;
export const cloudRequestHash = hashCanonical;
export async function executeCloudMutation(database: ChatDatabaseClient, deviceId: string, scope: SyncScope | null,
  operationId: string, action: CloudAction) {
  const command = { kind: "cloud-mutate" as const, operationId, deviceId, scope, action };
  const outcome = await database.execute({ ...command, requestHash: cloudRequestHash(command) });
  if (outcome.status === "outcome_unknown") throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
  if (outcome.status === "rejected") throw new Error(outcome.failure.message);
  return outcome.receipt;
}
export async function persistLocalClassification(input: {
  database: ChatDatabaseClient; deviceId: string; current: ChatFacts; facts: ChatFacts;
}) {
  const lifecycleOperationId = cloudRequestHash({ chatId: input.current.id, incarnationId: input.current.incarnationId,
    expectedRevision: input.current.chatRecordRevision, facts: input.facts });
  await executeCloudMutation(input.database, input.deviceId, null, lifecycleOperationId, {
    type: "propose-classification", lifecycleOperationId, expectedRevision: input.current.chatRecordRevision,
    previous: projectChatClassification(input.current), facts: chatFactsSchema.parse(input.facts),
  });
  return executeCloudMutation(input.database, input.deviceId, null, cloudRequestHash({ lifecycleOperationId, commit: true }),
    { type: "commit-classification", lifecycleOperationId });
}
export class ChatSyncApi {
  readonly recovery: ChatRecoveryStore;
  private deviceNames = new Map<string, string>();
  private readonly captureHome = new Set<(turn: HomeTurn) => Promise<void>>();
  private appended = new Set<(entityKind: "turn" | "chat", chatId?: string) => void>();
  constructor(private state: ChatStoreState) { this.recovery = new ChatRecoveryStore(state); }
  onHomeSettlement(capture: (turn: HomeTurn) => Promise<void>) {
    this.captureHome.add(capture); return () => { this.captureHome.delete(capture); };
  }
  onOutboxAppended(notify: (entityKind: "turn" | "chat", chatId?: string) => void) {
    this.appended.add(notify); return () => { this.appended.delete(notify); };
  }
  // A named Chat can be published on its own fast lane; cloud actions stay anonymous and only wake the pass.
  notifyAppended(entityKind: "turn" | "chat", chatId?: string) { for (const notify of [...this.appended]) notify(entityKind, chatId); }
  async captureTurnHome(chatId: string, turn: { requestId?: string; userMessage?: unknown; userMessageId?: string; userSeq?: number; assistantSeq?: number }) {
    if (!this.captureHome.size || !turn.requestId || !turn.userSeq || !turn.assistantSeq) return;
    const message = turn.userMessage;
    const userMessageId = turn.userMessageId ?? (message && typeof message === "object" && "id" in message ? message.id : undefined);
    const settled = homeTurnSchema.parse({ chatId, turnId: turn.requestId, userMessageId, userSeq: turn.userSeq, assistantSeq: turn.assistantSeq });
    const results = await Promise.allSettled([...this.captureHome].map(capture => capture(settled)));
    const failure = results.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  setDeviceNames(devices: ReadonlyArray<{ deviceId: string; name: string }>) {
    for (const device of devices) if (device.name.trim()) this.deviceNames.set(device.deviceId, device.name.trim().slice(0, 80));
  }
  clearDeviceNames() { this.deviceNames.clear(); }
  deviceName(deviceId: string) { return this.deviceNames.get(deviceId) ?? `Device ${deviceId.slice(0, 8)}`; }
  configureMode(storageMode: import("../../../../../shared/local-storage/contracts").RuntimeStorageMode) {
    return this.state.queue.enqueue(() => this.state.requireDatabase().execute({ kind: "configure-storage-mode", storageMode }));
  }
  read(scope: SyncScope | null, query: CloudQuery) {
    return this.state.queue.enqueue(() => this.state.requireDatabase().execute({
      kind: "cloud-read", deviceId: this.state.requireDeviceId(), scope, query,
    }));
  }
  mutate(scope: SyncScope | null, operationId: string, action: CloudAction) {
    return this.state.queue.enqueue(async () => {
      const receipt = await executeCloudMutation(this.state.requireDatabase(), this.state.requireDeviceId(), scope, operationId, action);
      const appended = APPENDING[action.type];
      if (appended) this.notifyAppended(appended);
      if (action.type === "save-outbox-checkpoint" && action.checkpoint.kind === "turn-chunk") this.notifyAppended("turn");
      if (["capture-home-job", "archive-home-job", "capture-live-turn", "handoff-turn", "attempt-outbox", "cache-blob", "advance-catalog", "begin-mirror-body", "stage-mirror-body", "stage-mirror-empty"].includes(action.type) ||
        action.type === "save-outbox-checkpoint" && action.checkpoint.kind !== "metadata-receipt") return receipt;
      const metadata = await this.state.requireDatabase().execute({ kind: "list-metadata", deviceId: this.state.requireDeviceId() });
      this.state.metadata.clear();
      this.state.messageRevisions.clear();
      for (const record of metadata) {
        this.state.metadata.set(record.id, record);
        this.state.messageRevisions.set(record.id, record.chatMessageRevision);
      }
      this.state.activeRecord = undefined;
      this.state.touch();
      return receipt;
    });
  }
}
