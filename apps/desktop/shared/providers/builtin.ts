/**
 * [INPUT]: Depends on the Provider contract (@ai-chat/cloud-protocol/contracts/provider) and the closed AGENT_BACKEND_ORDER
 * [OUTPUT]: Provides canonical BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_DESCRIPTORS (the four built-in providers as layer-1 descriptors), builtinProviderDescriptor and assignableProviders
 * [POS]: The static half of the host Provider catalog shared by main and renderer; runtime facts in electron/main/backends are checked against it by the backend registry, and tool schemas derive their provider enums from it
 */
import { AGENT_BACKEND_ORDER } from "@ai-chat/cloud-protocol/chats/options";
/* The zod-free leaf: the provider bridge bundles this module for the tool schemas, and must not evaluate the descriptor schemas. */
import { providersDeclaring, PROVIDER_CAPABILITIES, type ProviderCapability } from "@bottega/contracts/model/provider-capabilities";
import type { ProviderDescriptor } from "@ai-chat/cloud-protocol/contracts/provider";

type BuiltinId = (typeof AGENT_BACKEND_ORDER)[number];
type Declared = Partial<Record<ProviderCapability, "declared" | "unsupported">>;
const capabilities = (declared: Declared) =>
  Object.fromEntries(PROVIDER_CAPABILITIES.map(capability => [capability, declared[capability] ?? "unsupported"])) as ProviderDescriptor["capabilities"];

/* Fields every built-in provider exposes. Home overrides are part of the process identity (process-start); MCP servers are
   handed to `session/new` (session-create); model, effort and permission mode are applied per turn. */
const configFields = [
  { id: "model", appliesAt: "next-turn", required: false },
  { id: "reasoning-effort", appliesAt: "next-turn", required: false },
  { id: "permission-mode", appliesAt: "next-turn", required: true },
  { id: "mcp-servers", appliesAt: "session-create", required: false },
  { id: "home", appliesAt: "process-start", required: false },
] as const satisfies ProviderDescriptor["configFields"];
const failureClasses = ["auth-required", "usage-limit"];
const common = { schema: "bottega.provider-descriptor/v1" as const, grammar: { min: 1, max: 1 }, configFields: [...configFields], failureClasses };
const chatCore: Declared = { resume: "declared", cancel: "declared", "plan-mode": "declared", "permission-request": "declared",
  "mcp-stdio": "declared", "mcp-sse": "declared", "image-input": "declared", "model-catalog": "declared", "history-import": "declared" };
const headless = { chat: "native", title: "native", "install-analysis": "native", repair: "native", serve: "native", subagent: "native" } as const;
/* W9's format extractor must run with no tools at all: only Claude's `--tools ""` proves that (04 §5). */
const codexHeadless = { ...headless, "format-extract": "unsupported" } as const;
const claudeHeadless = { ...headless, "format-extract": "native" } as const;

const descriptors: Record<BuiltinId, ProviderDescriptor> = {
  codex: { ...common, providerId: "codex", packageId: "bottega.provider.codex", displayName: "Codex",
    runtime: { discovery: { commands: ["codex"], versionArgs: ["--version"], minimumVersion: "0.145.0" },
      launch: { kind: "acp-stdio-adapter", layer: "bundled-node" }, env: { allow: ["CODEX_HOME"], processStart: ["CODEX_HOME"] } },
    auth: { check: "status-command", login: { local: "terminal", remote: "unsupported" }, credentialSafeProbe: false },
    sensitiveRoots: { paths: ["~/.codex"], envOverrides: ["CODEX_HOME"], keychainServices: [], retainAfterUninstall: true },
    /* Codex's remote MCP client speaks streamable HTTP only. */
    capabilities: capabilities({ ...chatCore, "mcp-sse": "unsupported", steer: "declared", "read-only": "declared", quota: "declared",
      "section-assign": "declared", "subagent-assign": "declared", "project-convert": "declared" }),
    purposes: codexHeadless },
  claude: { ...common, providerId: "claude", packageId: "bottega.provider.claude", displayName: "Claude",
    runtime: { discovery: { commands: ["claude"], versionArgs: ["--version"], minimumVersion: "2.1.216" },
      launch: { kind: "acp-stdio-adapter", layer: "bundled-node" }, env: { allow: [], processStart: [] } },
    auth: { check: "status-command", login: { local: "terminal", remote: "unsupported" }, credentialSafeProbe: false },
    sensitiveRoots: { paths: ["~/.claude"], envOverrides: [], keychainServices: [], retainAfterUninstall: true },
    capabilities: capabilities({ ...chatCore, "tool-filter": "declared", "read-only": "declared", "network-off": "declared",
      "structured-report": "declared", quota: "declared", "section-assign": "declared", "subagent-assign": "declared", "project-convert": "declared" }),
    purposes: claudeHeadless },
  kimi: { ...common, providerId: "kimi", packageId: "bottega.provider.kimi", displayName: "Kimi",
    runtime: { discovery: { commands: ["kimi"], versionArgs: ["--version"], minimumVersion: "0.29.1" },
      launch: { kind: "acp-stdio-native", layer: "native" }, env: { allow: ["KIMI_CODE_HOME"], processStart: ["KIMI_CODE_HOME"] } },
    auth: { check: "status-command", login: { local: "terminal", remote: "unsupported" }, credentialSafeProbe: true },
    sensitiveRoots: { paths: ["~/.kimi-code"], envOverrides: ["KIMI_CODE_HOME"], keychainServices: [], retainAfterUninstall: true },
    capabilities: capabilities({ ...chatCore, quota: "declared", "section-assign": "declared", "subagent-assign": "declared" }),
    /* Headless purposes were withdrawn on 2026-08-27: the CLI watches $HOME and dies inside the headless fence. */
    purposes: { chat: "native", title: "host-fallback", "format-extract": "unsupported", "install-analysis": "unsupported", repair: "unsupported", serve: "unsupported", subagent: "unsupported" } },
  opencode: { ...common, providerId: "opencode", packageId: "bottega.provider.opencode", displayName: "OpenCode",
    runtime: { discovery: { commands: ["opencode"], versionArgs: ["--version"], minimumVersion: "1.18.13" },
      launch: { kind: "acp-stdio-native", layer: "native" },
      env: { allow: ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"],
        processStart: ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"] } },
    auth: { check: "turn-evidence", login: { local: "terminal", remote: "unsupported" }, credentialSafeProbe: false },
    sensitiveRoots: { paths: ["~/.config/opencode", "~/.local/share/opencode", "~/.cache/opencode", "~/.local/state/opencode", "~/.opencode"],
      envOverrides: ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"], keychainServices: [], retainAfterUninstall: true },
    /* OpenCode v1 takes no Section, Subagent or Project-conversion assignment. */
    capabilities: capabilities(chatCore),
    purposes: { chat: "native", title: "host-fallback", "format-extract": "unsupported", "install-analysis": "unsupported", repair: "unsupported", serve: "unsupported", subagent: "unsupported" } },
};

/* Not parsed here: the provider bridge bundles this module for the tool schemas' capability lookup, and the descriptor schema would
   ride along. The catalog parses every descriptor in main, and the drift guard parses these four. */
export { BUILTIN_PROVIDER_IDS } from "@ai-chat/cloud-protocol/chats/backend-id";

export const BUILTIN_PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = Object.freeze(AGENT_BACKEND_ORDER.map(id => descriptors[id]));

/** The descriptor for a provider id, or null for an id this host does not ship; callers render a neutral fallback. */
export const builtinProviderDescriptor = (providerId: string) =>
  BUILTIN_PROVIDER_DESCRIPTORS.find(descriptor => descriptor.providerId === providerId) ?? null;

/** A non-empty provider tuple for a tool schema's assignment enum; empty would silently disable the tool, so it throws. */
export function assignableProviders(capability: Extract<ProviderCapability, "section-assign" | "subagent-assign" | "project-convert">) {
  const ids = providersDeclaring(BUILTIN_PROVIDER_DESCRIPTORS, capability) as BuiltinId[];
  if (!ids.length) throw new Error(`no provider declares ${capability}`);
  return ids as [BuiltinId, ...BuiltinId[]];
}
