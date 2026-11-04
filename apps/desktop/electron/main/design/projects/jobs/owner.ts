/**
 * [INPUT]: One trusted immutable request identity, owned producer and real progress/AbortSignal.
 * [OUTPUT]: Global two-job import/export materialization, bounded single-start jobs, exact completed results, source-bound explicit retries and prompt unfinished cancellation.
 * [POS]: Ephemeral project job lifetime only; committed content remains in existing Artifact custody and document journals.
 */
export type ProjectJobProgress = { stage: "versions" | "resources" | "archive" | "complete" | "validating" | "publishing"; completed: number; total: number };
export type ProjectJobStatus<T> = { state: "running" | "complete" | "failed" | "cancelled"; progress?: ProjectJobProgress; result?: T; error?: string };
type Producer<T> = (signal: AbortSignal, progress: (value: ProjectJobProgress) => void) => Promise<T>;
type Record<T> = { identity: string; controller: AbortController; status: ProjectJobStatus<T> };
let running = 0;
export async function withProjectWork<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 2) throw new Error("Two complete project jobs are running. Try again after one completes.");
  running++;
  try { return await work(); } finally { running--; }
}
export class ProjectJobOwner<T> {
  private readonly records = new Map<string, Record<T>>();
  private closed = false;
  private record(id: string) { if (this.closed) throw new Error("The project job owner closed"); const value = this.records.get(id); if (!value) throw new Error("The original project job is unavailable"); return value; }
  start(id: string, identity: string, produce: Producer<T>) {
    if (this.closed) throw new Error("The project job owner closed");
    if (!id || id.length > 128 || !identity || identity.length > 256) throw new Error("Invalid project request identity");
    const known = this.records.get(id);
    if (known) { if (known.identity !== identity) throw new Error("The original project request has different source identity"); return this.status(id); }
    if (this.records.size >= 64) throw new Error("The project request budget is full. Reopen this editor before starting another job.");
    if (running >= 2) throw new Error("Two complete project jobs are running. Try again after one completes.");
    const record: Record<T> = { identity, controller: new AbortController(), status: { state: "running" } }; this.records.set(id, record); running++;
    void Promise.resolve().then(async () => {
      record.controller.signal.throwIfAborted();
      const result = await produce(record.controller.signal, value => {
        record.controller.signal.throwIfAborted();
        if (!Number.isSafeInteger(value.completed) || !Number.isSafeInteger(value.total) || value.completed < 0 || value.total < value.completed || value.total > 10000) throw new Error("Invalid actual project progress");
        record.status = { state: "running", progress: { ...value } };
      }); record.controller.signal.throwIfAborted(); record.status = { state: "complete", ...(record.status.progress ? { progress: record.status.progress } : {}), result };
    }).catch(cause => { record.status = { state: record.controller.signal.aborted ? "cancelled" : "failed", error: cause instanceof Error ? cause.message.slice(0, 1000) : "The project job failed" }; }).finally(() => { running--; });
    return this.status(id);
  }
  status(id: string): ProjectJobStatus<T> { return structuredClone(this.record(id).status); }
  cancel(id: string) { const record = this.record(id); if (record.status.state === "running") { record.controller.abort(new Error("The project job was cancelled")); record.status = { state: "cancelled" }; } return this.status(id); }
  retry(id: string, identity: string, produce: Producer<T>) {
    const record = this.record(id); if (record.identity !== identity) throw new Error("The original project request has different source identity");
    if (record.status.state === "running" || record.status.state === "complete") return this.status(id);
    this.records.delete(id);
    try { return this.start(id, identity, produce); } catch (cause) { this.records.set(id, record); throw cause; }
  }
  close() { if (this.closed) return; this.closed = true; for (const record of this.records.values()) if (record.status.state === "running") record.controller.abort(new Error("The project job owner closed")); this.records.clear(); }
}
