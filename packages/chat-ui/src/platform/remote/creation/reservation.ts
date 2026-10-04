/**
 * [INPUT]: The shared first-message continuation, the remote execution port's creation, lookup and watch of a creation receipt, and the
 *          caller's account/page fence.
 * [OUTPUT]: Provides createReservedEditChat, U06 Q7-d's App Edit creation: the first message leaves without a head, and the transaction ends
 *           only on the reservation's sealed word (its own Chat materialised, another Edit Chat filled it, or a named refusal) or after one
 *           fresh reservation replaces an expired one.
 * [POS]: Sibling of submit.ts, which hands it every creation that names an App; first-message.ts sends the message itself.
 */
import type { ChatPlatform } from "../../contracts";
import type { RemoteCreated, RemoteCreateInput } from "../contracts";
import type { RemoteDraftStore } from "../input/draft";
import { FirstMessageFailure, rejectionReason, sendFirstMessage } from "./first-message";
import type { CreationAttempt, CreationOutcome } from "./submit";

type Platform = Pick<ChatPlatform, "account" | "chats" | "commands" | "execution">;
type Port = NonNullable<ChatPlatform["execution"]["remote"]>;
const settledStates = new Set(["filled", "refused", "expired"]);

const isSettled = (value: RemoteCreated | null, receipt: RemoteCreated): value is RemoteCreated =>
  value?.createOperationId === receipt.createOperationId && Boolean(value.reservation && settledStates.has(value.reservation.state));
/**
 * The receipt once the reservation is settled or expired; the watch ends with the page or the account. Expiry is read, never written, so
 * no data change announces it: at the reservation's deadline the receipt is looked up again.
 */
function settled(port: Port, receipt: RemoteCreated, signal: AbortSignal) {
  if (!port.watchCreated) throw new FirstMessageFailure("remote-disabled");
  return new Promise<RemoteCreated>((resolve, reject) => {
    let stop: (() => void) | null = null, done = false, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (settle: () => void) => { if (done) return; done = true; clearTimeout(timer); stop?.(); signal.removeEventListener("abort", abort); settle(); };
    const abort = () => finish(() => reject(new FirstMessageFailure("identity-changed")));
    const accept = (value: RemoteCreated | null) => { if (isSettled(value, receipt)) finish(() => resolve(value)); };
    const deadline = (delay: number) => { timer = setTimeout(() => void port.created(receipt.createOperationId)
      .then(value => { accept(value); if (!done) deadline(DEADLINE_RECHECK_MS); }, error => finish(() => reject(error))), Math.max(0, delay)); };
    signal.addEventListener("abort", abort, { once: true });
    stop = port.watchCreated!(receipt.createOperationId, accept, error => finish(() => reject(error)));
    if (done) stop();
    if (signal.aborted) abort();
    if (!done) deadline(receipt.reservation!.reservedUntil - Date.now() + DEADLINE_RECHECK_MS);
  });
}
/** Past the deadline the server answers `expired`; this margin covers the two clocks disagreeing. */
const DEADLINE_RECHECK_MS = 5_000;

export async function createReservedEditChat(platform: Platform, store: RemoteDraftStore, original: CreationAttempt, signal: AbortSignal,
  confirm: Parameters<typeof sendFirstMessage>[4], current: () => void): Promise<CreationOutcome> {
  const port = platform.execution.remote!;
  // §8.2: the computer materialises a text-only first message; anything else would be refused only after the reservation is taken.
  if (original.references?.length || store.snapshot().references.length || store.snapshot().files.length) throw new FirstMessageFailure("input-unsupported", true);
  let attempt = original;
  for (let fresh = 0; ; fresh++) {
    let receipt = await reservation(port, store, attempt, current);
    if (receipt.reservation!.state === "reserved" || receipt.reservation!.state === "admitting") {
      let taken = true;
      try {
        await sendFirstMessage(platform, receipt, { creation: attempt.input, text: attempt.text, commandId: attempt.commandId, draftStore: store,
          permissionMode: attempt.permissionMode, planMode: attempt.planMode, options: attempt.options }, signal, confirm);
      } catch (error) {
        /* A reservation filled or expired before this message was taken refuses it at admission, which the command session can only record
           as unknown: the reservation's own word decides, and a reservation still open keeps the failure as it is. */
        if (!(error instanceof FirstMessageFailure) || error.reason === "identity-changed") throw error;
        const word = await port.created(receipt.createOperationId); current();
        if (!isSettled(word, receipt)) throw error;
        receipt = word; taken = false;
      }
      current();
      if (taken) { receipt = await settled(port, receipt, signal); current(); }
    }
    const word = receipt.reservation!;
    // Filled: the attempt stays with the caller, who hands its text on unsent when the App's Edit Chat is another one.
    if (word.state === "filled" && word.settlement?.outcome === "filled") {
      const own = word.settlement.chatId === receipt.chatId && word.settlement.incarnationId === receipt.incarnationId;
      return { receipt, chatId: word.settlement.chatId, incarnationId: word.settlement.incarnationId, sent: own };
    }
    // A refused or expired reservation takes nothing more: its text goes back to the draft, and any next attempt is a fresh creation.
    store.handoffCreation(false);
    if (word.state === "refused" && word.settlement?.outcome === "refused") throw new FirstMessageFailure("chat-not-executable", false, word.settlement.code);
    if (word.state !== "expired" || fresh > 0) throw new FirstMessageFailure(word.state === "expired" ? "reservation-expired" : "outcome-unknown");
    // §7.7 Q-U9: an expired reservation is created again exactly once, as a new creation carrying the same text.
    attempt = { ...attempt, input: { ...attempt.input, createOperationId: crypto.randomUUID() }, commandId: crypto.randomUUID(), frozen: undefined, receipt: undefined };
    store.update({ creation: attempt });
  }
}

/** The attempt's reservation: looked up first (an uncertain create is never repeated), else created from its frozen bytes. */
async function reservation(port: Port, store: RemoteDraftStore, attempt: CreationAttempt, current: () => void) {
  const input: RemoteCreateInput = attempt.input;
  const prior = attempt.receipt ?? await port.created(input.createOperationId); current();
  let frozen = attempt.frozen;
  if (!prior && !frozen) { frozen = await port.prepareCreate(input); current(); store.update({ creation: { ...attempt, frozen } }); }
  const receipt = prior ?? await port.create(input, frozen!); current();
  if ("rejected" in receipt) { store.update({ creation: null }); throw new FirstMessageFailure(rejectionReason(receipt.rejected)); }
  if (receipt.createOperationId !== input.createOperationId || receipt.ownerDeviceId !== input.targetDeviceId || receipt.deleted ||
    !receipt.reservation || receipt.target?.appId !== input.target?.appId) throw new Error("REMOTE_CREATE_IDENTITY");
  store.update({ creation: { ...attempt, frozen, receipt } });
  return receipt;
}
