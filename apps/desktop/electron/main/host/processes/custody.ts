/**
 * [INPUT]: Depends on zod, Node path/crypto, DurableJson, the custody kernel (CustodyAttachment/converge) and its guardian control channel
 * [OUTPUT]: Provides HostProcessCustody: launch a host-requested process through the existing guardian with a durable journal (answering its recorded pid + birth, and the Agent turn's request id it runs for), settle it, find what it still holds for a request (heldBy), and reconcile whatever a crashed main left behind (quarantined entries included), journaling each process's dependencies (App references, extension plans): admission refuses an inactive one, and startup lets a request's go once every process that ran for it is settled and something of it is still pinned, while a quarantined one keeps the request pinned The guardian runs on the bundled Node (bundledGuardian, TASK-35).
 * [POS]: The process port's custody mode (host-runtime.md §4): a Provider turn process that a bridge asks for keeps the same guardian, the same intent → owned → activated journal and the same `converge` release rule as Agent turns and App servers; this file is only the third journal driver, the kernel is unchanged
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { DurableJson } from "../../persistence/durable-json";
import { CustodyAttachment, converge, type CustodyLaunchRequest, type CustodyRuntimeOptions } from "../../custody/attachment";
import { GuardianControlChannel } from "../../custody/control-channel";
import type { AgentTurnCustodyDependency, ProcessIdentity } from "../../../../shared/apps/model/app-lifecycle";
import { custodyDependencySchema } from "../../backends/jobs/custody/agent-turn-custody-journal";
import { bundledGuardian } from "../../runtime";
import { awaitRecoveredAuthority } from "../../persistence/recovery-policy";

const PHASES = ["intent", "aborted", "owned", "activation-authorized", "activated", "release-pending", "released", "quarantined"] as const;
type Phase = (typeof PHASES)[number];
const identitySchema = z.object({ pid: z.number().int().positive(), processGroupId: z.number().int().positive(), birthIdentity: z.string().min(1),
  executableIdentity: z.string() }).strict();
const entrySchema = z.object({ custodyId: z.string().min(1), controlNonce: z.string().uuid(), phase: z.enum(PHASES), revision: z.number().int().min(0),
  processIdentity: identitySchema.optional(), hostId: z.string().min(1).max(128), processId: z.string().min(1).max(64),
  command: z.string().max(4096), reason: z.string().max(64).nullable(), createdAt: z.number().int().min(0),
  /* The Agent turn this process runs for (its request id), so a quarantined one stays findable after the turn left the registry; null
     for a process started without a turn (readiness). */
  requestId: z.string().min(1).max(128).nullable().default(null),
  /* What the process's work depends on (App references, extension plans), journaled with it: a quarantined entry keeps them pinned, a
     released or aborted one lets them go at the next start's converge (TASK-11 flip, ruling (a); D33 as agent-turn custody had it). */
  dependencies: z.array(custodyDependencySchema).max(64).default([]) }).strict();
const ledgerSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(4_096) }).strict();
export type HostCustodyEntry = z.infer<typeof entrySchema>;

const SETTLED: readonly Phase[] = ["aborted", "released"];
/** Terminal entries kept for inspection; older ones leave the journal so it stays bounded. */
const SETTLED_KEPT = 256;

class HostCustodyJournal {
  private readonly ledger: DurableJson<z.infer<typeof ledgerSchema>>;
  constructor(path: string) { this.ledger = new DurableJson(path, ledgerSchema, () => ({ version: 1 as const, entries: [] })); }
  initialize() { return this.ledger.initialize(); }
  list() { return structuredClone(this.ledger.snapshot().entries); }
  createIntent(input: Pick<HostCustodyEntry, "hostId" | "processId" | "command" | "requestId" | "dependencies">) {
    const entry: HostCustodyEntry = { ...input, custodyId: randomUUID(), controlNonce: randomUUID(), phase: "intent",
      revision: 0, reason: null, createdAt: Date.now() };
    return this.ledger.mutate(state => { state.entries.push(entry); return structuredClone(entry); });
  }
  /* Every transition names the revision it was read at: a late command never moves an entry it did not see (kernel contract). */
  private step(custodyId: string, revision: number, from: readonly Phase[], to: Phase, patch: Partial<HostCustodyEntry> = {}) {
    return this.ledger.mutate(state => {
      const entry = state.entries.find(item => item.custodyId === custodyId);
      if (!entry || entry.revision !== revision || !from.includes(entry.phase)) throw new Error(`host custody ${custodyId}: stale ${entry?.phase ?? "missing"}@${entry?.revision} → ${to}`);
      Object.assign(entry, patch, { phase: to, revision: revision + 1 });
      if (SETTLED.includes(to)) {
        const settled = state.entries.filter(item => SETTLED.includes(item.phase));
        if (settled.length > SETTLED_KEPT) state.entries = state.entries.filter(item => !settled.slice(0, settled.length - SETTLED_KEPT).includes(item));
      }
      return structuredClone(entry);
    });
  }
  markOwned = (id: string, revision: number, identity: ProcessIdentity) => this.step(id, revision, ["intent"], "owned", { processIdentity: identity });
  authorizeActivation = (id: string, revision: number) => this.step(id, revision, ["owned"], "activation-authorized");
  markActivated = (id: string, revision: number) => this.step(id, revision, ["activation-authorized"], "activated");
  beginRelease = (id: string, revision: number) => this.step(id, revision, ["owned", "activation-authorized", "activated", "quarantined"], "release-pending");
  release = (id: string, revision: number) => this.step(id, revision, ["release-pending"], "released");
  abortBeforeOwned = (id: string, revision: number, reason: string) => this.step(id, revision, ["intent"], "aborted", { reason });
  quarantine = (id: string, revision: number, reason: string) => this.step(id, revision, ["release-pending", "owned", "activation-authorized", "activated"], "quarantined", { reason });
  close() { return this.ledger.closeAndFlush(); }
}

export type HostCustodyLaunch = Readonly<{ child: ReturnType<CustodyAttachment<HostCustodyEntry>["launch"]>; pid: number; identity: { pid: number; birthIdentity: string } }>;

/** How main answers for a process's dependencies: whether one is still live (admission), and letting a settled request's go (converge). */
export type HostCustodyDependencyPorts = Readonly<{
  active(dependency: AgentTurnCustodyDependency): boolean;
  release(requestId: string): Promise<void>;
}>;
/** One previous-life entry's converge: what it settled to, and the request and dependencies it carried. */
export type HostCustodyOutcome = Readonly<{ custodyId: string; phase: Phase; requestId: string | null; dependencies: readonly AgentTurnCustodyDependency[] }>;

export class HostProcessCustody {
  private readonly journal: HostCustodyJournal;
  private readonly channel: GuardianControlChannel;
  private readonly options: CustodyRuntimeOptions;
  private readonly live = new Map<string, CustodyAttachment<HostCustodyEntry>>();

  private dependencyPorts: HostCustodyDependencyPorts | null = null;

  /** How long a launch waits for startup recovery before it is refused by name (RECOVERY_WAIT_MS unless a test shortens it). */
  private readonly recoveryWaitMs: number | undefined;
  constructor(input: { userData: string; mainDirectory: string; handshakeTimeoutMs?: number; recoveryWaitMs?: number;
    runtime?: Partial<Pick<CustodyRuntimeOptions, "observeBirth" | "stopGroup" | "guardian">> }) {
    this.recoveryWaitMs = input.recoveryWaitMs;
    const root = join(input.userData, "host-custody");
    this.journal = new HostCustodyJournal(join(root, "journal.json"));
    this.channel = new GuardianControlChannel(join(root, "guardian.sock"));
    this.options = { controlRoot: root, guardian: bundledGuardian, handshakeTimeoutMs: input.handshakeTimeoutMs, ...input.runtime };
  }

  /** Before any host starts: an intent never became a process (abort); anything owned, and anything a previous start quarantined, is
      converged again — released once proven gone, else quarantined (the bridge-enable gate; the Agent side does the same). */
  /** Late-bound: the App service answers for dependencies; bound before `initialize`, which releases a settled request's. */
  bindDependencies(ports: HostCustodyDependencyPorts) { this.dependencyPorts = ports; }

  async initialize(): Promise<HostCustodyOutcome[]> {
    await this.journal.initialize();
    await this.channel.listen();
    const outcomes: HostCustodyOutcome[] = [];
    for (const entry of this.journal.list().filter(item => !SETTLED.includes(item.phase))) {
      const settled = entry.phase === "intent" ? await this.journal.abortBeforeOwned(entry.custodyId, entry.revision, "owner-no-longer-live")
        : await converge(this.journal as never, this.options, entry);
      outcomes.push({ custodyId: settled.custodyId, phase: settled.phase, requestId: settled.requestId, dependencies: settled.dependencies as readonly AgentTurnCustodyDependency[] });
    }
    await this.releaseSettledRequests();
    return outcomes;
  }

  /**
   * D33: a request's dependencies go once every process that ran for it is proven gone (released) or never owned (aborted); one still
   * quarantined (a retry's, say) keeps the whole request pinned. Only what is still pinned is released, so a request the live path
   * already released is never released again, and one whose settle landed just before main died is released now.
   */
  private async releaseSettledRequests() {
    const ports = this.dependencyPorts;
    if (!ports) return;
    const requests = new Map<string, HostCustodyEntry[]>();
    for (const item of this.journal.list()) if (item.requestId) requests.set(item.requestId, [...requests.get(item.requestId) ?? [], item]);
    for (const [requestId, entries] of requests) {
      if (!entries.every(item => SETTLED.includes(item.phase))) continue;
      const dependencies = entries.flatMap(item => item.dependencies as readonly AgentTurnCustodyDependency[]);
      if (dependencies.some(dependency => ports.active(dependency))) await ports.release(requestId);
    }
  }

  /** Resolves once the guardian reported the real process identity and confirmed delivery; the child's 0/1/2 are the process's. */
  async launch(input: { hostId: string; processId: string; requestId?: string | null; dependencies?: readonly AgentTurnCustodyDependency[];
    request: CustodyLaunchRequest }): Promise<HostCustodyLaunch> {
    /* Before any intent: a launch during startup recovery waits for the gate (bounded) or is refused by name, never journaled. */
    await awaitRecoveredAuthority({ timeoutMs: this.recoveryWaitMs });
    const dependencies = [...input.dependencies ?? []];
    /* Admission before the durable intent: a dependency already released must not come back pinned by a late launch. */
    for (const dependency of dependencies) {
      if (!this.dependencyPorts) throw new Error(`host custody: ${dependency.kind} has no dependency port, the launch is refused`);
      if (!this.dependencyPorts.active(dependency)) throw new Error(`CUSTODY_DEPENDENCY_INACTIVE: ${dependency.kind} is released or invalid`);
    }
    const entry = await this.journal.createIntent({ hostId: input.hostId, processId: input.processId, command: input.request.command,
      requestId: input.requestId ?? null, dependencies: dependencies as HostCustodyEntry["dependencies"] });
    const attachment = new CustodyAttachment(this.journal as never, this.channel, this.options, entry);
    const child = attachment.launch(input.request);
    this.live.set(input.processId, attachment);
    try { await attachment.delivered; }
    catch (cause) { this.live.delete(input.processId); await attachment.settle().catch(() => undefined); throw cause; }
    const { pid, birthIdentity } = attachment.entry.processIdentity!;
    return { child, pid, identity: { pid, birthIdentity } };
  }

  /** Durable intent first, then the kernel's converge: gone → released, reused PID → quarantined and never signalled. */
  async settle(processId: string): Promise<HostCustodyEntry | null> {
    const attachment = this.live.get(processId);
    if (!attachment) return null;
    this.live.delete(processId);
    await attachment.beginRelease();
    return attachment.settle();
  }

  /**
   * What host custody still holds for one Agent turn's request: null once released or aborted; otherwise its launch identity (null
   * before it is owned). A quarantined entry holds until a later start proves it gone, so an unconfirmed turn stays "may still run"
   * after it left the turn registry and across a restart (the bridge-enable gate, codex-bridge.md §4).
   */
  heldBy(requestId: string): { identity: { pid: number; birthIdentity: string } | null } | null {
    const entry = this.journal.list().filter(item => item.requestId === requestId && !SETTLED.includes(item.phase)).at(-1);
    return entry ? { identity: entry.processIdentity ? { pid: entry.processIdentity.pid, birthIdentity: entry.processIdentity.birthIdentity } : null } : null;
  }

  entries() { return this.journal.list(); }

  async close() {
    await Promise.allSettled([...this.live.keys()].map(processId => this.settle(processId)));
    await this.channel.close();
    await this.journal.close();
  }
}
