/**
 * [INPUT]: Frozen first-message choice, scoped platform ports and retained creation custody.
 * [OUTPUT]: Exactly one creation and first send, recovering original encrypted bytes after uncertain results; never creates while a draft file is not sendable (`firstMessageFileReady`);
 *           a creation naming an App goes to reservation.ts (U06 Q7-d), and every path answers a CreationOutcome.
 * [POS]: Shared creation transaction for native and browser composers; selection never creates a Chat.
 */
import type { ChatPlatform } from "../../contracts";
import type { ComposerDraft, DraftFile, RemoteDraftStore } from "../input/draft";
import { sendFirstMessage, FirstMessageFailure, rejectionReason } from "./first-message";
import { createReservedEditChat } from "./reservation";
import type { RemoteCreated } from "../contracts";
export type CreationAttempt = NonNullable<ComposerDraft["creation"]>;
/** Where the page goes: the created Chat, or (U06 Q7-d) the App's existing Edit Chat, which the draft follows unsent (`sent: false`). */
export type CreationOutcome = { receipt: RemoteCreated; chatId: string; incarnationId: string; sent: boolean };
/** Files a first message can carry: queued or uploaded, or on a retry (which uploads again) a failed upload. Processing, rejected, reselect and uploading ones never start a creation. */
export const firstMessageFileReady = (file: DraftFile, retry: boolean) => file.state === "queued" || file.state === "ready" || retry && file.state === "failed";
export async function createAndSend(platform: Pick<ChatPlatform, "account" | "chats" | "commands" | "execution">, store: RemoteDraftStore,
  original: CreationAttempt, signal: AbortSignal, confirm: Parameters<typeof sendFirstMessage>[4]): Promise<CreationOutcome> {
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
  if (original.input.target) return createReservedEditChat(platform, store, original, signal, confirm, current);
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
  return { receipt, chatId: receipt.chatId, incarnationId: receipt.incarnationId, sent: true };
}
