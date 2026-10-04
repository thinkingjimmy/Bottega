/**
 * [INPUT]: The existing pinned, native-WASM-verified libsodium backend.
 * [OUTPUT]: createTunnelPrimitive with only randomness and XChaCha20-Poly1305.
 * [POS]: Dormant S7 primitive adapter; browser execution is restricted to workers.
 */
import { loadWasmBackend } from "../worker/engine/backend";
export async function createTunnelPrimitive(preloaded?: Parameters<typeof loadWasmBackend>[0]) {
  if (typeof (globalThis as { document?: unknown }).document !== "undefined") throw new Error("tunnel-worker-required");
  const backend = await loadWasmBackend(preloaded);
  return { random: backend.random, encrypt: backend.encrypt, decrypt: backend.decrypt };
}
