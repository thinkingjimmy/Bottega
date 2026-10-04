/**
 * [INPUT]: Depends on Zod.
 * [OUTPUT]: Provides the contract grammar (pluginContractSchema), the named contracts (BASE_CONTRACT, AGENT_PROVIDER_CONTRACT, MEMORY_CONTRACT,
 *           TUNNEL_CONTRACT, SETTINGS_CONTRACT), HOST_OFFERED_CONTRACTS, the contract table with contractKindOf, the resolver's input and
 *           output types (PluginNode, BlockReason, Resolution) and the structural refusal codes (CONTRACT_REFUSALS).
 * [POS]: Appendix C.1–C.2 as data: exclusive contracts have one owner, shared ones are met by any usable provider, host ones always hold.
 *        The pure resolver that consumes these types lives in the desktop main process (plugins/resolve.ts); nothing here behaves.
 */
import { z } from "zod";

export const pluginContractSchema = z.string().regex(/^bottega\.[a-z0-9.-]+\/v[1-9][0-9]*$/);

export const BASE_CONTRACT = "bottega.base/v1";
export const AGENT_PROVIDER_CONTRACT = "bottega.agent-provider/v1";
export const MEMORY_CONTRACT = "bottega.memory/v1";
export const TUNNEL_CONTRACT = "bottega.tunnel/v1";
export const SETTINGS_CONTRACT = "bottega.settings/v1";
/** Always met: the host itself offers them to every package. */
export const HOST_OFFERED_CONTRACTS = ["bottega.operations/v1", "bottega.storage/v1", "bottega.events/v1", "bottega.background/v1",
  "bottega.process.supervised/v1", SETTINGS_CONTRACT] as const;

export type ContractKind = "exclusive" | "shared" | "host";
const CONTRACT_KINDS: Readonly<Record<string, ContractKind>> = Object.freeze({
  [BASE_CONTRACT]: "exclusive",
  [MEMORY_CONTRACT]: "exclusive",
  [TUNNEL_CONTRACT]: "exclusive",
  [AGENT_PROVIDER_CONTRACT]: "shared",
  ...Object.fromEntries(HOST_OFFERED_CONTRACTS.map(contract => [contract, "host" as const])),
});
/** A contract missing from the table is exclusive, as every contract was before the table existed. */
export const contractKindOf = (contract: string): ContractKind => CONTRACT_KINDS[contract] ?? "exclusive";
/** Exclusive contracts a built-in plugin owns: a host package may never provide them (`contract-reserved`). */
export const RESERVED_CONTRACTS = [BASE_CONTRACT, MEMORY_CONTRACT, TUNNEL_CONTRACT] as const;

export type BlockReason = "missing" | "disabled" | "unsupported" | "cycle";
export const BLOCK_REASONS = ["missing", "disabled", "unsupported", "cycle"] as const;
export type PluginNode = Readonly<{ id: string; provides: readonly string[]; requires: readonly string[]; enabled: boolean; platformSupported: boolean }>;
export type Resolution = Readonly<{
  plugins: Readonly<Record<string, { usable: boolean; blockedBy: ReadonlyArray<{ contract: string; reason: BlockReason }> }>>;
  /** Contract → the usable plugins that satisfy it. */
  owners: Readonly<Record<string, readonly string[]>>;
  /** An exclusive contract claimed by more than one plugin. */
  conflicts: ReadonlyArray<{ contract: string; pluginIds: readonly string[] }>;
}>;

/** Install-time refusals: only structural problems stop an install; a missing dependency does not (C.2's three stages). */
export const CONTRACT_REFUSALS = ["contract-reserved", "contract-conflict", "dependency-cycle"] as const;
/** The only runtime-admission refusal for dependencies. */
export const CONTRACT_MISSING = "contract-missing";
