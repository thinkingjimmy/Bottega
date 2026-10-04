/**
 * [INPUT]: Depends on the OpenCode turn config.
 * [OUTPUT]: Provides the OpenCode Provider's bridge module: turnValues.
 * [POS]: Built self-contained into `provider-module-<id>.js` and pinned in runtime-entries.json; the bridge loads it only from verified bytes (module-loader.ts).
 */
export { opencodeTurnValues as turnValues } from "../../opencode/turn-config";
