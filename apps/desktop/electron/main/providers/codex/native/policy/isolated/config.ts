/**
 * [INPUT]: Receives main-only native title admission; no user command-tool preferences enter this policy.
 * [OUTPUT]: Provides nativeTitleConfig with command tools, ambient integrations, memory, hooks and background capabilities disabled.
 * [POS]: Title-only native policy leaf consumed by the dedicated title plan.
 */
export function nativeTitleConfig() {
  return {
    "features.multi_agent": false, "features.memories": false, "features.apps": false, "features.plugins": false,
    "features.remote_plugin": false, "features.remote_control": false, "features.tool_suggest": false, "features.js_repl": false,
    "features.shell_tool": false, "features.unified_exec": false, "features.shell_snapshot": false,
    "features.hooks": false, "features.browser_use": false, "features.browser_use_external": false,
    "features.computer_use": false, "features.in_app_browser": false, "features.image_generation": false,
    "features.workspace_dependencies": false, "features.in_app_local_automation": false, "features.goals": false,
    "features.skill_mcp_dependency_install": false,
    "shell_environment_policy.inherit": "none",
    "memories.generate_memories": false, "memories.use_memories": false,
    "agents.max_concurrent_threads_per_session": 1,
    web_search: "disabled", mcp_servers: {},
  };
}
