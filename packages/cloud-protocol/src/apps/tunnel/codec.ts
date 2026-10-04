/**
 * [INPUT]: An audited XChaCha20-Poly1305 primitive, one fresh grant key and opaque grant identity.
 * [OUTPUT]: TunnelCodec, strict monotonic direction-bound frames; malformed input destroys the grant key.
 * [POS]: Dormant S7 authenticated framing shared by the endpoint and Service Worker.
 */
import { TUNNEL_LIMITS } from "./model";
export type TunnelPrimitive = { random(size: number): Uint8Array; encrypt(plain: Uint8Array, aad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array, aad: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array };
export type TunnelKind = "request" | "response" | "ws-open" | "ws-frame" | "ws-close";
const kinds: TunnelKind[] = ["request", "response", "ws-open", "ws-frame", "ws-close"];
const encoder = new TextEncoder();
export class TunnelCodec {
  private sent = 0; private received = 0; private closed = false; private readonly key: Uint8Array;
  constructor(private readonly primitive: TunnelPrimitive, private readonly grantId: string, key: Uint8Array,
    private readonly side: "controller" | "owner", private readonly invalid: () => void) {
    if (key.length !== 32) throw new Error("tunnel-key-invalid"); this.key = key.slice();
  }
  seal(kind: TunnelKind, plain: Uint8Array) {
    if (this.closed || !kinds.includes(kind) || plain.length > this.limit(kind)) throw new Error("tunnel-frame-invalid");
    const seq = ++this.sent;
    if (!Number.isSafeInteger(seq)) { this.close(); throw new Error("tunnel-sequence-exhausted"); }
    const nonce = this.primitive.random(24), cipher = this.primitive.encrypt(plain, this.aad(this.side, seq, kind), nonce, this.key);
    const bytes = new Uint8Array(34 + cipher.length), view = new DataView(bytes.buffer);
    bytes[0] = 1; bytes[1] = kinds.indexOf(kind); view.setBigUint64(2, BigInt(seq)); bytes.set(nonce, 10); bytes.set(cipher, 34); return bytes;
  }
  open(bytes: Uint8Array): { kind: TunnelKind; bytes: Uint8Array } {
    try {
      if (this.closed || bytes.length < 50 || bytes.length > TUNNEL_LIMITS.response + 128 * 1024) throw new Error();
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), seq = Number(view.getBigUint64(2)), kind = kinds[bytes[1]!];
      if (bytes[0] !== 1 || !kind || !Number.isSafeInteger(seq) || seq !== this.received + 1) throw new Error();
      const plain = this.primitive.decrypt(bytes.subarray(34), this.aad(this.side === "owner" ? "controller" : "owner", seq, kind), bytes.subarray(10, 34), this.key);
      if (plain.length > this.limit(kind)) { plain.fill(0); throw new Error(); }
      this.received = seq; return { kind, bytes: plain };
    } catch { this.close(); this.invalid(); throw new Error("tunnel-frame-invalid"); }
  }
  close() { if (!this.closed) { this.closed = true; this.key.fill(0); } }
  private aad(direction: string, seq: number, kind: TunnelKind) { return encoder.encode(JSON.stringify({ grantId: this.grantId, direction, seq, kind })); }
  private limit(kind: TunnelKind) { return (kind === "response" ? TUNNEL_LIMITS.response : kind === "request" ? TUNNEL_LIMITS.request : TUNNEL_LIMITS.frame) + 64 * 1024; }
}
