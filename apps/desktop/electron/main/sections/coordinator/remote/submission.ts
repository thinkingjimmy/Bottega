/**
 * [INPUT]: Depends on the original coordinator lifecycle/conversation gates and frozen remote ledger custody.
 * [OUTPUT]: Admits trusted remote submissions (behind the same save-as-app transition fence as a local send) and adds canonical user provenance after public validation.
 * [POS]: Main-only adapter into ordinary manual admission; it never dispatches an Agent directly.
 */
import type { ManualTurnReceipt, TrustedManualTurnSubmission } from "../../../../../shared/ipc/content/sections-ipc";
import type { UserChatMessage } from "../../../../../shared/ipc/content/chats-ipc";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import type { PreparedManualTurn } from "../admission/prepared-manual-turn";
import { canonicalHash } from "../coordinator-values";
import { remoteContextSchema, type RemoteContext } from "./model";
type Ports = { dependencies(): CoordinatorDependencies;
  runConversation<T>(chatId: string, run: () => Promise<T>): Promise<T>;
  admit(submission: TrustedManualTurnSubmission, context: RemoteContext, current: () => void): Promise<ManualTurnReceipt>;
  /** The save-as-app fence a local send meets (U06-b): a Chat becoming an App takes no new remote turn either. */
  transitioning(chatId: string): Promise<boolean> };
export class RemoteAdmission {
  constructor(private readonly ports: Ports) {}
  submit(input: RemoteContext, build: () => Promise<TrustedManualTurnSubmission>, current: () => void = () => {}) {
    const context = remoteContextSchema.parse(input), dependencies = this.ports.dependencies();
    return dependencies.withWorkspaceLifecycle(() => this.ports.runConversation(context.chatId, async () => {
      current();
      const existing = dependencies.ledger.remote.lookup(context);
      if (!existing?.accepted) current();
      const submission = existing?.submission ?? await build();
      if (!existing?.accepted) {
        dependencies.chats.assertOrdinaryTurnAllowed(context.chatId);
        if (await this.ports.transitioning(context.chatId)) throw new Error("app-transitioning");
      }
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
  const { contentHash: _hash, ...body } = prepared, persistence = prepared.persistence;
  // The ledger admitted create-app only for a first message's own Edit Chat (§8.4.3); here it is only tagged with its origin.
  const tagged = persistence.kind === "append" ? { ...persistence, input: { ...persistence.input, message: remoteUserMessage(persistence.input.message, context) } }
    : persistence.kind === "create-app" && persistence.input.id === context.chatId && persistence.input.appRole === "edit"
      ? { ...persistence, input: { ...persistence.input, firstMessage: remoteUserMessage(persistence.input.firstMessage, context) } } : null;
  if (!tagged) throw new Error("REMOTE_SUBMISSION_IDENTITY_CHANGED");
  const value = { ...body, remoteContext: context, persistence: tagged };
  return { ...value, contentHash: canonicalHash(value) };
}
