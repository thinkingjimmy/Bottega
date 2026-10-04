/**
 * [INPUT]: Depends on node:crypto and the trusted renderer context (window id and renderer incarnation).
 * [OUTPUT]: Provides MaintenanceIntents: expiring tokens minted when a destructive confirmation opens, bound to that window's document and the exact payload, verified by its commit and spent once the commit is recorded.
 * [POS]: Profile maintenance's intent binding (OPT-48); the renderer's confirmation dialog alone never authorizes moving or erasing the folder.
 */
import { randomBytes } from "node:crypto";

type Kind = "move" | "erase";
type Owner = Readonly<{ windowId: string; rendererIncarnation: string }>;
const TTL_MS = 10 * 60_000;

export class MaintenanceIntentError extends Error {
  override name = "MaintenanceIntentError";
  constructor() { super("MAINTENANCE_INTENT_INVALID"); }
}

/**
 * A commit must name the plan the person saw: a script in the main frame that skips the dialog, a
 * stale tab from a document that has since reloaded, or a second click after the first already
 * restarted all present a token that is missing, spent, expired or bound to another document.
 */
export class MaintenanceIntents {
  private readonly issued = new Map<string, { kind: Kind; owner: string; payload: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  mint(kind: Kind, owner: Owner, payload: string) {
    const key = ownerKey(owner);
    // One open confirmation per kind and document; reopening it retires the previous one.
    for (const [token, intent] of this.issued) if (intent.kind === kind && intent.owner === key) this.issued.delete(token);
    const token = randomBytes(24).toString("hex");
    this.issued.set(token, { kind, owner: key, payload, expiresAt: this.now() + TTL_MS });
    return token;
  }

  /** Returns the payload bound at mint time. A refused attempt (busy, quit refused) keeps it for "try again". */
  verify(kind: Kind, owner: Owner, token: unknown) {
    const intent = typeof token === "string" ? this.issued.get(token) : undefined;
    if (!intent || intent.kind !== kind || intent.owner !== ownerKey(owner) || this.now() > intent.expiresAt) throw new MaintenanceIntentError();
    return intent.payload;
  }

  /** Once the request is recorded and the restart is under way, the confirmation cannot be used again. */
  spend(token: unknown) { if (typeof token === "string") this.issued.delete(token); }
}

const ownerKey = (owner: Owner) => `${owner.windowId}\0${owner.rendererIncarnation}`;
