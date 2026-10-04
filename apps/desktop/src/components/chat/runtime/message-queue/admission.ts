/**
 * [INPUT]: Depends on shared AdmissionResult, message queue state machine, renderer locale/catalog runtime, and structured admission error projection
 * [OUTPUT]: Provides manual admission receipts, retaining App-disabled claims without pausing the queue
 * [POS]: the access state boundary of the runtime/message-queue; Only calculate queue migration, no store reading or IPC execution
 */

import type { AdmissionResult } from "../../../../../shared/ipc/content/sections-ipc";
import { admissionReasonText } from "@/lib/skills/skill-failure-text";
import { effectiveLocale } from "@/lib/appearance/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";
import {
  markAmbiguous,
  resetIdentity,
  setQueueError,
  settleItem,
  type MessageQueue,
} from "@/lib/chat/session/message-queue-model";

export function settleAdmission(
  queue: MessageQueue,
  id: string,
  owner: string,
  result: AdmissionResult
) {
  if (result.kind === "ambiguous") {
    return setQueueError(markAmbiguous(queue, id), result.cause);
  }
  if (result.kind === "rejectedBeforeAdmission") {
    // An App close can race a renderer claim. Hold the item without turning its automatic hold into a user pause.
    if (result.failure?.code === "app-disabled") return resetIdentity(queue, id);
    // Structured failures use the localized catalog.
    return setQueueError(resetIdentity(queue, id), admissionReasonText(result));
  }
  if (result.receipt.phase !== "failed") return settleItem(queue, id, owner);
  return result.receipt.userPersisted
    ? settleItem(queue, id, owner)
    : setQueueError(
        resetIdentity(queue, id),
        translate(effectiveLocale(), "chat.runtime.queue.notPersisted")
      );
}
