/**
 * [INPUT]: Depends on node:crypto/fs/vm.
 * [OUTPUT]: Provides BridgeModule, ProviderModuleRefused and loadPinnedProviderModule: a Provider's bridge module read once from a regular file, its bytes checked against the pinned sha256, then evaluated from those same bytes with a require that admits nothing.
 * [POS]: The bridge's only way to obtain a Provider's code (turn-values.ts); the pin comes from main (runtime-entries.json), never from the module's own directory. Same-context evaluation is for Bottega's own built-in modules; third-party modules get their own isolation decision (d4).
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import type { AcpSpawnConfig } from "../../backends/acp/launch";
import type { HeadlessParserState } from "../../backends/types";
import type { PromptReplay } from "./acp/turn/prompt-replay";
import type { QuotaExchange } from "../../usage-limits/readers/exchange";

export type BridgeModule = {
  turnValues: Omit<AcpSpawnConfig, "command" | "args" | "env">;
  headlessParser?: (line: string, state: HeadlessParserState, wantsJson: boolean) => void;
  promptReplay?: PromptReplay;
  /** How this Provider's quota is read on its bridge (TASK-13 B2); a module without one cannot read quota. */
  quotaExchange?: QuotaExchange;
};

export class ProviderModuleRefused extends Error {
  constructor(readonly reason: "pin-missing" | "not-a-file" | "digest-mismatch" | "require-refused" | "shape-invalid", message: string) {
    super(message);
    this.name = "ProviderModuleRefused";
  }
}

/** Reads `path` exactly once: a link, a directory or bytes that differ from `sha256` are refused before a line of it runs. */
export function loadPinnedProviderModule(pin: { path?: string; sha256?: string }): BridgeModule {
  const { path, sha256 } = pin;
  if (!path || !sha256 || !/^[a-f0-9]{64}$/.test(sha256)) throw new ProviderModuleRefused("pin-missing", "the bridge was started without a pinned Provider module");
  if (!lstatSync(path).isFile()) throw new ProviderModuleRefused("not-a-file", `${path} is not a regular file`);
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new ProviderModuleRefused("digest-mismatch", `${path} does not match its pinned digest`);
  const module = { exports: {} as Record<string, unknown> };
  /* A Provider module is pure data and functions: it may require nothing at all (no fs, process, network, workers, vm or inspector). */
  const allowed = (id: string): never => { throw new ProviderModuleRefused("require-refused", `a Provider module may not require ${id}`); };
  const evaluate = runInThisContext(`(function (exports, require, module) {${bytes.toString("utf8")}\n})`, { filename: path }) as
    (exports: unknown, require: (id: string) => unknown, module: { exports: unknown }) => void;
  evaluate(module.exports, allowed, module);
  const loaded = module.exports as Partial<BridgeModule>;
  const optionalFunction = (value: unknown) => value === undefined || typeof value === "function";
  if (!loaded.turnValues || typeof loaded.turnValues !== "object" || !optionalFunction(loaded.headlessParser) || !optionalFunction(loaded.promptReplay)
    || !optionalFunction(loaded.quotaExchange)) {
    throw new ProviderModuleRefused("shape-invalid", `${path} does not export a Provider bridge module`);
  }
  return loaded as BridgeModule;
}
