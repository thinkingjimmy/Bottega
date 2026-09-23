/**
 * [INPUT]: Frozen first-message choice, scoped platform ports and retained creation custody.
 * [OUTPUT]: Exactly one creation and first send, recovering original encrypted bytes after uncertain results; never creates while a draft file is not sendable (`firstMessageFileReady`).
 * [POS]: Shared creation transaction for native and browser composers; selection never creates a Chat.
 */
import type { ChatPlatform } from "../../contracts";
import type { ComposerDraft, DraftFile, RemoteDraftStore } from "../input/draft";
import { sendFirstMessage, FirstMessageFailure, rejectionReason } from "./first-message";
export type CreationAttempt = NonNullable<ComposerDraft["creation"]>;
/** Files a first message can carry: queued or uploaded, or on a retry (which uploads again) a failed upload. Processing, rejected, reselect and uploading ones never start a creation. */
export const firstMessageFileReady = (file: DraftFile, retry: boolean) => file.state === "queued" || file.state === "ready" || retry && file.state === "failed";
export async function createAndSend(platform: Pick<ChatPlatform, "account" | "chats" | "commands" | "execution">, store: RemoteDraftStore,
  original: CreationAttempt, signal: AbortSignal, confirm: Parameters<typeof sendFirstMessage>[4]) {
  const port = platform.execution.remote;
  if (!port) throw new FirstMessageFailure("remote-disabled");
  const owner = platform.account.snapshot();
  const current = () => {
    signal.throwIfAborted(); platform.commands.remote?.lifetime?.throwIfAborted();
    const now = platform.account.snapshot();
    if (now.state !== "ready" || now.profile?.userId !== owner.profile?.userId || now.deviceId !== owner.deviceId) throw new FirstMessageFailure("identity-changed");
  };
  current();
  if (store.snapshot().files.some(file => !firstMessageFileReady(file, true))) throw new FirstMessageFailure("attachment-invalid", true);
  const input = original.input;
  let frozen = original.frozen;
  const prior = original.receipt ?? await port.created(input.createOperationId); current();
  if (!prior && !frozen) { frozen = await port.prepareCreate(input); current(); store.update({ creation: { ...original, frozen } }); }
  const receipt = prior ?? await port.create(input, frozen!); current();
  if ("rejected" in receipt) { store.update({ creation: null }); throw new FirstMessageFailure(rejectionReason(receipt.rejected)); }
  if (receipt.createOperationId !== input.createOperationId || receipt.ownerDeviceId !== input.targetDeviceId || receipt.deleted) throw new Error("REMOTE_CREATE_IDENTITY");
  store.update({ creation: { ...original, frozen, receipt } });
  const submitted = await sendFirstMessage(platform, receipt, { creation: input, text: original.text, commandId: original.commandId, draftStore: store,
    permissionMode: original.permissionMode, planMode: original.planMode, references: original.references, options: original.options }, signal, confirm);
  current();
  if (submitted?.admission) store.accepted(original.text, submitted.command.payload.kind === "start-turn" ? submitted.command.payload.attachments : [], original.references);
  return receipt;
}
