/**
 * [INPUT]: Depends on the native bridge port (preferences, Dock reload, agent relay), the user-level recovery files, the recovery registration port, and caller-supplied admission facts.
 * [OUTPUT]: Provides ReplacementController: the single-flight takeover state machine (inactive → preparing → active → restoring → inactive/suspended) with journal-first two-key writes under a verified lock, read-back, conditional restore verified by read-back (a failed restore keeps journal, lock and registration and blocks any new takeover), external-change surrender, agent handshake and lease renewal, previous-owner recovery, and registration lifetime separated from takeover lifetime.
 * [POS]: system-dock/replacement owner of every system Dock side effect (INV-02..05); windows never write preferences and the recovery agent never runs business actions.
 */

import { randomUUID } from "node:crypto";
import type { RecoveryRegistration, ReplacementPhase, SuspendReason } from "../../../../shared/system-dock/local-state";
import type { NativePort } from "../native/bridge";
import type { AgentPayload, DockPrefKey, PrefValue } from "../native/protocol";
import { planRestore, type ManagedField, type RecoveryFiles, type RecoveryJournal, type RecoveryOwner } from "./journal";
import type { RegistrationPort } from "./registration";

/** Target values: the system Dock stays auto-hidden and effectively never reveals on hover (DCK-39 verifies the exact delay). */
export const TAKEOVER_VALUES: Record<DockPrefKey, { type: "bool" | "real"; value: boolean | number }> = {
  autohide: { type: "bool", value: true },
  "autohide-delay": { type: "real", value: 1000 },
};
export const LEASE = { renewMs: 5_000, agentTimeoutMs: 4_000, watchMs: 10_000 } as const;
export type ReplacementAdmission = { ok: true } | { ok: false; reason: SuspendReason };
export type ReplacementStatus = { phase: ReplacementPhase; reason: SuspendReason | null; registration: RecoveryRegistration | "unsupported";
  lastResult: "none" | "restored" | "kept-external" | "failed" };
export type ReplacementPorts = {
  native: NativePort;
  files: RecoveryFiles;
  registration: RegistrationPort;
  machService: string | null;
  owner: { installation: string; profile: string; appPath: string; consentVersion: number };
  /** Enabled, replacement intent, consent, non-empty layout, reachable bar and a selected screen (INV-01/07/10). */
  admission(): ReplacementAdmission;
  alive(owner: RecoveryOwner): Promise<boolean>;
  changed(status: ReplacementStatus): void;
  now?: () => number;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
};

type Takeover = { operationId: string; epoch: number; owner: RecoveryOwner; journal: RecoveryJournal; persisted: boolean };

export class ReplacementController {
  private phase: ReplacementPhase = "inactive";
  private reason: SuspendReason | null = null;
  private lastResult: ReplacementStatus["lastResult"] = "none";
  private takeover: Takeover | null = null;
  private flight: Promise<void> = Promise.resolve();
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private registrationFact: RecoveryRegistration | "unsupported" = "unsupported";
  private closed = false;
  constructor(private readonly ports: ReplacementPorts) {}
  status(): ReplacementStatus { return { phase: this.phase, reason: this.reason, registration: this.registrationFact, lastResult: this.lastResult }; }
  /** Serializes every transition; a later request observes the settled result of the previous one. */
  private serial(job: () => Promise<void>) {
    const run = this.flight.then(job, job);
    this.flight = run.catch(() => undefined);
    return run;
  }
  private set(phase: ReplacementPhase, reason: SuspendReason | null = null) {
    this.phase = phase; this.reason = reason;
    this.ports.changed(this.status());
  }
  private now() { return (this.ports.now ?? Date.now)(); }
  readRegistration(): RecoveryRegistration | "unsupported" {
    try { this.registrationFact = this.ports.registration.read(); } catch { this.registrationFact = "not-found"; }
    return this.registrationFact;
  }
  /** Registration follows the enabled intent only (D7/INV-02); called on confirmation, never on ordinary start. */
  register(): RecoveryRegistration | "unsupported" {
    try { this.registrationFact = this.ports.registration.register(); } catch { this.registrationFact = "not-found"; }
    this.ports.changed(this.status());
    return this.registrationFact;
  }
  /** Explicit disable / coexist / feature removal: restore first, then unregister (INV-02/03). */
  unregister(): Promise<void> {
    return this.serial(async () => {
      await this.restoreNow("inactive", null);
      if (this.takeover || this.phase === "restoring") return;
      // A journal on disk (e.g. a restore that failed at start-up) is still an unrestored system Dock, whoever wrote it.
      if (!await this.settleLeftoverJournal()) return;
      try { this.registrationFact = this.ports.registration.unregister(); } catch { this.registrationFact = "not-found"; }
      this.ports.changed(this.status());
    });
  }
  /** Startup: a journal left by a dead owner is restored before anything else may take over (INV-03/05). */
  recoverPrevious(): Promise<void> {
    return this.serial(async () => {
      this.lastResult = (await this.ports.files.readLastResult())?.result ?? "none";
      await this.settleLeftoverJournal();
    });
  }
  /**
   * Restores a journal no live process owns, under the lock so two starting instances never restore it twice.
   * Returns true only when no unrestored journal remains; otherwise the pause names why (INV-03/04/05).
   */
  private async settleLeftoverJournal(): Promise<boolean> {
    const { files } = this.ports;
    if ((await files.readJournal()).kind === "none") return true;
    const holding = await files.holds();
    if (!holding) {
      const lock = await files.acquireLock(this.lockOwner());
      if (!lock.ok) { this.set("suspended", "owned-elsewhere"); return false; }
    }
    try {
      const read = await files.readJournal();
      if (read.kind === "none") return true;
      if (read.kind === "corrupt") { this.set("suspended", "journal-corrupt"); return false; }
      if (await this.ports.alive(read.journal.owner)) { this.set("suspended", "owned-elsewhere"); return false; }
      if (!await this.applyRestore(read.journal, "main")) { this.set("suspended", "write-failed"); return false; }
      return true;
    } finally { if (!holding && !this.takeover) await files.releaseLock(); }
  }
  /** Diagnostic identity written into the lock file when no takeover owner exists yet. */
  private lockOwner(): RecoveryOwner {
    return { installation: this.ports.owner.installation, profile: this.ports.owner.profile, pid: process.pid, startedAt: 0, appPath: this.ports.owner.appPath };
  }
  prepare(): Promise<void> {
    return this.serial(async () => {
      // A pause only ends through resume(): the user decides when to hand the system Dock back (INV-04).
      if (this.closed || this.phase === "active" || this.phase === "suspended") return;
      // A takeover whose restore failed is still owned: retry it, and never take over on top of it (INV-03).
      if (this.takeover) { await this.restoreNow("inactive", null); if (this.takeover) return; }
      const admission = this.ports.admission();
      if (!admission.ok) { this.set("inactive", admission.reason); return; }
      if (this.readRegistration() !== "enabled") { this.set("suspended", "registration-disabled"); return; }
      this.set("preparing");
      try { await this.takeOver(); }
      catch (cause) {
        console.warn("[system-dock] takeover failed", cause);
        const settled = !this.takeover;
        await this.restoreNow("suspended", this.reason ?? "write-failed");
        // Failed before any takeover existed: nothing to restore, so the lock is not ours to keep.
        if (settled) await this.ports.files.releaseLock();
      }
    });
  }
  private async takeOver() {
    const { native, files } = this.ports;
    const hello = await native.request({ op: "hello" });
    const owner: RecoveryOwner = { installation: this.ports.owner.installation, profile: this.ports.owner.profile, pid: hello.parentPid,
      startedAt: hello.parentStartedAt, appPath: this.ports.owner.appPath };
    // The lock comes first: only its holder may read, restore or replace the shared journal.
    const lock = await files.acquireLock(owner);
    if (!lock.ok) { this.reason = "owned-elsewhere"; throw new Error("OWNED_ELSEWHERE"); }
    const previous = await files.readJournal();
    if (previous.kind === "corrupt") { this.reason = "journal-corrupt"; throw new Error("JOURNAL_CORRUPT"); }
    if (previous.kind === "ok") {
      if (await this.ports.alive(previous.journal.owner) && !sameOwner(previous.journal.owner, owner)) { this.reason = "owned-elsewhere"; throw new Error("OWNED_ELSEWHERE"); }
      // Its originals are the only record of the user's settings: a failed restore must not be overwritten by a new journal.
      if (!await this.applyRestore(previous.journal, "main")) { this.reason = "write-failed"; throw new Error("PREVIOUS_RESTORE_FAILED"); }
    }
    const epoch = await files.nextEpoch();
    const operationId = randomUUID();
    const journal: RecoveryJournal = { version: 1, operationId, ownershipEpoch: epoch, phase: "preparing", consentVersion: this.ports.owner.consentVersion,
      owner, fields: [], reload: false, updatedAt: this.now() };
    // Held before the handshake so every later failure releases the lock and the agent lease.
    const takeover: Takeover = { operationId, epoch, owner, journal, persisted: false };
    this.takeover = takeover;
    // The independent recovery process must observe this owner before any preference changes (INV-03).
    const reply = await this.agent("prepare", takeover);
    if (!reply.ok || !reply.observedOwner) { this.reason = reply.code === "owned-elsewhere" ? "owned-elsewhere" : "agent-unhealthy"; throw new Error(`AGENT_${reply.code}`); }
    const current = await native.request({ op: "dock-prefs-read" });
    const fields: ManagedField[] = [];
    for (const key of Object.keys(TAKEOVER_VALUES) as DockPrefKey[]) {
      const value = current[key];
      // Managed or unknown-typed values are not ours to overwrite (INV-04).
      if (value.forced) { this.reason = "managed"; throw new Error("PREFERENCE_MANAGED"); }
      if (value.present && !acceptable(key, value)) { this.reason = "managed"; throw new Error("PREFERENCE_UNKNOWN_TYPE"); }
      const target = TAKEOVER_VALUES[key];
      fields.push({ key, originalPresent: value.present, originalType: value.type, originalValue: value.value, writtenType: target.type, writtenValue: target.value, written: false });
    }
    journal.fields = fields; journal.updatedAt = this.now();
    await this.assertLock();
    await files.writeJournal(journal); takeover.persisted = true;
    for (const field of fields) {
      const target = TAKEOVER_VALUES[field.key];
      if (field.originalPresent && sameValue(current[field.key], target.value)) continue;
      // Record intent-to-write first: a crash between the two leaves a journal the agent can undo.
      await this.assertLock();
      field.written = true; journal.updatedAt = this.now(); await files.writeJournal(journal);
      const after = await native.request({ op: "dock-prefs-write", key: field.key, action: "set", type: target.type, value: target.value });
      if (!sameValue(after[field.key], target.value)) { this.reason = "write-failed"; throw new Error("READBACK_MISMATCH"); }
    }
    if (fields.some((field) => field.written)) {
      journal.reload = true; await files.writeJournal(journal);
      await native.request({ op: "dock-reload" });
    }
    const admission = this.ports.admission();
    if (!admission.ok) { this.reason = admission.reason; throw new Error("ADMISSION_LOST"); }
    journal.phase = "active"; journal.updatedAt = this.now(); await files.writeJournal(journal);
    this.startLease();
    this.set("active");
  }
  /** Every call carries a fresh nonce: the agent rejects replays, so a lease can never be renewed by an old message. */
  private agent(method: "prepare" | "renew" | "release" | "status", input: { operationId: string; epoch: number; owner: RecoveryOwner }) {
    if (!this.ports.machService) return Promise.resolve({ ok: false, agentPid: null, code: "unreachable" as const, observedOwner: false, leaseExpiresAt: null });
    const payload: AgentPayload = { operationId: input.operationId, ownershipEpoch: input.epoch, ownerPid: input.owner.pid, ownerStartedAt: input.owner.startedAt,
      installation: input.owner.installation, nonce: randomUUID(), journalPath: this.ports.files.journalPath };
    return this.ports.native.request({ op: "agent-call", method, machService: this.ports.machService, payload, timeoutMs: LEASE.agentTimeoutMs }, LEASE.agentTimeoutMs + 1_000);
  }
  /** Another instance can only have taken the lock through a lost reclaim race; it then owns the system Dock, not us. */
  private async assertLock() {
    if (!await this.ports.files.holds()) { this.reason = "owned-elsewhere"; throw new Error("LOCK_LOST"); }
  }
  private startLease() {
    const timers = this.ports.timers ?? { setInterval, clearInterval };
    this.stopLease();
    this.renewTimer = timers.setInterval(() => { void this.renew(); }, LEASE.renewMs);
    this.watchTimer = timers.setInterval(() => { void this.watchExternal(); }, LEASE.watchMs);
  }
  private stopLease() {
    const timers = this.ports.timers ?? { setInterval, clearInterval };
    if (this.renewTimer) timers.clearInterval(this.renewTimer);
    if (this.watchTimer) timers.clearInterval(this.watchTimer);
    this.renewTimer = null; this.watchTimer = null;
  }
  private async renew() {
    const takeover = this.takeover;
    if (!takeover || this.phase !== "active") return;
    try {
      const reply = await this.agent("renew", takeover);
      if (reply.ok && await this.ports.files.holds()) return;
    } catch { /* fall through: an unreachable watchdog means no guarantee */ }
    if (this.takeover === takeover) void this.suspend("agent-unhealthy");
  }
  /** A value the user changed (e.g. Option-Command-D) is theirs: stop owning it and pause (INV-04). */
  private async watchExternal() {
    const takeover = this.takeover;
    if (!takeover || this.phase !== "active") return;
    let current: Record<DockPrefKey, PrefValue>;
    try { current = await this.ports.native.request({ op: "dock-prefs-read" }); } catch { return; }
    const changed = takeover.journal.fields.some((field) => field.written && !sameValue(current[field.key], field.writtenValue));
    if (changed && this.takeover === takeover) void this.suspend("external-change");
  }
  observePreferences(current: Record<DockPrefKey, PrefValue>) {
    const takeover = this.takeover;
    if (!takeover || this.phase !== "active") return;
    if (takeover.journal.fields.some((field) => field.written && !sameValue(current[field.key], field.writtenValue))) void this.suspend("external-change");
  }
  /** Ordinary quit, update, temporary hide: end this takeover but keep intent and registration (INV-02). */
  release(): Promise<void> {
    // A pause outlives quit/hide: only resume() or an explicit disable clears it.
    return this.serial(() => this.phase === "suspended" && !this.takeover ? Promise.resolve() : this.restoreNow("inactive", null));
  }
  suspend(reason: SuspendReason): Promise<void> { return this.serial(() => this.restoreNow("suspended", reason)); }
  /** Resuming after a pause is always an explicit local user action (INV-04). */
  resume(): Promise<void> {
    return this.serial(async () => { if (this.phase === "suspended") this.set("inactive"); }).then(() => this.prepare());
  }
  private async restoreNow(next: "inactive" | "suspended", reason: SuspendReason | null) {
    const takeover = this.takeover;
    this.stopLease();
    if (!takeover) {
      if (this.phase !== next || this.reason !== reason) this.set(next, reason);
      return;
    }
    this.set("restoring", reason);
    // Nothing reached disk or the system yet: there is nothing to restore and no result to report.
    const ok = takeover.persisted ? await this.applyRestore(takeover.journal, "main") : true;
    if (!ok) {
      /* The system Dock may still be suppressed. Keep the journal, the lock and the takeover (so unregister and a
         new takeover both refuse), and stop renewing: the agent's lease then expires and it restores on its own. */
      this.set("suspended", "write-failed");
      return;
    }
    try { await this.agent("release", takeover); } catch { /* the agent also stops on journal removal and lease expiry */ }
    await this.ports.files.releaseLock();
    this.takeover = null;
    this.set(next, reason);
  }
  /** Returns false when restoration could not be verified; the journal then stays as evidence (INV-03). */
  private async applyRestore(journal: RecoveryJournal, by: "main" | "agent"): Promise<boolean> {
    const { native, files } = this.ports;
    // The recovery agent may already have restored this operation (e.g. after our lease lapsed); its result stands.
    const onDisk = await files.readJournal();
    if (onDisk.kind === "none" || (onDisk.kind === "ok" && onDisk.journal.operationId !== journal.operationId)) {
      this.lastResult = (await files.readLastResult())?.result ?? this.lastResult;
      return true;
    }
    try {
      journal.phase = "restoring"; journal.updatedAt = this.now();
      await files.writeJournal(journal);
      const current = await native.request({ op: "dock-prefs-read" });
      const steps = planRestore(journal.fields, current);
      let changed = false;
      for (const step of steps) {
        if (step.action === "keep-external") continue;
        changed = true;
        await native.request(step.action === "delete" ? { op: "dock-prefs-write", key: step.key, action: "delete" }
          : { op: "dock-prefs-write", key: step.key, action: "set", type: step.type, value: step.value });
      }
      if (changed) {
        // Report success only for what the preferences now actually hold.
        const after = await native.request({ op: "dock-prefs-read" });
        for (const step of steps) {
          if (step.action === "delete" && after[step.key].present) throw new Error("RESTORE_READBACK_MISMATCH");
          if (step.action === "set" && !sameValue(after[step.key], step.value)) throw new Error("RESTORE_READBACK_MISMATCH");
        }
        await native.request({ op: "dock-reload" });
      }
      const result = steps.some((step) => step.action === "keep-external") ? "kept-external" : "restored";
      await files.writeLastResult({ version: 1, operationId: journal.operationId, result, by, at: this.now() });
      await files.clearJournal();
      this.lastResult = result;
      return true;
    } catch (cause) {
      console.warn("[system-dock] restore failed", cause);
      this.lastResult = "failed";
      /* The agent skips "restoring" on lease expiry so it never races a live restore. Once ours has failed, hand the
         journal back as "active": with renewals stopped, the lease lapses and the agent restores (INV-03). */
      journal.phase = "active"; journal.updatedAt = this.now();
      await files.writeJournal(journal).catch(() => undefined);
      return false;
    }
  }
  /** Quit path: bounded, restore-first, never waits for any agent grace period. */
  async close(): Promise<void> {
    this.closed = true;
    await this.serial(() => this.restoreNow("inactive", null));
  }
}

function sameOwner(a: RecoveryOwner, b: RecoveryOwner) { return a.pid === b.pid && a.startedAt === b.startedAt && a.profile === b.profile; }
function acceptable(key: DockPrefKey, value: PrefValue) {
  return key === "autohide" ? value.type === "bool" : value.type === "real" || value.type === "int";
}
function sameValue(value: PrefValue, target: boolean | number) {
  if (!value.present) return false;
  if (typeof target === "boolean") return value.type === "bool" && value.value === target;
  return (value.type === "real" || value.type === "int") && typeof value.value === "number" && Math.abs(value.value - target) < 1e-9;
}
