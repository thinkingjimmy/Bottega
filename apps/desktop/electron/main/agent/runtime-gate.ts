/**
 * [INPUT]: Depends on shared/product-failure ProductFailureError/agentRuntimeFailure/diagnosticFailureDetails and the registry BackendRuntimeSnapshot shape
 * [OUTPUT]: Provides assertInstalledRuntime and runtimeUnavailableFailure, the single pre-launch gate that turns a non-installed snapshot into a structured runtime-unavailable ProductFailureError
 * [POS]: agent/ pre-launch admission helper shared by startAgentPayload and spawnAgent; Coordinator IPC forwards only ProductFailureError as a coded rejection, so this gate never throws a bare Error
 */

import {
  ProductFailureError,
  agentRuntimeFailure,
  diagnosticFailureDetails,
} from "../../../shared/product-failure";
import type { BackendRuntimeSnapshot } from "../backends/runtime-registry";

/* PresentSnapshot 的 runtimeStatus 是 "unsupported" | "installed" 联合，Extract 会得到
   never；交叉类型才把它窄成可读 runtime/capabilities 的 installed 快照。 */
type InstalledSnapshot = BackendRuntimeSnapshot & { runtimeStatus: "installed" };

export function runtimeUnavailableFailure(displayName: string, reason?: string) {
  return new ProductFailureError(
    agentRuntimeFailure(
      "runtime-unavailable",
      diagnosticFailureDetails(
        reason
          ? `${displayName}：${reason}`
          : `未检测到 ${displayName} CLI，请前往 Settings 安装或登录`
      )
    )
  );
}

/* 两道门（resolve 后的早门、resolveForSpawn 后的晚门）共用一个断言：
   非 installed 快照带着 registry 的原文 reason 抛结构化失败，renderer 才能
   把 managed policy 拒绝、版本过低、未安装分别翻成人话。 */
export function assertInstalledRuntime(
  snapshot: BackendRuntimeSnapshot,
  displayName: string
): asserts snapshot is InstalledSnapshot {
  if (snapshot.runtimeStatus !== "installed") {
    throw runtimeUnavailableFailure(displayName, snapshot.reason);
  }
}
