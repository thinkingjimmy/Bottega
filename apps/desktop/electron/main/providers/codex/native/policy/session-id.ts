/**
 * [INPUT]: Uses native Codex UUID session identity.
 * [OUTPUT]: Exports validateCodexSessionId for main-side session admission.
 * [POS]: Pure identity gate; does not load native RPC or turn parsing.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const validateCodexSessionId = (id: string) => UUID_PATTERN.test(id);
