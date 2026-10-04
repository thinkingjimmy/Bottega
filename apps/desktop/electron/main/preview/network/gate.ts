/**
 * [INPUT]: Cryptographic randomness, an edge hostname and a renewable account lease deadline.
 * [OUTPUT]: PreviewGate with single-use 60-second codes, signed cookies, Origin checks and idle expiry.
 * [POS]: Main-owned authorization; Cloudflare carries plaintext preview traffic but never grants access.
 */
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
export const PREVIEW_COOKIE = "__Host-bottega-preview";
export class PreviewGate {
  private secret: Buffer | null = null;
  private codes = new Map<string, number>();
  private hostname: string | null = null;
  private deadline = 0;
  private lastActivity = 0;
  constructor(private readonly now = Date.now) {}
  open(hostname: string, leaseUntil: number) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(hostname)) throw new Error("preview-host-invalid");
    this.close(); this.secret = randomBytes(32); this.hostname = hostname; this.deadline = leaseUntil; this.lastActivity = this.now();
  }
  renew(until: number) { if (this.secret) this.deadline = until; }
  active() { return !!this.secret && this.now() < this.deadline && this.now() - this.lastActivity < 30 * 60_000; }
  origin() { return this.hostname ? `https://${this.hostname}` : null; }
  matchesHost(host: string | undefined) { return !!host && host === this.hostname; }
  issue() {
    if (!this.active()) throw new Error("preview-session-closed");
    for (const [code, expires] of this.codes) if (expires <= this.now()) this.codes.delete(code);
    if (this.codes.size >= 16) throw new Error("preview-code-limit");
    const code = randomBytes(32).toString("base64url"); this.codes.set(code, this.now() + 60_000);
    return `${this.origin()}/__bottega/enter#${code}`;
  }
  exchange(code: string, origin: string | undefined) {
    const expires = this.codes.get(code); this.codes.delete(code);
    if (!this.active() || origin !== this.origin() || !expires || expires <= this.now()) return null;
    const token = randomBytes(24).toString("base64url");
    this.lastActivity = this.now();
    return `${PREVIEW_COOKIE}=${token}.${this.sign(token)}; Path=/; Secure; HttpOnly; SameSite=Lax`;
  }
  authorize(cookie: string | undefined, origin: string | undefined, writeOrUpgrade: boolean) {
    if (!this.active() || (writeOrUpgrade && origin !== this.origin())) return false;
    const value = (cookie ?? "").split(";").map(s => s.trim()).find(s => s.startsWith(PREVIEW_COOKIE + "="))?.slice(PREVIEW_COOKIE.length + 1);
    if (!value || value.length > 256) return false;
    const [token, signature, extra] = value.split(".");
    if (extra || !token || !signature) return false;
    const expected = Buffer.from(this.sign(token)), received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
    this.lastActivity = this.now(); return true;
  }
  close() { this.secret?.fill(0); this.secret = null; this.codes.clear(); this.hostname = null; this.deadline = 0; }
  private sign(token: string) { return createHmac("sha256", this.secret!).update(this.hostname + "\0" + token).digest("base64url"); }
}
