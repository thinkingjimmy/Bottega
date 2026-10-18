/**
 * [INPUT]: Uses native RPC errors, session absence identity.
 * [OUTPUT]: Exports codexSessionMissing.
 * [POS]: Pure native protocol helpers; no ACP mode, adapter configuration or fallback.
 */
import { NativeRpcError } from "./native/transport/errors";

export const codexSessionMissing = (id: string, cause: unknown) => cause instanceof NativeRpcError && cause.code === -32600 && cause.message === `no rollout found for thread id ${id}`;
