/**
 * [INPUT]: Depends on rebuild controller Restore failure facts at the output band stage
 * [OUTPUT]: Provides providerRecoveryFailure to reconcile with non-loss phase/detail Settings
 * [POS]: The main/memory/service/support recovery error projector; Façade uncopped unknown error
 */

import type { MemoryRebuildRecoveryFailure } from "../../orchestration/rebuild-controller";
import { errorMessage } from "../../../errors";

export function providerRecoveryFailure(
  operationId: string,
  cause: unknown
): MemoryRebuildRecoveryFailure {
  return {
    operationId,
    failureKind: "provider",
    phase: "provider",
    detail: errorMessage(cause).slice(0, 2_000),
  };
}

export function rebuildRecoveryMessage(failure: MemoryRebuildRecoveryFailure) {
  const phase = failure.phase === "policy" ? "Policy 授权" : "Provider 清理/回灌";
  return `Memory 重建恢复失败（${phase}）：${failure.detail}`;
}
