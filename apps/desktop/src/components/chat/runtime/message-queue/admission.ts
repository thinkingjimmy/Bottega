/**
 * [INPUT]: Depends on shared AdmissionResult, message queue state machine, renderer locale/catalog runtime, and structured admission error projection
 * [OUTPUT]: Provides manual admission receipt
 * [POS]: the access state boundary of the runtime/message-queue; Only calculate queue migration, no store reading or IPC execution
 */

import type { AdmissionResult } from "../../../../../shared/sections-ipc";
import { admissionReasonText } from "@/lib/skill-failure-text";
import { effectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";
import {
  markAmbiguous,
  resetIdentity,
  setQueueError,
  settleItem,
  type MessageQueue,
} from "@/lib/message-queue-model";

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
    // 结构化失败走五语目录；其余仍是 main 的 `CODE: 人话` 断言，剥掉日志半段
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
