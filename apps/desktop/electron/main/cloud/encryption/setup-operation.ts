/**
 * [INPUT]: Account/session generations, original review/consent owners and typed transient transport failures.
 * [OUTPUT]: A single cancellable Enable sync operation with three bounded retries and secret-free progress.
 * [POS]: Main-only setup coordinator; encryption still owns keys and initial sync still owns durable consent.
 */
import { setTimeout as delay } from "node:timers/promises";
import { ConvexError } from "convex/values";
import { CryptoError } from "@ai-chat/cloud-protocol/encryption";
import { initialSyncSetupState, syncEncryptionErrorSchema, type SyncSetupState } from "../../../../shared/cloud/encryption";
import { AuthTransportError } from "../account/session-client";
import { sameIdentity, type SyncIdentity } from "./model";

type Identity = SyncIdentity & { generation: number };
type Ports = {
  identity(): Identity | null;
  ready(): boolean;
  refresh(): Promise<void>;
  review(reviewId: string): Promise<string>;
  approved(): boolean;
  changed(value: SyncSetupState): void;
  wait?(milliseconds: number, signal: AbortSignal): Promise<void>;
};
const retryDelays = [1000, 2000, 4000];
const interrupted = new Set(["sync-operation-cancelled", "cloud-request-superseded", "SYNC_ACCOUNT_UNAVAILABLE", "SYNC_SCOPE_INACTIVE", "sync-locked"]);
const code = (error: unknown) => error instanceof ConvexError && typeof error.data === "string" ? error.data : error instanceof Error ? error.message : "";
const transient = (error: unknown) => error instanceof AuthTransportError && error.kind === "temporarily-offline";
const sameOwner = (a: Identity | null, b: Identity | null) => sameIdentity(a, b) && a?.generation === b?.generation;
function failure(error: unknown): SyncSetupState["error"] {
  if (transient(error)) return "sync-connection-failed";
  const value = code(error);
  if (value === "SYNC_REVIEW_EXPIRED") return "sync-review-expired";
  if (value === "scan-failed") return value;
  return syncEncryptionErrorSchema.safeParse(value).data ?? "request-failed";
}
async function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    stop = () => reject(new CryptoError("sync-operation-cancelled"));
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
  try { return await Promise.race([work, cancelled]); }
  finally { signal.removeEventListener("abort", stop); }
}

export class SyncSetupOperation {
  private active: AbortController | null = null;
  private owner: Identity | null = null;
  private disconnections = 0;
  private connected = false;
  constructor(private readonly ports: Ports) {}
  accountChanged() {
    const connected = this.ports.ready();
    if (this.connected && !connected) this.disconnections++;
    this.connected = connected;
    if (this.owner && !sameOwner(this.owner, this.ports.identity())) this.cancel();
  }
  cancel() {
    this.owner = null;
    this.active?.abort();
    this.ports.changed({ ...initialSyncSetupState });
  }
  async run(reviewId: string, apply: (reviewId: string) => Promise<void>) {
    if (this.active) throw new CryptoError("sync-operation-busy");
    const identity = this.ports.identity();
    if (!identity) throw new CryptoError("sync-operation-cancelled");
    const controller = new AbortController(), { signal } = controller;
    this.active = controller; this.owner = identity; this.connected = this.ports.ready();
    const guard = () => {
      if (signal.aborted || !sameOwner(identity, this.ports.identity())) throw new CryptoError("sync-operation-cancelled");
    };
    const publish = (status: SyncSetupState["status"], retryCount: number, error: SyncSetupState["error"] = null) => {
      guard(); this.ports.changed({ status, retryCount, error });
    };
    try {
      for (let retryCount = 0; ; retryCount++) {
        guard();
        if (retryCount) {
          publish("retrying", retryCount);
          const wait = this.ports.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
          await cancellable(wait(retryDelays[retryCount - 1]!, signal), signal);
        }
        guard(); publish("running", retryCount); guard();
        const disconnected = this.disconnections;
        try {
          if (!this.ports.ready()) {
            await cancellable(this.ports.refresh(), signal); guard();
            if (!this.ports.ready()) throw new AuthTransportError("temporarily-offline");
          }
          if (!this.ports.approved()) {
            reviewId = await cancellable(this.ports.review(reviewId), signal); guard();
            try { await cancellable(apply(reviewId), signal); }
            catch (error) {
              guard();
              // A long derivation may outlive its inventory. Renew once without replaying committed consent.
              if (code(error) !== "SYNC_REVIEW_EXPIRED" || this.ports.approved()) throw error;
              reviewId = await cancellable(this.ports.review(reviewId), signal); guard();
              await cancellable(apply(reviewId), signal);
            }
          }
          guard(); publish("succeeded", retryCount); return;
        } catch (error) {
          guard();
          // A late activation/reply failure cannot turn durable approval into another creation attempt.
          if (this.ports.approved()) { publish("succeeded", retryCount); return; }
          const offlineCancellation = this.disconnections !== disconnected && interrupted.has(code(error));
          const retryable = transient(error) || offlineCancellation;
          if (retryable && retryCount < retryDelays.length) continue;
          publish("failed", retryCount, retryable ? "sync-connection-failed" : failure(error));
          throw error;
        }
      }
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
