/**
 * [INPUT]: Canonical built-in Provider identity, main-admitted independent candidate purpose, fixed Codex runtime and live original-owner authority.
 * [OUTPUT]: nativeCandidateTurnPlan seals a fresh ephemeral native thread and candidate-only filesystem policy.
 * [POS]: Isolated branch of the existing native launch plan; ordinary Chat grants and continuation are refused.
 */
import { BUILTIN_PROVIDER_IDS } from "@bottega/contracts/model/provider-capabilities";
import { lstat, realpath } from "node:fs/promises";
import type { BackendTurnOptions } from "../../../../backends/contracts/types";
import { SUPPORTED_CODEX_VERSION } from "../../version";
import { candidateNativePolicy } from "./candidate";
import { nativeCodexLaunch } from "./spawn";
import type { NativeSpawnConfig } from "./launch";
import type { CodexTurnOptions } from "../../../../../../shared/ipc/agent/codex-ipc";
export async function nativeCandidateTurnPlan(options: BackendTurnOptions): Promise<NativeSpawnConfig> {
  const root = options.artifactCandidate?.root, turn = options.payload.turnOptions as CodexTurnOptions;
  if (!root || root !== options.workspace || turn.backend !== BUILTIN_PROVIDER_IDS.codex || !options.trustedAuthority ||
    options.runtime.version.replace(/^codex-cli\s+/, "") !== SUPPORTED_CODEX_VERSION ||
    options.payload.session || options.sessionRecovery || options.artifactDirectory || options.builtinMcp ||
    options.thirdPartyMcpPlan?.entries.length || options.processEnv || options.productContext || options.sensitiveContribution ||
    options.filesystemAccess?.workspace !== root || options.filesystemAccess.mode !== "workspace-write" ||
    options.filesystemAccess.network !== "off" || options.filesystemAccess.readOnlyRoots.length)
    throw new Error("Candidate native execution requires its original isolated main-owned authority");
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new Error("Candidate root is not a canonical directory");
  await options.trustedAuthority.validate(); options.trustedAuthority.current();
  const { policy, config, thread, launchOverrides } = candidateNativePolicy(root);
  const launch = nativeCodexLaunch(options.runtime, root);
  return { protocol: "codex-app-server", launch: { ...launch, args: [...launchOverrides.flatMap(value => ["-c", value]), ...launch.args] },
    nativeConfig: { contractId: "bb-native-v1", purpose: "artifact-candidate",
      thread: { ...thread, cwd: root, model: turn.model, allowProviderModelFallback: false, serviceTier: turn.serviceTier === "default" ? null : turn.serviceTier,
        sandbox: policy.sandbox, approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, config },
      turn: { cwd: root, model: turn.model, effort: turn.reasoningEffort, serviceTier: turn.serviceTier === "default" ? null : turn.serviceTier,
        runtimeWorkspaceRoots: [root], environments: thread.environments, approvalPolicy: policy.approvalPolicy, approvalsReviewer: policy.approvalsReviewer, sandboxPolicy: policy.sandboxPolicy } } };
}
