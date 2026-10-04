/**
 * [INPUT]: Depends on the Base wire byte limit and the Provider contract's bounded id
 * [OUTPUT]: Provides ProviderTraits (including isolatedConfig: a CLI run with Bottega's own configuration), BUILTIN_PROVIDER_TRAITS and providerTraits (fail-closed defaults for a provider the host has no traits for)
 * [POS]: The host-private half of each catalog entry (TASK-11 (a) S2, provider-catalog.md §2.2): product policy and host measurements that a Provider package never declares; the public facts about a CLI stay in its descriptor (builtin.ts)
 */
import type { ProviderId } from "@ai-chat/cloud-protocol/contracts/provider";
import { BASE_WIRE_BYTE_LIMIT } from "../bases/model/bases-ipc";

export type ProviderTraits = Readonly<{
  /** The caller-visible budget of a built-in tool's final MCP result. */
  builtinWireByteLimit: number;
  /** The first CLI version measured to run the built-in tools in the product; null: never unlocked (a provider without evidence
      needs no branch to stay locked). */
  builtinToolsMinimumVersion: readonly number[] | null;
  /** The first CLI version whose manual stdio MCP works; null: no version gate. */
  manualMcpMinimumVersion: readonly number[] | null;
  /** A "max" effort choice holds for its own Chat only: the next Chat's default drops it and starts from the provider default. */
  maxEffortPerChat: boolean;
  /** The credential root must be a dedicated directory, never HOME or one of its ancestors. */
  dedicatedCredentialRoot: boolean;
  /** The host projects its plugin state into the CLI's session and toggles plugins one by one (Claude's plugin projection). */
  pluginProjection: boolean;
  /** The sign-in check runs in the CLI's own ACP readiness process, so it first queues for a background process lease. */
  authCheckLease: boolean;
  /** Where a sign-in answer holds: "workspace" is known only for an execution scope, so without one it stays unknown. */
  authScope: "global" | "workspace";
  /** The CLI runs with Bottega's own configuration root and project config off, so the person's global and project settings for
      it (its providers among them) are not read; its Settings row says so. The row's copy names OpenCode's configuration paths,
      so a second Provider with this trait needs its own copy (or paths from its descriptor) first. */
  isolatedConfig: boolean;
}>;

const common: ProviderTraits = { builtinWireByteLimit: BASE_WIRE_BYTE_LIMIT, builtinToolsMinimumVersion: null, manualMcpMinimumVersion: null,
  maxEffortPerChat: false, dedicatedCredentialRoot: false, pluginProjection: false, authCheckLease: false, authScope: "global", isolatedConfig: false };

export const BUILTIN_PROVIDER_TRAITS: Readonly<Record<string, ProviderTraits>> = Object.freeze({
  codex: { ...common, builtinToolsMinimumVersion: [0, 144, 4], dedicatedCredentialRoot: true, authCheckLease: true },
  /* 2.1.220: the first version measured with all six rings of the built-in tools (verified-capabilities 2026-08-01). */
  claude: { ...common, builtinToolsMinimumVersion: [2, 1, 220], maxEffortPerChat: true, pluginProjection: true, authCheckLease: true },
  /* Kimi truncates tool results near 100 KB (measured), so it keeps 20 KB of headroom. 0.37.0 introduced a conversion that throws on
     an MCP entry without `type`, while ACP v1 stdio entries carry none, so 0.37.0–0.38.x fail every session/new with the built-in
     server; upstream fixed it in 0.39.0 (PR #3183), measured green (builtinMcpReady 55 ms). No broken-window range gate: the floor
     is simply the verified version. */
  kimi: { ...common, builtinWireByteLimit: 80 * 1024, builtinToolsMinimumVersion: [0, 39, 0], manualMcpMinimumVersion: [0, 39, 0],
    authScope: "workspace" },
  /* OpenCode's built-in tools are not unlocked (deferred ledger L7); its isolated backend-config MCP overlay keeps the common
     wire budget until a narrower truncation line is measured. */
  opencode: { ...common, isolatedConfig: true },
});

/** A provider the host has no traits for gets the fail-closed defaults: built-in tools never unlocked, no projection. */
export const providerTraits = (id: ProviderId | string): ProviderTraits =>
  Object.hasOwn(BUILTIN_PROVIDER_TRAITS, id) ? BUILTIN_PROVIDER_TRAITS[id]! : common;
