/**
 * [INPUT]: Depends on the Claude turn config, its adapter's prompt replay and the pure Claude quota control session.
 * [OUTPUT]: Provides the Claude Provider's bridge module: turnValues, headlessParser, promptReplay, quotaExchange (TASK-13 B2).
 * [POS]: Built self-contained into `provider-module-<id>.js` and pinned in runtime-entries.json; the bridge loads it only from verified bytes (module-loader.ts).
 */
export { claudeTurnValues as turnValues, claudeHeadlessParseLine as headlessParser } from "../../claude/turn-config";
export { claudePromptReplay as promptReplay } from "../acp/turn/prompt-replay";
export { openClaudeQuotaControl as quotaExchange } from "../../../usage-limits/readers/exchange";
