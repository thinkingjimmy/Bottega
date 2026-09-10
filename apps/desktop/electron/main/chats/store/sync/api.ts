/**
 * [INPUT]: Depends on ChatStore's shared queue/state and the strict worker cloud protocol.
 * [OUTPUT]: Provides scoped synchronization reads/mutations and receipt-gated local lifecycle conversion.
 * [POS]: Main-only Chat facade collaborator; publication follows durable receipt confirmation.
 */
import { createHash } from "node:crypto";
import { canonicalJson, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { chatFactsSchema } from "../../chat-schema";
import type { ChatFacts } from "../../chat-summary";
import type { ChatDatabaseClient } from "../../sqlite/database-client";
import type { CloudAction, CloudQuery } from "../../sqlite/cloud/protocol";
import type { ChatStoreState } from "../state";
import { ChatMutationOutcomeUnknownError } from "../mutation-outcome";

export const cloudRequestHash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
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
  constructor(private state: ChatStoreState) {}
  read(scope: SyncScope | null, query: CloudQuery) {
    return this.state.queue.enqueue(() => this.state.requireDatabase().execute({
      kind: "cloud-read", deviceId: this.state.requireDeviceId(), scope, query,
    }));
  }
  mutate(scope: SyncScope | null, operationId: string, action: CloudAction) {
    return this.state.queue.enqueue(async () => {
      const receipt = await executeCloudMutation(this.state.requireDatabase(), this.state.requireDeviceId(), scope, operationId, action);
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
