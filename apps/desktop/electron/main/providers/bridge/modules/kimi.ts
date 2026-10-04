/**
 * [INPUT]: Depends on the Kimi turn config.
 * [OUTPUT]: Provides the Kimi Provider's bridge module: turnValues.
 * [POS]: Built self-contained into `provider-module-<id>.js` and pinned in runtime-entries.json; the bridge loads it only from verified bytes (module-loader.ts).
 */
export { kimiTurnValues as turnValues } from "../../kimi/turn-config";
