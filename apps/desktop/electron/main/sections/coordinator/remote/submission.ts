/**
 * [INPUT]: Depends on the original coordinator lifecycle/conversation gates and frozen remote ledger custody.
 * [OUTPUT]: Admits trusted remote submissions and adds canonical user provenance after public validation.
 * [POS]: Main-only adapter into ordinary manual admission; it never dispatches an Agent directly.
 */
import type { ManualTurnReceipt, TrustedManualTurnSubmission } from "../../../../../shared/sections-ipc";
import type { UserChatMessage } from "../../../../../shared/chats-ipc";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import { canonicalHash } from "../coordinator-values";
import { remoteContextSchema, type RemoteContext } from "./model";
type Ports = { dependencies(): CoordinatorDependencies;
  runConversation<T>(chatId: string, run: () => Promise<T>): Promise<T>;
  admit(submission: TrustedManualTurnSubmission, context: RemoteContext, current: () => void): Promise<ManualTurnReceipt> };
export class RemoteAdmission {
  constructor(private readonly ports: Ports) {}
  submit(input: RemoteContext, build: () => Promise<TrustedManualTurnSubmission>, current: () => void = () => {}) {
    const context = remoteContextSchema.parse(input), dependencies = this.ports.dependencies();
    return dependencies.withWorkspaceLifecycle(() => this.ports.runConversation(context.chatId, async () => {
      current();
      const existing = dependencies.ledger.remote.lookup(context);
      if (!existing?.accepted) current();
      const submission = existing?.submission ?? await build();
      if (!existing?.accepted) dependencies.chats.assertOrdinaryTurnAllowed(context.chatId);
      return this.ports.admit(submission, context, current);
    }));
  }
}
export function remoteUserMessage<T extends Pick<UserChatMessage, "id" | "role" | "content" | "createdAt">>(message: T, context?: RemoteContext): T {
  return context ? { ...message, remoteCommandId: context.origin.commandId,
    remoteSource: { deviceId: context.origin.sourceDeviceId, name: context.origin.sourceDeviceName } } : message;
}
export function tagRemotePrepared(prepared: PreparedManualTurn, context?: RemoteContext): PreparedManualTurn {
  if (!context) return prepared;
  if (prepared.persistence.kind !== "append") throw new Error("REMOTE_SUBMISSION_IDENTITY_CHANGED");
  const { contentHash: _hash, ...body } = prepared;
  const value = { ...body, remoteContext: context, persistence: { ...prepared.persistence,
    input: { ...prepared.persistence.input, message: remoteUserMessage(prepared.persistence.input.message, context) } } };
  return { ...value, contentHash: canonicalHash(value) };
}
