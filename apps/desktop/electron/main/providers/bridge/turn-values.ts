/**
 * [INPUT]: Depends on the pinned Provider module loader (module-loader.ts) the host ACP failure classifier, and the bridge's own Provider and pin from its host environment.
 * [OUTPUT]: Provides bridgeTurnValues(backend) (a promise of the AcpTurn values: the module's turn values, with its prompt replay when it has one) bridgeHeadlessParser(backend) (its headless output parser) and bridgeQuotaExchange(backend) (its quota exchange); a Provider this bridge was not started for, or one whose module has no parser, is refused, never defaulted to another's. configureProviderModules swaps the module source (tests).
 * [POS]: The bridge entry's one place that obtains a Provider's code. A bridge runs one Provider (`provider-<id>`), so it loads exactly one module, from the bytes it verified; no Provider's code is statically imported here (TASK-11 d2).
 */
import { classifyAcpFailure } from "../../backends/acp/failure";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import type { HeadlessParserState } from "../../backends/types";
import { loadPinnedProviderModule, type BridgeModule } from "./module-loader";
import type { QuotaExchange } from "../../usage-limits/readers/exchange";

export type BridgeTurnValues = Omit<AcpSpawnConfig, "command" | "args" | "env">;
type ModuleSource = (backend: string) => BridgeModule | null;

/* The host starts this bridge for one Provider and hands it that Provider's module path and pinned digest. */
const pinnedSource = (): ModuleSource => {
  let loaded: BridgeModule | undefined;
  return backend => backend && backend === process.env.BOTTEGA_PROVIDER_ID
    ? loaded ??= loadPinnedProviderModule({ path: process.env.BOTTEGA_PROVIDER_MODULE, sha256: process.env.BOTTEGA_PROVIDER_MODULE_SHA256 })
    : null;
};
let source: ModuleSource = pinnedSource();

/** Replaces where modules come from; tests load the module sources directly. */
export function configureProviderModules(next: ModuleSource) { source = next; }

export async function bridgeTurnValues(backend: string): Promise<BridgeTurnValues> {
  const module = source(backend);
  if (!module) throw new Error(`the Provider bridge cannot run ${backend} turns yet`);
  return { ...module.turnValues, classifyFailure: module.turnValues.classifyFailure ?? classifyAcpFailure,
    ...(module.promptReplay ? { promptReplay: module.promptReplay } : {}) };
}

type HeadlessParse = (line: string, state: HeadlessParserState, wantsJson: boolean) => void;
export async function bridgeHeadlessParser(backend: string): Promise<HeadlessParse> {
  const parse = source(backend)?.headlessParser;
  if (!parse) throw new Error(`the Provider bridge cannot run ${backend} headless jobs yet`);
  return parse;
}

/** The Provider's quota exchange from its module (TASK-13 B2); a Provider whose module has none cannot read quota here. */
export function bridgeQuotaExchange(backend: string): QuotaExchange {
  const exchange = source(backend)?.quotaExchange;
  if (!exchange) throw new Error(`the Provider bridge cannot read ${backend} quota`);
  return exchange;
}
