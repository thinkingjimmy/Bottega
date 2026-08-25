/**
 * [INPUT]: Depends on shared AgentBackendId and the shape of the probe/policy of the capability-snapshot
 * [OUTPUT]: Provides EXTENSION_PRODUCT_POLICY with the backendExtensionProbe; The unverified passage is false
 * [POS]: The product policy of extensions is constantly being scaled up; P2/P3 gate unlocked before it was delivered as a hard-top for eligibility
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  ExtensionBackendProbe,
  ExtensionProductPolicy,
} from "./capability-snapshot";

/* `08-09-agent-extensions.md` §4：remote 受 P2 gate、stdio 受 P3 gate、fixed
   projection 缺 workspace 所有权/同意机制、OpenCode 外部 skill 被现行政策封死。
   四条都还没闭合，所以这里全是 false——政策收紧只会少交付，永不多交付。 */
export const EXTENSION_PRODUCT_POLICY: ExtensionProductPolicy = {
  revision: "m1-manual-stdio-p2-p3-closed",
  allowFixedWorkspaceProjection: false,
  allowRemoteMcp: false,
  allowStdioMcp: false,
  openCodeExternalSkills: false,
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
