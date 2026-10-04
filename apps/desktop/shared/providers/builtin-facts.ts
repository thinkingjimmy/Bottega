/**
 * [INPUT]: Depends on the Provider contract's descriptor type
 * [OUTPUT]: Provides BUILTIN_PROVIDER_FACTS: each built-in CLI's instructions file, skills root, plugin mode and plan-decision fact (the optional descriptor v1 fields)
 * [POS]: The four built-ins' CLI facts, kept out of builtin.ts so the tool schemas' capability lookup (which the provider bridge bundles) never carries them; catalog.ts joins them onto each descriptor
 */
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";

type Facts = Pick<ProviderDescriptor, "instructions" | "skills" | "plugins" | "planDecision">;
/* Paths resolve as: the first set env override (trimmed, joined with its segments), else `home` under the user's home. */
const home = (...path: string[]) => ({ env: [], home: path });

export const BUILTIN_PROVIDER_FACTS: Readonly<Record<string, Facts>> = Object.freeze({
  codex: {
    instructions: { file: "AGENTS.md", directory: { env: [{ name: "CODEX_HOME", join: [] }], home: [".codex"] } },
    skills: { root: { env: [{ name: "CODEX_HOME", join: ["skills"] }], home: [".codex", "skills"] }, readsSharedRoot: true },
    plugins: { mode: "managed" }, planDecision: "native" },
  claude: {
    /* The child's environment never passes CLAUDE_CONFIG_DIR, so the CLI reads the real home: no env override. */
    instructions: { file: "CLAUDE.md", directory: home(".claude") },
    skills: { root: home(".claude", "skills"), readsSharedRoot: false },
    plugins: { mode: "managed" }, planDecision: "native" },
  kimi: {
    instructions: { file: "AGENTS.md", directory: { env: [{ name: "KIMI_CODE_HOME", join: [] }], home: [".kimi-code"] } },
    skills: { root: { env: [{ name: "KIMI_CODE_HOME", join: ["skills"] }], home: [".kimi-code", "skills"] }, readsSharedRoot: true },
    plugins: { mode: "read-only" }, planDecision: "native" },
  opencode: {
    instructions: { file: "AGENTS.md",
      directory: { env: [{ name: "OPENCODE_CONFIG_DIR", join: [] }, { name: "XDG_CONFIG_HOME", join: ["opencode"] }], home: [".config", "opencode"] } },
    /* OpenCode scans skills in every config directory: this global one always, plus OPENCODE_CONFIG_DIR when set (opencode 1.18.23,
       ConfigPaths.directories). The declared root is the one it always reads, so OPENCODE_CONFIG_DIR is not part of it. */
    skills: { root: { env: [{ name: "XDG_CONFIG_HOME", join: ["opencode", "skills"] }], home: [".config", "opencode", "skills"] }, readsSharedRoot: true },
    /* OpenCode plugins run arbitrary code outside the product fence. Its ACP path never reaches plan_exit (the upstream effect
       table has not ported it, and the host denies it anyway because it owns the Plan state), so the host synthesizes the plan
       decision at commit, where the next turn's decision chain is complete. */
    plugins: { mode: "blocked" }, planDecision: "synthesized" },
});
