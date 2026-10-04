/**
 * [INPUT]: Depends on shared AgentBackendId, the provider catalog (the mcp-sse capability) and the shape of the probe/policy of the capability-snapshot
 * [OUTPUT]: Provides EXTENSION_PRODUCT_POLICY, backendExtensionProbe and hostPackageSwitchable (only a global host package is a person's to switch); manual Skill snapshots are enabled for all four backends while unverified server/projection channels remain closed
 * [POS]: Extensions' product policy rolls out incrementally; the P2 (remote) and P3 (stdio) gates stay closed until explicitly unlocked, acting as a hard ceiling on eligibility until then
 */

import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import type { ProductResourceScope } from "../../../shared/product/product-resource-scope";
import { builtinProviderCatalog } from "../../../shared/providers/catalog";

/* The CLI's remote MCP client speaks SSE unless its descriptor rules it out (Codex speaks streamable HTTP only). */
const supportsSse = (backendId: string) => {
  const lookup = builtinProviderCatalog.get(backendId);
  return lookup.known && lookup.entry.descriptor.capabilities["mcp-sse"] === "declared";
};

/**
 * D-04 (U01): a person may turn an installed host package off only where it can be turned back on. Plugins & Apps re-enables a
 * global package; a Project's package would be off for good, so neither Plugins & Apps nor the legacy Extensions page switches it.
 */
export function hostPackageSwitchable(scope: ProductResourceScope) { return scope.kind === "global"; }
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
      sse: supportsSse(backendId),
      enforcement: { status: "unverified" },
    },
    stdioMcp: { inclusion: false, writableRootFence: false, processCustody: false },
    multiInstanceIsolation: false,
  };
}
