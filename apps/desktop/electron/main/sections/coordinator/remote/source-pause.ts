/**
 * [INPUT]: Durable ledger state and the authenticated remote source scope.
 * [OUTPUT]: Reads and changes a pause for one chat incarnation and source device.
 * [POS]: Source gates shared by queue custody, failure settlement and dispatch.
 */
import type { LedgerState, ManualTurnIntent } from "../state/ledger-schema";
import type { DeepReadonly } from "../state/readonly-ledger";
import type { RemoteContext } from "./model";

export function sourceQueuePaused(state: DeepReadonly<LedgerState>, intent: DeepReadonly<ManualTurnIntent>) {
  const context = intent.remoteSubmission?.context ?? intent.queueSource;
  return Boolean(context && state.remoteQueuePauses.some(pause => pause.chatId === context.chatId &&
    pause.incarnationId === context.incarnationId && pause.sourceDeviceId === context.origin.sourceDeviceId));
}
export function setSourceQueuePaused(state: LedgerState, context: RemoteContext, paused: boolean) {
  state.remoteQueuePauses = state.remoteQueuePauses.filter(value => value.chatId !== context.chatId ||
    value.incarnationId !== context.incarnationId || value.sourceDeviceId !== context.origin.sourceDeviceId);
  if (paused) state.remoteQueuePauses.push({ chatId: context.chatId, incarnationId: context.incarnationId, sourceDeviceId: context.origin.sourceDeviceId });
}
