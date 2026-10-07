/**
 * [INPUT]: The Zod-free SDK Provider identity authority.
 * [OUTPUT]: canonical built-in identity tuple, keyed ids and type guard from the SDK contract.
 * [POS]: Closed built-in identity for narrow consumers; package Provider IDs use the open grammar.
 */
export { AGENT_BACKEND_ORDER, BUILTIN_PROVIDER_IDS, isBuiltinAgentId, type AgentBackendId } from "@bottega/contracts/model/provider-capabilities";
