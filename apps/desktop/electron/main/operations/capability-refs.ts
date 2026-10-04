/**
 * [INPUT]: Depends on Node crypto, the public capability-ref format and VerifiedPrincipal
 * [OUTPUT]: Provides CapabilityRefTable (issue/resolve/principal/revoke/revokePrincipal/revokeAll) and CapabilityRefError
 * [POS]: Replaces main-process closures handed to out-of-process code: the target (which may hold functions, signals or process handles) stays in main, only an unguessable, principal-bound, kind-typed name crosses the boundary
 */
import { randomBytes } from "node:crypto";
import { capabilityRefKind, type CapabilityRef, type CapabilityRefKind } from "@ai-chat/cloud-protocol/contracts/capabilities";
import type { VerifiedPrincipal } from "./principals";

export class CapabilityRefError extends Error {
  readonly name = "CapabilityRefError";
  constructor(readonly code: "capability-invalid" | "capability-revoked", message: string) { super(message); }
}

type Entry = { kind: CapabilityRefKind; principal: VerifiedPrincipal; target: unknown; expiresAt: number | null };

const TOMBSTONE_LIMIT = 4_096;

export class CapabilityRefTable {
  private readonly live = new Map<string, Entry>();
  /* A revoked ref answers "revoked", not "invalid", so a caller can tell a lost grant from a forged one. */
  private readonly revoked = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(kind: CapabilityRefKind, principal: VerifiedPrincipal, target: unknown, options: { ttlMs?: number } = {}): CapabilityRef {
    principal.assertCurrent();
    const ref = `cap_${kind}_${randomBytes(32).toString("base64url")}`;
    this.live.set(ref, { kind, principal, target, expiresAt: options.ttlMs ? this.now() + options.ttlMs : null });
    return ref;
  }

  resolve<T>(ref: string, kind: CapabilityRefKind, principal: VerifiedPrincipal): T {
    if (capabilityRefKind(ref) !== kind) throw new CapabilityRefError("capability-invalid", `expected a ${kind} ref`);
    if (this.revoked.has(ref)) throw new CapabilityRefError("capability-revoked", "capability ref revoked");
    const entry = this.live.get(ref);
    if (!entry) throw new CapabilityRefError("capability-invalid", "unknown capability ref");
    if (entry.principal.key !== principal.key) throw new CapabilityRefError("capability-invalid", "capability ref belongs to another principal");
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) { this.revoke(ref); throw new CapabilityRefError("capability-revoked", "capability ref expired"); }
    try { entry.principal.assertCurrent(); } catch (cause) { this.revoke(ref); throw new CapabilityRefError("capability-revoked", (cause as Error).message); }
    return entry.target as T;
  }

  /**
   * The principal an out-of-process caller acts for: the one this ref was issued to. The caller names a ref,
   * never a principal, so a bridge cannot claim an identity it was not handed.
   */
  principal(ref: string, kind: CapabilityRefKind): VerifiedPrincipal {
    if (capabilityRefKind(ref) !== kind) throw new CapabilityRefError("capability-invalid", `expected a ${kind} ref`);
    if (this.revoked.has(ref)) throw new CapabilityRefError("capability-revoked", "capability ref revoked");
    const entry = this.live.get(ref);
    if (!entry) throw new CapabilityRefError("capability-invalid", "unknown capability ref");
    this.resolve(ref, kind, entry.principal);
    return entry.principal;
  }

  revoke(ref: string) {
    if (!this.live.delete(ref)) return;
    this.revoked.add(ref);
    if (this.revoked.size > TOMBSTONE_LIMIT) this.revoked.delete(this.revoked.values().next().value!);
  }

  revokePrincipal(key: string) {
    for (const [ref, entry] of this.live) if (entry.principal.key === key) this.revoke(ref);
  }

  revokeAll() {
    for (const ref of [...this.live.keys()]) this.revoke(ref);
  }

  get size() { return this.live.size; }
}
