/**
 * [INPUT]: A main-owned canonical independent candidate root and CLI-generated native policy types.
 * [OUTPUT]: candidateNativePolicy freezes one writable root, fresh ephemeral input and disabled ambient tools.
 * [POS]: Candidate-only policy builder; ordinary Chat permission settings never enter this contract.
 */
import { isAbsolute, normalize } from "node:path";
import { tmpdir } from "node:os";
import type { NativeTurnConfig } from "./parameters";

export function candidateNativePolicy(root: string) {
  if (!isAbsolute(root) || normalize(root) !== root || ["/", "/tmp", "/private/tmp", "/var/tmp", tmpdir().replace(/\/$/, "")].includes(root))
    throw new Error("Candidate execution requires an independent canonical directory");
  const policy = {
    sandbox: "workspace-write" as const, approvalPolicy: "never" as const, approvalsReviewer: "user" as const,
    sandboxPolicy: { type: "workspaceWrite" as const, writableRoots: [root], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true },
  };
  const config = {
    "sandbox_workspace_write.writable_roots": [root],
    "sandbox_workspace_write.network_access": false,
    "sandbox_workspace_write.exclude_tmpdir_env_var": true,
    "sandbox_workspace_write.exclude_slash_tmp": true,
    "features.multi_agent": false, "features.memories": false, "features.apps": false, "features.plugins": false,
    "features.remote_plugin": false, "features.remote_control": false, "features.tool_suggest": false, "features.js_repl": false,
    "features.shell_tool": true, "features.unified_exec": true, "features.shell_snapshot": false,
    "features.hooks": false, "features.browser_use": false, "features.browser_use_external": false,
    "features.computer_use": false, "features.in_app_browser": false, "features.image_generation": false,
    "features.workspace_dependencies": false, "features.in_app_local_automation": false, "features.goals": false,
    "features.skill_mcp_dependency_install": false,
    "shell_environment_policy.inherit": "none",
    "memories.generate_memories": false, "memories.use_memories": false,
    "agents.max_concurrent_threads_per_session": 1,
    web_search: "disabled", mcp_servers: {},
  };
  const thread = { ephemeral: true, runtimeWorkspaceRoots: [root], dynamicTools: [], selectedCapabilityRoots: [], environments: [{ environmentId: "local", cwd: root, runtimeWorkspaceRoots: [root] }] } satisfies Partial<NativeTurnConfig["thread"]>;
  const launchOverrides = Object.entries(config).map(([key, value]) => `${key}=${key === "mcp_servers" ? "{}" : JSON.stringify(value)}`);
  return { policy, config, thread, launchOverrides };
}
