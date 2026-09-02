/**
 * [INPUT]: Depends on shared Steer receipt/outbox Projection, RichValue, message queue pure state machine, and renderer locale/catalog runtime
 * [OUTPUT]: Provides Steer attach Deposit, derived manual custody, migration, receipt, collection, local assembly, back and transfer divergent migration
 * [POS]: Steer state boundary of runtime/message-queue; The journal distinguishes between previous local failure and uncertainty after trying IPC
 */

import type { RichValue } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type {
  SteerIpcReceipt,
  SteerOutboxProjection,
} from "../../../../../shared/agent-ipc";
import {
  createQueueItem,
  enqueue,
  markAmbiguous,
  markManualCustody,
  markWorkspaceInvalidated,
  queuedBytes,
  queuedPrompt,
  resetIdentity,
  setQueueError,
  settleItem,
  unclaimSteer,
  type MessageQueue,
  type QueuedPrompt,
} from "@/lib/message-queue-model";
import { errorMessage } from "@/lib/errors";
import { effectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";

function recoveredPrompt(intent: SteerOutboxProjection): QueuedPrompt | null {
  const recovery = intent.recovery;
  if (!recovery) return null;
  const richValue: RichValue = recovery.input.flatMap<RichValue[number]>((item) => {
    const id = crypto.randomUUID();
    if (item.type === "text") {
      return item.text
        ? [{ id, type: "text" as const, value: item.text }]
        : [];
    }
    if (item.type === "mention") {
      return [{
        id,
        type: "file" as const,
        ref: item.fileRef,
        name: item.name,
        mediaType: "application/octet-stream",
      }];
    }
    if (item.type === "skill") {
      return [{ id, type: "text" as const, value: `$${item.skillRef}` }];
    }
    if (item.type === "section") {
      return [{
        id,
        type: "section" as const,
        chatId: item.chatId,
        name: item.name,
        agent: "",
      }];
    }
    return [];
  });
  const payloads =
    recovery.attachmentPayloads ??
    recovery.input.flatMap((item) =>
      item.type === "image"
        ? [{
            filename: item.filename,
            mediaType:
              /^data:([^;,]+)/.exec(item.dataUrl)?.[1] ?? "image/png",
            dataUrl: item.dataUrl,
          }]
        : []
    );
  return queuedPrompt({
    input: {
      kind: "rich",
      value: richValue,
      displayText: recovery.displayText,
    },
    files: payloads.map((payload) => ({
      type: "file",
      filename: payload.filename,
      mediaType: payload.mediaType,
      url: payload.dataUrl,
    })),
  });
}

export function reconcileSteerIntents(
  initial: MessageQueue,
  intents: readonly SteerOutboxProjection[],
  globalBytes: number,
  effects: {
    notice(message: string): void;
  }
) {
  let queue = initial;
  const initialBytes = queuedBytes(initial);
  const currentGlobalBytes = () =>
    globalBytes + queuedBytes(queue) - initialBytes;
  const acknowledgements = new Set<string>();
  for (const intent of intents) {
    const item = queue.items.find(
      (candidate) => candidate.outboxRef === intent.outboxRef
    );
    if (intent.phase === "failed") {
      if (intent.recovery?.mode === "decision" && item?.state === "ambiguous") {
        queue = markWorkspaceInvalidated(queue, item.id);
        continue;
      }
      let recovered = false;
      if (item) {
        queue = setQueueError(
          resetIdentity(queue, item.id),
          intent.reason ??
            translate(effectiveLocale(), "chat.runtime.queue.steerReturned")
        );
        recovered = true;
      } else {
        const prompt = recoveredPrompt(intent);
        if (prompt) {
          const recoveredItem = createQueueItem(prompt, intent.createdAt);
          const result = enqueue(queue, recoveredItem, currentGlobalBytes());
          if (result.accepted) {
            queue =
              intent.recovery?.mode === "decision"
                ? setQueueError(
                    markWorkspaceInvalidated(
                      markAmbiguous(
                        result.queue,
                        recoveredItem.id,
                        intent.outboxRef
                      ),
                      recoveredItem.id
                    ),
                    intent.reason ??
                      translate(
                        effectiveLocale(),
                        "chat.runtime.queue.staleResourcesDecision"
                      )
                  )
                : setQueueError(
                    result.queue,
                    intent.reason ??
                      translate(
                        effectiveLocale(),
                        "chat.runtime.queue.steerReturned"
                      )
                  );
            recovered = intent.recovery?.mode === "editable";
          }
        }
      }
      if (recovered) acknowledgements.add(intent.outboxRef);
      continue;
    }
    if (intent.phase === "transferred") {
      let custodyItem = item;
      if (!custodyItem) {
        const prompt = recoveredPrompt(intent);
        if (prompt) {
          const candidate = createQueueItem(prompt, intent.createdAt);
          const result = enqueue(queue, candidate, currentGlobalBytes());
          if (result.accepted) {
            queue = markAmbiguous(
              result.queue,
              candidate.id,
              intent.outboxRef
            );
            custodyItem = candidate;
          }
        }
      }
      if (custodyItem && intent.derivedIntentId) {
        queue = markManualCustody(
          queue,
          custodyItem.id,
          intent.derivedIntentId
        );
        if (intent.recovery?.mode === "decision") {
          queue = setQueueError(
            markWorkspaceInvalidated(queue, custodyItem.id),
            translate(
              effectiveLocale(),
              "chat.runtime.queue.staleWorkspaceWait"
            )
          );
        }
      }
      continue;
    }
    if (intent.phase === "persisted" || intent.phase === "dismissed") {
      if (item) queue = settleItem(queue, item.id);
      acknowledgements.add(intent.outboxRef);
      continue;
    }
    if (
      item &&
      (intent.phase === "journaled" ||
        intent.phase === "awaitingDecision")
    ) {
      queue = markAmbiguous(queue, item.id, intent.outboxRef);
    } else if (intent.phase === "injected") {
      if (item) queue = settleItem(queue, item.id);
      if (intent.reason) effects.notice(intent.reason);
    }
  }
  return { queue, acknowledgements: [...acknowledgements] };
}

export const failLocalSteerAssembly = (
  queue: MessageQueue,
  id: string,
  owner: string,
  cause: unknown
) => {
  const unclaimed = unclaimSteer(queue, id, owner);
  const editable = unclaimed === queue ? resetIdentity(queue, id) : unclaimed;
  return setQueueError(
    editable,
    translate(effectiveLocale(), "chat.runtime.queue.steerPrepareFailed", {
      message: errorMessage(cause),
    })
  );
};

export const markSteerTransportAmbiguous = (
  queue: MessageQueue,
  id: string,
  outboxRef: string,
  cause: unknown
) =>
  setQueueError(
    markAmbiguous(queue, id, outboxRef),
    translate(effectiveLocale(), "chat.runtime.queue.steerVerifyFailed", {
      message: errorMessage(cause),
    })
  );

export function settleSteerReceipt(
  initial: MessageQueue,
  id: string,
  owner: string,
  outboxRef: string,
  result: SteerIpcReceipt
) {
  let queue = initial;
  let ack = false;
  let notice: string | undefined;
  if (result.outcome === "injected") {
    queue = settleItem(queue, id, owner);
    ack = result.persistState === "persisted";
    if (result.persistState === "pending") {
      notice = translate(
        effectiveLocale(),
        "chat.runtime.queue.steerHistoryPending"
      );
    }
  } else if (result.outcome === "unconsumed") {
    queue = markManualCustody(queue, id, result.derivedIntentId);
    notice = translate(
      effectiveLocale(),
      "chat.runtime.queue.steerQueuedNext"
    );
  } else if (result.outcome === "ambiguous") {
    queue = setQueueError(
      markAmbiguous(queue, id, outboxRef),
      translate(
        effectiveLocale(),
        "chat.runtime.queue.steerDeliveryUnknown"
      )
    );
  } else if (result.outcome === "dismissed") {
    queue = settleItem(queue, id, owner);
    ack = true;
  } else {
    queue = setQueueError(resetIdentity(queue, id), result.reason);
    ack = true;
  }
  return { queue, ack, notice };
}
