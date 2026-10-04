/**
 * [INPUT]: Depends on Node child_process/crypto and the DescendantRegistry
 * [OUTPUT]: Provides HostProcessPort (spawn — plain descendant or custody mode through the guardian — write/kill/cleanHost for processes a utility host needs; cleanHost also waits for and settles children still launching, B-02, and touches only the host life it ends, B2-03; spawn reports a custody child's launch identity and settleCustody answers its one shared settlement, B2-01) and hostChildEnvironment
 * [POS]: The only way a utility host gets a child process: main starts it detached (its own group), records PGID + birth durably before acknowledging, and relays stdio as messages; the bridge never holds a process handle
 */
import type { AgentTurnCustodyDependency } from "../../../../shared/apps/model/app-lifecycle";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { DescendantRegistry } from "./descendants";
import type { HostToBridge } from "../protocol";
import type { HostProcessCustody } from "./custody";

/* Children get an explicit environment, never main's: account tokens and proxy credentials stay in main. */
const INHERITED = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL"] as const;
export function hostChildEnvironment(extra: Record<string, string> = {}) {
  const base = Object.fromEntries(INHERITED.flatMap(name => process.env[name] ? [[name, process.env[name]!]] : []));
  return { ...base, ...extra };
}

/** `life` is the host's cleanup generation when the child was launched: a cleanup only ever touches the life it ends (B2-03). */
type Owned = { hostId: string; life: number; child: ChildProcessWithoutNullStreams; custody: boolean };

export class HostProcessPort {
  private readonly processes = new Map<string, Owned>();
  /* B-02: launches still in flight, by host, and each host's cleanup generation: a child whose host was cleaned while it launched is settled, never registered. */
  private readonly launching = new Map<string, { hostId: string; life: number; done: Promise<unknown> }>();
  private readonly generations = new Map<string, number>();
  /* B2-01: a custody child's settlement, shared by its exit handler, its host's cleanup and the turn that owns it; bounded. */
  private readonly settlements = new Map<string, Promise<{ phase: string } | null>>();

  constructor(private readonly registry: DescendantRegistry, private readonly custody: HostProcessCustody) {}

  /**
   * `custody: true` is the Provider turn path: the process starts through the existing guardian under the host custody
   * journal (same intent/owned/activated rule and `converge` release as Agent turns); otherwise it is a plain host
   * descendant in the PGID + birth journal. Either way the host only ever sees stdio messages.
   */
  async spawn(hostId: string, spec: { command: string; args: string[]; cwd?: string; env?: Record<string, string>; custody?: boolean; exactEnv?: boolean; requestId?: string | null;
    dependencies?: readonly AgentTurnCustodyDependency[] },
    sink: (message: HostToBridge) => void): Promise<{ processId: string; pid: number; identity: { pid: number; birthIdentity: string } | null }> {
    const processId = `proc_${randomBytes(12).toString("base64url")}`;
    const life = this.generations.get(hostId) ?? 0;
    const launch = this.launch(hostId, processId, spec, life);
    this.launching.set(processId, { hostId, life, done: launch.catch(() => undefined) });
    let child: ChildProcessWithoutNullStreams, pid: number, identity: { pid: number; birthIdentity: string } | null;
    try { ({ child, pid, identity } = await launch); } finally { this.launching.delete(processId); }
    this.processes.set(processId, { hostId, life, child, custody: Boolean(spec.custody) });
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (data: string) => sink({ t: "process-event", processId, stream, data }));
    }
    child.stdin.on("error", () => {});
    child.once("exit", (code, signal) => {
      this.processes.delete(processId);
      sink({ t: "process-exit", processId, code, signal });
      /* The leader is gone; anything left in its group belongs to it and is cleaned with it. */
      void this.release(processId, Boolean(spec.custody)).catch(cause => console.warn("[host] descendant cleanup failed", cause));
    });
    return { processId, pid, identity };
  }

  /** The child itself, durable before it is acknowledged; one whose host was cleaned meanwhile is settled here and refused. */
  private async launch(hostId: string, processId: string, spec: Parameters<HostProcessPort["spawn"]>[1], generation: number) {
    let child: ChildProcessWithoutNullStreams, pid: number, identity: { pid: number; birthIdentity: string } | null = null;
    if (spec.custody) {
      const launched = await this.custody.launch({ hostId, processId, requestId: spec.requestId ?? null, dependencies: spec.dependencies ?? [],
        request: { command: spec.command, args: spec.args, cwd: spec.cwd ?? homedir(), env: spec.exactEnv ? { ...spec.env } : hostChildEnvironment(spec.env) } });
      child = launched.child; pid = launched.pid; identity = launched.identity;
    } else {
      child = spawn(spec.command, spec.args, { cwd: spec.cwd, env: hostChildEnvironment(spec.env), detached: true, stdio: ["pipe", "pipe", "pipe"] });
      await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
      pid = child.pid!;
      await this.registry.record({ hostId, processId, pid, command: spec.command });
    }
    if ((this.generations.get(hostId) ?? 0) !== generation) {
      /* A plain descendant is recorded, so the host cleanup that is waiting for this launch cleans its group next. */
      if (spec.custody) await this.settle(processId).catch(cause => console.warn("[host] late child settle failed", cause));
      throw new Error("host exited while the process was starting");
    }
    return { child, pid, identity };
  }

  write(hostId: string, processId: string, data: string | undefined, end: boolean | undefined) {
    const owned = this.owned(hostId, processId);
    if (data !== undefined) owned.child.stdin.write(data);
    if (end) owned.child.stdin.end();
  }

  async kill(hostId: string, processId: string) {
    const owned = this.owned(hostId, processId);
    await this.release(processId, owned.custody);
  }

  private release(processId: string, custody: boolean) {
    return custody ? this.settle(processId) : this.registry.forget(processId);
  }

  /** One settlement per custody child, whoever asks first; later callers get the same answer (B2-01). */
  private settle(processId: string) {
    let settling = this.settlements.get(processId);
    if (!settling) {
      settling = this.custody.settle(processId);
      this.settlements.set(processId, settling);
      if (this.settlements.size > 256) this.settlements.delete(this.settlements.keys().next().value!);
    }
    return settling;
  }

  /** The turn's view of its custody child (B2-01): `released` only when custody proved the group gone. */
  async settleCustody(processId: string): Promise<"released" | "unconfirmed"> {
    const entry = await this.settle(processId).catch(() => null);
    return entry?.phase === "released" ? "released" : "unconfirmed";
  }

  /**
   * Every group this life of the host started, whether or not its leader is still running, including children still launching
   * (B-02). The life is fixed before anything is awaited: a replacement host of the same id that launches meanwhile is a new
   * life, and nothing of it is settled, cleaned or forgotten here (B2-03).
   */
  async cleanHost(hostId: string) {
    const life = this.generations.get(hostId) ?? 0;
    this.generations.set(hostId, life + 1);
    const ofLife = (item: { hostId: string; life: number }) => item.hostId === hostId && item.life === life;
    const pending = [...this.launching].filter(([, item]) => ofLife(item));
    await Promise.all(pending.map(([, item]) => item.done));
    const owned = [...this.processes].filter(([, item]) => ofLife(item));
    await Promise.allSettled(owned.filter(([, item]) => item.custody).map(([processId]) => this.settle(processId)));
    /* Records left by earlier failed cleanups are retried; only what a newer life is running or launching is kept out. */
    const newer = [...this.processes, ...this.launching].filter(([, item]) => item.hostId === hostId && item.life > life).map(([processId]) => processId);
    const results = await this.registry.cleanHost(hostId, new Set(newer));
    for (const [processId] of owned) this.processes.delete(processId);
    return results;
  }

  private owned(hostId: string, processId: string) {
    const owned = this.processes.get(processId);
    if (!owned || owned.hostId !== hostId) throw new Error("process not owned by this host");
    return owned;
  }
}
