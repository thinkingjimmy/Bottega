/**
 * [INPUT]: Depends on shared AdmissionResult, message queue is a state machine and renderer error message text is a text
 * [OUTPUT]: Provides manual admission receipt
 * [POS]: the access state boundary of the runtime/message-queue; Only calculate queue migration, no store reading or IPC execution
 */

import type { AdmissionResult } from "../../../../../shared/sections-ipc";
import { errorMessage } from "@/lib/errors";
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
    // 拒因来自 main 的 `CODE: 人话` 断言，进队列面板前先剥掉给日志看的那半段
    return setQueueError(resetIdentity(queue, id), errorMessage(result.reason));
  }
  if (result.receipt.phase !== "failed") return settleItem(queue, id, owner);
  return result.receipt.userPersisted
    ? settleItem(queue, id, owner)
    : setQueueError(
        resetIdentity(queue, id),
        "消息未写入，请修正后重试"
      );
}
