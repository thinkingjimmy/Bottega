/**
 * [INPUT]: Depends on the Codex turn config, its adapter's prompt replay and the pure Codex quota exchange.
 * [OUTPUT]: Provides the Codex Provider's bridge module: turnValues, headlessParser, promptReplay, quotaExchange (TASK-13 B2).
 * [POS]: Built self-contained into `provider-module-<id>.js` and pinned in runtime-entries.json; the bridge loads it only from verified bytes (module-loader.ts).
 */
export { codexTurnValues as turnValues, codexHeadlessParseLine as headlessParser } from "../../codex/turn-config";
export { codexPromptReplay as promptReplay } from "../acp/turn/prompt-replay";
export { codexQuotaSession as quotaExchange } from "../../../usage-limits/readers/exchange";
