/**
 * [INPUT]: The fixed client crypto worker protocol and native worker-thread endpoint.
 * [OUTPUT]: Installs the WASM-gated worker engine inside its dedicated process thread.
 * [POS]: Build-only entry, loaded exclusively by the main-owned encryption facade.
 */
import "@ai-chat/cloud-crypto/worker/node";
