/**
 * [INPUT]: Depends on explicit corruption categories, durable preservation, confirmed process birth evidence and the E2E fault seam.
 * [OUTPUT]: Preserves unreadable ledgers and holds execution/cleanup until every surviving old process exits and deferred recovery has run once; each deferred task runs in isolation, a failed skippable task is reported and skipped, a failed required task is reported and retried in the background without holding the gate for everything else.
 * [POS]: Profile-wide fallback when a corrupt journal can no longer identify the affected Chat; healthy SQLite content stays readable. Only this profile's guardians (by their control-root cwd) hold it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { durableReplaceFile, quarantineDurableFile, isErrnoCode } from "../../persistence/durable-json";
import { installDurableRecovery, installRecoveryGate, type DeferredRecovery, type DurableRecovery } from "../../persistence/recovery-policy";
import { SerialQueue } from "../../persistence/serial-queue";
import { recoveryCategory, type RecoveryCategory } from "./policy";
import { inspectRecoveryProcesses, recoveryProcessHasExited } from "./processes";
import { interruptionPoint } from "../boot/composition-hooks";
import { taskStartFence } from "../../presence/lifecycle/start-fence";
const schema = z.object({ version: z.literal(1), files: z.array(z.string()), processes: z.array(z.object({ pid: z.number().int().positive(),
  processGroupId: z.number().int().positive(), birthIdentity: z.string().min(1) })), complete: z.boolean() }).strict();
export class ProfileRecoveryGuard {
  private state: z.infer<typeof schema> = { version: 1, files: [], processes: [], complete: true };
  private readonly queue = new SerialQueue();
  private readonly released: Array<() => Promise<void>> = [];
  private readonly deferred: Array<{ task: () => Promise<void> } & DeferredRecovery> = [];
  /* A required task that failed keeps its own restriction and is retried; it no longer holds every other send (F-09). */
  private readonly retrying: Array<{ task: () => Promise<void> } & DeferredRecovery> = [];
  private opened = false;
  private readonly reported = new Set<string>();
  private readonly context = new AsyncLocalStorage<boolean>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private detach: Array<() => void> = [];
  private probeFlight: Promise<void> | null = null;
  private sealed = false;
  private stopped = false;
  private resetSettings = false;
  readonly path: string;
  constructor(private root: string, private changed: (event: { category: RecoveryCategory; path: string; held: boolean }) => void,
    private probe = inspectRecoveryProcesses, private exited = recoveryProcessHasExited,
    private failed: (name: string, cause: unknown) => void = (name, cause) => console.error(`[startup] deferred recovery ${name} failed`, cause)) {
    this.path = join(root, "recovery-pending.json");
  }
  get pending() { return this.state.files.length > 0; }
  /* A held profile has no notice of its own: the dispatch gate holds its turns and names the reason in the composer. */
  get settingsReset() { return this.resetSettings; }
  private get closed() { return !this.sealed || this.pending || this.deferred.length > 0; }
  get blocked() { return this.closed && !this.context.getStore(); }
  /* Turns that waited on the gate (the dispatcher holds them while it is closed) are woken each time it opens. */
  private wakeIfOpened(wasClosed: boolean) { if (wasClosed && !this.closed && !this.stopped) taskStartFence.wake(); }
  private write(state = this.state) { return durableReplaceFile(this.path, JSON.stringify(state) + "\n"); }
  async initialize() {
    const content = await readFile(this.path, "utf8").catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
    if (content !== null) {
      try { this.state = schema.parse(JSON.parse(content)); }
      catch {
        const evidence = this.probe(content, this.root);
        this.state = { version: 1, files: ["recovery-pending.json"], ...evidence };
        await quarantineDurableFile(this.path); await this.write();
      }
    }
    this.detach = [installDurableRecovery((path, content) => this.recover(path, content)), installRecoveryGate({
      blocked: () => this.blocked, pending: () => this.pending, defer: (task, recovery) => { this.deferred.push({ task, ...recovery }); this.arm(); } })];
    this.arm();
  }
  /* The probe polls only while there is custody or a task to release; an idle guard holds no timer (C-29). */
  private arm() {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.check().catch(error => console.error("Custody recovery probe failed", error)), 2000); this.timer.unref();
  }
  // Start release only once every startup owner has registered its held writer.
  sealStartup() { const wasClosed = this.closed; this.sealed = true; this.wakeIfOpened(wasClosed); void this.check().catch(error => console.error("Custody recovery probe failed", error)); }
  private recover(path: string, content: string | null): Promise<DurableRecovery | null> {
    this.arm();
    return this.queue.enqueue(async () => {
      const local = relative(this.root, path);
      if (local.startsWith("..") || isAbsolute(local)) return null;
      const category = recoveryCategory(local.split("\\").join("/"));
      if (content === null && !this.state.files.includes(local) && !(category === "custody" && this.state.files.includes("recovery-pending.json"))) return null;
      let held = false;
      if (category === "custody") {
        const evidence = this.probe(content ?? "", this.root);
        held = !evidence.complete || evidence.processes.some(process => !this.exited(process)) || this.state.files.length > 0;
        if (held) {
          this.state.complete &&= evidence.complete;
          if (!this.state.files.includes(local)) this.state.files.push(local);
          for (const item of evidence.processes) if (!this.state.processes.some(old => old.pid === item.pid && old.birthIdentity === item.birthIdentity)) this.state.processes.push(item);
          await this.write();
        }
      }
      await quarantineDurableFile(path);
      if (category === "settings") this.resetSettings = true;
      this.changed({ category, path: local, held });
      return { held, released: task => { if (held) this.released.push(task); } };
    });
  }
  check(): Promise<void> {
    if (this.stopped || !this.sealed) return Promise.resolve();
    if (!this.pending && !this.deferred.length && !this.released.length && !this.retrying.length) {
      if (!this.probeFlight && this.timer) { clearInterval(this.timer); this.timer = null; }
      return Promise.resolve();
    }
    if (this.probeFlight) return this.probeFlight;
    const flight = this.queue.enqueue(async () => {
      if (this.stopped) return;
      const wasClosed = this.closed;
      try { await this.release(); } finally { this.wakeIfOpened(wasClosed); }
    });
    this.probeFlight = flight;
    void flight.finally(() => { if (this.probeFlight === flight) this.probeFlight = null; }).catch(() => {});
    return flight;
  }
  private async release() {
    if (this.pending) {
      if (this.state.processes.some(process => !this.exited(process))) return;
      const inventory = this.probe("", this.root);
      if (!inventory.complete || inventory.processes.length) return;
    }
    // The process inventory is complete before empty custody can become writable.
    await this.context.run(true, async () => {
      /* One failing task used to stop the queue here, so nothing after it ran and the gate never opened (F-09). */
      while (!this.stopped && this.released.length) {
        const release = this.released.shift()!;
        await release().catch(cause => this.failed("held-writer-release", cause));
      }
      const retries = this.retrying.splice(0);
      /* Deferred tasks leave the queue only after they ran, so the gate stays closed while they run. */
      while (!this.stopped && this.deferred.length) {
        const recovery = this.deferred[0]!;
        await this.attempt(recovery);
        this.deferred.shift();
      }
      for (const recovery of retries) if (!this.stopped) await this.attempt(recovery);
    });
    /* The cleared state is written once per episode, not on every background retry of a required task. */
    if (this.stopped || this.opened && !this.pending) return;
    this.opened = true;
    const cleared = { version: 1 as const, files: [], processes: [], complete: true };
    await this.write(cleared); this.state = cleared;
    this.changed({ category: "custody", path: "", held: false });
  }
  private async attempt(recovery: { task: () => Promise<void> } & DeferredRecovery) {
    try { interruptionPoint("deferred-recovery", recovery.name); await recovery.task(); this.reported.delete(recovery.name); }
    catch (cause) {
      if (!this.reported.has(recovery.name)) { this.reported.add(recovery.name); this.failed(recovery.name, cause); }
      if (recovery.required) this.retrying.push(recovery);
    }
  }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = null; await this.queue.flush(); }
  async close() { await this.stop(); this.queue.close(); this.detach.forEach(detach => detach()); this.detach = []; }
}
