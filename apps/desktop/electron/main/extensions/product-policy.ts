/**
 * [INPUT]: Depends on shared AgentBackendId and the shape of the probe/policy of the capability-snapshot
 * [OUTPUT]: Provides EXTENSION_PRODUCT_POLICY and backendExtensionProbe; manual Skill snapshots are enabled for all four backends while unverified server/projection channels remain closed
 * [POS]: The product policy of extensions is constantly being scaled up; P2/P3 gate unlocked before it was delivered as a hard-top for eligibility
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  ExtensionBackendProbe,
  ExtensionProductPolicy,
} from "./capability-snapshot";

/* remote 受 P2 gate、stdio 受 P3 gate、fixed projection 缺 workspace
   所有权/同意机制，三者继续关闭。OpenCode 的原生配置枚举仍封禁，但产品
   manual-snapshot 走本轮只读物化，不加载其配置，因此与其他三后端同口径。 */
export const EXTENSION_PRODUCT_POLICY: ExtensionProductPolicy = {
  revision: "m1-manual-stdio-p2-p3-closed",
  allowFixedWorkspaceProjection: false,
  allowRemoteMcp: false,
  allowStdioMcp: false,
  openCodeExternalSkills: true,
};

/* remote 的声明能力已由 M2 零 prompt probe 绑定版本；但逐跳 egress 执法仍无
   evidence digest，故 enforcement 恒 unverified，产品 policy 也继续 false。 */
export function backendExtensionProbe(
  backendId: AgentBackendId,
  backendRuntimeIdentity: string,
  runtimeVersion: string
): ExtensionBackendProbe {
  return {
    backendId,
    backendRuntimeIdentity,
    runtimeVersion,
    manualSkillSnapshot: true,
    fixedWorkspaceProjection: false,
    remoteMcp: {
      streamableHttp: true,
      sse: backendId !== "codex",
      enforcement: { status: "unverified" },
    },
    stdioMcp: { inclusion: false, writableRootFence: false, processCustody: false },
    multiInstanceIsolation: false,
  };
}
