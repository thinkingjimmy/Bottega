/**
 * [INPUT]: Durable local snapshots and an optional admitted encrypted publication transport.
 * [OUTPUT]: Persists publication failures and schedules exact-reference transfers independently of unrelated jobs.
 * [POS]: Artifact synchronization outbox; local custody remains usable while synchronization is unavailable.
 */
import { artifactFailure } from "./failure";
import { z } from "zod";
import { join } from "node:path";
import { artifactRefSchema, type ArtifactRef } from "../../../../shared/ipc/apps/artifact-ipc";
import { artifactFenceSchema, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { DurableJson } from "../../persistence/durable-json";
export const artifactPublicationSchema = z.object({ ref: artifactRefSchema, fence: artifactFenceSchema,
  state: z.enum(["pending", "uploading", "published", "released"]), attempts: z.number().int().nonnegative(),
  failure: z.object({ stage: z.string().max(32), code: z.string().max(40), retryable: z.boolean(), at: z.number() }).strict().optional(),
  blocked: z.literal("sync-unavailable").optional(), releasedRemotely: z.boolean().optional(),
  settled: z.literal(true).optional(), accountKey: z.string().optional(), nextAttemptAt: z.number().optional() }).strict();
export type ArtifactPublication = z.infer<typeof artifactPublicationSchema>;
const schema = z.object({ v: z.literal(1), jobs: z.array(artifactPublicationSchema) }).strict();
const key = (ref: ArtifactRef) => JSON.stringify([ref.chatId, ref.incarnationId, ref.artifactId]);
export interface ArtifactPublishTransport {
  accountKey: string;
  publish(job: ArtifactPublication, active: () => boolean, signal: AbortSignal): Promise<void>;
  release(job: ArtifactPublication, signal: AbortSignal): Promise<void>;
  settled?(job: ArtifactPublication): Promise<void>;
  download(ref: ArtifactRef, fence: ArtifactFence, signal: AbortSignal): Promise<Uint8Array>;
}
export class ArtifactPublisher {
  private readonly journal: DurableJson<z.infer<typeof schema>>;
  /* One clone per mutation instead of one per lookup: reconciliation and drain read the journal far
     more often than they write it, and DurableJson.snapshot() clones the whole file every call. */
  private readonly index = new Map<string, ArtifactPublication>();
  private readonly jobsInFlight = new Map<string, Promise<void>>();
  private flight: Promise<void> | null = null;
  private controller = new AbortController();
  private transport: (() => ArtifactPublishTransport | null) = () => null;
  constructor(root: string) { this.journal = new DurableJson(join(root, "publication.json"), schema, () => ({ v: 1, jobs: [] })); }
  async initialize() {
    await this.journal.initialize();
    /* A released job that settled has no remote reference left, so it goes at startup; a published one stays so a later release can tombstone it (C-17). */
    await this.write(state => {
      state.jobs = state.jobs.filter(job => !(job.state === "released" && job.settled));
      for (const job of state.jobs) if (job.state === "uploading") job.state = "pending";
    });
  }
  configure(transport: () => ArtifactPublishTransport | null) { this.transport = transport; }
  jobs() { return [...this.index.values()]; }
  private async write(operation: (state: z.infer<typeof schema>) => void) {
    await this.journal.mutate(operation);
    this.index.clear();
    for (const job of this.journal.snapshot().jobs) this.index.set(key(job.ref), job);
  }
  async discardUnpublished(ref: ArtifactRef) {
    let discarded = false;
    await this.write(state => { const job = state.jobs.find(job => key(job.ref) === key(ref));
      if (!job || job.attempts === 0 && job.state !== "published" && !this.jobsInFlight.has(key(ref))) {
        state.jobs = state.jobs.filter(job => key(job.ref) !== key(ref)); discarded = true;
      }
    });
    return discarded;
  }
  async enqueue(ref: ArtifactRef, fence: ArtifactFence) {
    if (this.index.has(key(ref))) return;
    await this.write(state => {
      if (!state.jobs.some(job => key(job.ref) === key(ref))) state.jobs.push({ ref, fence, state: "pending", blocked: "sync-unavailable", attempts: 0 });
    });
  }
  async release(ref: ArtifactRef) {
    const current = this.index.get(key(ref));
    if (current?.state === "released") return;
    // Nothing ever left this device, so there is no remote reference to tombstone.
    const local = !current || (current.state === "pending" && current.attempts === 0);
    await this.write(state => {
      const job = state.jobs.find(job => key(job.ref) === key(ref));
      if (job) { job.state = "released"; job.releasedRemotely = local; delete job.nextAttemptAt; delete job.settled; }
      else state.jobs.push({ ref, fence: { v: 1, id: ref.artifactId, kind: "file", title: "Artifact", rejected: "unavailable" }, state: "released", attempts: 0, releasedRemotely: true });
    });
  }
  flush() {
    if (this.flight) return this.flight;
    const flight = this.drain().finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight; return flight;
  }
  private async change(ref: ArtifactRef, update: (job: ArtifactPublication) => void) {
    await this.write(state => { const job = state.jobs.find(job => key(job.ref) === key(ref)); if (job) update(job); });
  }
  /** The transfer directory is cleared once; a terminal job must never cost I/O on a later flush. */
  private settle(ref: ArtifactRef) { return this.change(ref, job => { if (job.state === "published" || job.releasedRemotely) job.settled = true; }); }
  async flushRef(ref: ArtifactRef) {
    await this.drain(ref);
    const job = this.index.get(key(ref));
    return job?.state === "published";
  }
  private async drain(only?: ArtifactRef) {
    const deadline = Date.now() + 30_000;
    for (const initial of this.jobs()) {
      if (Date.now() >= deadline) break;
      if (only && key(initial.ref) !== key(only)) continue;
      if (initial.settled || (initial.nextAttemptAt ?? 0) > Date.now() && !only) continue;
      let task = this.jobsInFlight.get(key(initial.ref));
      if (!task) {
        if (this.jobsInFlight.size >= 2) { if (only) throw new Error("artifact-publication-busy"); continue; }
        task = this.publishOne(initial).finally(() => this.jobsInFlight.delete(key(initial.ref)));
        this.jobsInFlight.set(key(initial.ref), task);
      }
      await task;
    }
  }
  private async publishOne(initial: ArtifactPublication) {
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)]);
      signal.throwIfAborted();
      let port: ArtifactPublishTransport | null = null;
      try { port = this.transport(); } catch { /* Locked keys do not change local custody. */ }
      if (!port || (initial.accountKey && initial.accountKey !== port.accountKey)) {
        // Only an unblocked or interrupted job changes here; a blocked pending job must not rewrite the journal per flush.
        if (initial.state === "uploading" || (initial.state === "pending" && initial.blocked !== "sync-unavailable"))
          await this.change(initial.ref, job => { if (job.state === "pending" || job.state === "uploading") { job.state = "pending"; job.blocked = "sync-unavailable"; } });
        return;
      }
      const transport = port;
      try {
        if (initial.state === "published" || initial.releasedRemotely) { await transport.settled?.(initial); await this.settle(initial.ref); return; }
        const active = () => !signal.aborted && this.transport()?.accountKey === transport.accountKey && this.index.get(key(initial.ref))?.state !== "released";
        if (initial.state !== "released") {
          await this.change(initial.ref, job => { if (job.state !== "released") { job.state = "uploading"; job.accountKey = transport.accountKey; delete job.blocked; job.attempts++; } });
          if (active()) await transport.publish(initial, active, signal);
        }
        if (!active()) {
          await transport.release(initial, signal);
          await this.change(initial.ref, job => { job.releasedRemotely = true; });
        } else await this.change(initial.ref, job => { if (job.state !== "released") { job.state = "published"; delete job.nextAttemptAt; delete job.failure; } });
        await transport.settled?.(initial);
        await this.settle(initial.ref);
      } catch (cause) {
        const failure = artifactFailure(cause, initial.state === "released" ? "release" : "publish");
        await this.change(initial.ref, job => {
          if (job.state === "uploading") job.state = "pending";
          job.failure = { stage: failure.stage, code: failure.code, retryable: failure.retryable, at: Date.now() };
          job.nextAttemptAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(job.attempts, 6));
        });
      }
  }
  async download(ref: ArtifactRef, fence: ArtifactFence, signal: AbortSignal) {
    const transport = this.transport();
    if (!transport) throw new Error("artifact-sync-unavailable");
    return transport.download(ref, fence, signal);
  }
  async close() { this.controller.abort(); await Promise.allSettled([...this.jobsInFlight.values(), ...(this.flight ? [this.flight] : [])]); await this.journal.closeAndFlush(); }
}
