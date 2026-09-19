/**
 * [INPUT]: Depends on explicit corruption categories, durable preservation and confirmed process birth evidence.
 * [OUTPUT]: Preserves unreadable ledgers and holds execution/cleanup until every surviving old process exits and deferred recovery completes.
 * [POS]: Profile-wide fallback when a corrupt journal can no longer identify the affected Chat; healthy SQLite content stays readable.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { z } from "zod";
import { durableReplaceFile, quarantineDurableFile, isErrnoCode } from "../../persistence/durable-json";
import { installDurableRecovery, installRecoveryGate, type DurableRecovery } from "../../persistence/recovery-policy";
import { SerialQueue } from "../../persistence/serial-queue";
import { recoveryCategory, type RecoveryCategory } from "./policy";
import { inspectRecoveryProcesses, recoveryProcessHasExited } from "./processes";
const schema = z.object({ version: z.literal(1), files: z.array(z.string()), processes: z.array(z.object({ pid: z.number().int().positive(),
  processGroupId: z.number().int().positive(), birthIdentity: z.string().min(1) })), complete: z.boolean() }).strict();
export class ProfileRecoveryGuard {
  private state: z.infer<typeof schema> = { version: 1, files: [], processes: [], complete: true };
  private readonly queue = new SerialQueue();
  private readonly released: Array<() => Promise<void>> = [];
  private readonly deferred: Array<() => Promise<void>> = [];
  private readonly context = new AsyncLocalStorage<boolean>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private detach: Array<() => void> = [];
  private probeFlight: Promise<void> | null = null;
  private sealed = false;
  private stopped = false;
  private resetSettings = false;
  readonly path: string;
  constructor(private root: string, private changed: (event: { category: RecoveryCategory; path: string; held: boolean }) => void,
    private probe = inspectRecoveryProcesses, private exited = recoveryProcessHasExited) { this.path = join(root, "recovery-pending.json"); }
  get pending() { return this.state.files.length > 0; }
  get notices(): Array<"settings" | "custody"> { return [...(this.resetSettings ? ["settings" as const] : []), ...(this.pending ? ["custody" as const] : [])]; }
  get blocked() { return (!this.sealed || this.pending || this.deferred.length > 0) && !this.context.getStore(); }
  private write(state = this.state) { return durableReplaceFile(this.path, JSON.stringify(state) + "\n"); }
  async initialize() {
    const content = await readFile(this.path, "utf8").catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
    if (content !== null) {
      try { this.state = schema.parse(JSON.parse(content)); }
      catch {
        const evidence = this.probe(content);
        this.state = { version: 1, files: ["recovery-pending.json"], ...evidence };
        await quarantineDurableFile(this.path); await this.write();
      }
    }
    this.detach = [installDurableRecovery((path, content) => this.recover(path, content)), installRecoveryGate({
      blocked: () => this.blocked, defer: task => { this.deferred.push(task); } })];
    this.timer = setInterval(() => void this.check().catch(error => console.error("Custody recovery probe failed", error)), 2000); this.timer.unref();
  }
  // Start release only once every startup owner has registered its held writer.
  sealStartup() { this.sealed = true; void this.check().catch(error => console.error("Custody recovery probe failed", error)); }
  private recover(path: string, content: string | null): Promise<DurableRecovery | null> {
    return this.queue.enqueue(async () => {
      const local = relative(this.root, path);
      if (local.startsWith("..") || isAbsolute(local)) return null;
      const category = recoveryCategory(local.split("\\").join("/"));
      if (content === null && !this.state.files.includes(local) && !(category === "custody" && this.state.files.includes("recovery-pending.json"))) return null;
      let held = false;
      if (category === "custody") {
        const evidence = this.probe(content ?? "");
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
    if (this.stopped || !this.sealed || !this.pending && !this.deferred.length && !this.released.length) return Promise.resolve();
    if (this.probeFlight) return this.probeFlight;
    const flight = this.queue.enqueue(async () => {
      if (this.stopped) return;
      if (this.pending) {
        if (this.state.processes.some(process => !this.exited(process))) return;
        const inventory = this.probe();
        if (!inventory.complete || inventory.processes.length) return;
      }
      // The process inventory is complete before empty custody can become writable.
      await this.context.run(true, async () => {
        while (!this.stopped && this.released.length) { await this.released[0]!(); this.released.shift(); }
        while (!this.stopped && this.deferred.length) { await this.deferred[0]!(); this.deferred.shift(); }
      });
      if (this.stopped) return;
      const cleared = { version: 1 as const, files: [], processes: [], complete: true };
      await this.write(cleared); this.state = cleared;
      this.changed({ category: "custody", path: "", held: false });
    });
    this.probeFlight = flight;
    void flight.finally(() => { if (this.probeFlight === flight) this.probeFlight = null; }).catch(() => {});
    return flight;
  }
  async stop() { this.stopped = true; if (this.timer) clearInterval(this.timer); await this.queue.flush(); }
  async close() { await this.stop(); this.queue.close(); this.detach.forEach(detach => detach()); this.detach = []; }
}
