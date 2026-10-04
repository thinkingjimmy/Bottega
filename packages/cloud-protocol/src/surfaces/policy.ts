/**
 * [INPUT]: Nothing; compiled App GUIs load only their own decrypted files.
 * [OUTPUT]: SURFACE_FRAGMENT_CSP, the policy an App surface frame inherits from its wrapper, and SURFACE_LIMITS (files, bytes, lease, RPC).
 * [POS]: Surface counterpart of artifacts/viewer-shell's fragment CSP; stricter because the GUI compiler already forbids eval, workers and raw transport.
 */
// Plain numbers with no schema around them, so the R-26 service contract can import them without pulling the frame protocol into Cloud Web's first chunk.
export const SURFACE_LIMITS = Object.freeze({ files: 512, fileBytes: 16 * 1024 * 1024, totalBytes: 50_000_000, leaseMs: 30 * 60_000, rpcBytes: 1024 * 1024, pendingRpcs: 32 });
export const SURFACE_FRAGMENT_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline' blob: data:", "style-src 'unsafe-inline' blob: data:", "img-src blob: data:",
  "font-src blob: data:", "media-src blob: data:", "connect-src blob: data:", "worker-src 'none'", "frame-src 'none'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "manifest-src 'none'",
].join("; ");
