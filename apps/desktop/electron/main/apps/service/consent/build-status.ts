/**
 * [INPUT]: Depends on the App store's records and change feed, the consent broker's pending request and outcome, and the closed build-status
 *          body of cloud-protocol apps/build-status.
 * [OUTPUT]: Provides AppBuildTracker: each App's current build status (start, status, onChange, consentChanged, compatibilityBlocked, close). Also projects owner-controlled enabled state and revision through the encrypted operational stream.
 * [POS]: apps/service/consent's one projection of waiting and building (U06-d, Q-U8): the store says building / failed / ready, the broker
 *        says waiting and how it was decided, the installer's compatibility report says a build that the store rolled back. The cloud side
 *        only seals and publishes what this says.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import type { AppBuildStatus } from "@ai-chat/cloud-protocol/apps/build-status/model";
import type { AppRecord } from "../../../../../shared/ipc/apps/apps-ipc";
import type { ConsentOutcome, PendingConsent } from "./broker";

type Ports = Readonly<{
  list(): readonly AppRecord[];
  watch(listener: (record: AppRecord) => void): () => void;
  consent: Readonly<{ pending(appId: string): PendingConsent | null; outcome(appId: string): ConsentOutcome | null }>;
  now(): number;
  attemptId(): string;
}>;
type Attempt = { attemptId: string; startedAt: number; compatibilityBlocked: boolean; declined: AppBuildStatus["outcome"] };

export class AppBuildTracker {
  private readonly attempts = new Map<string, Attempt>();
  private readonly records = new Map<string, AppRecord>();
  private readonly statuses = new Map<string, AppBuildStatus>();
  private readonly listeners = new Set<(appId: string) => void>();
  private detach: (() => void) | null = null;
  constructor(private readonly ports: Ports) {}

  start() {
    for (const record of this.ports.list()) this.observe(record);
    this.detach ??= this.ports.watch(record => this.observe(record));
  }
  close() { this.detach?.(); this.detach = null; }
  status(appId: string): AppBuildStatus | null { return this.statuses.get(appId) ?? null; }
  onChange(listener: (appId: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  consentChanged(appId: string) {
    const attempt = this.attempts.get(appId), outcome = this.ports.consent.outcome(appId);
    if (attempt && outcome?.decision === "declined")
      attempt.declined = { kind: "declined", by: outcome.by, ...(outcome.deviceName ? { deviceName: outcome.deviceName } : {}) };
    this.refresh(appId);
  }
  /** The installer rolled the record back to its previous version: the attempt failed although the store reads ready. */
  compatibilityBlocked(appId: string) {
    const attempt = this.attempts.get(appId);
    if (attempt) { attempt.compatibilityBlocked = true; this.refresh(appId); }
  }

  private observe(record: AppRecord) {
    const previous = this.records.get(record.id);
    this.records.set(record.id, record);
    const starting = record.state === "updating" && previous?.state !== "updating";
    // After a restart a failed build has no attempt in memory; it gets one so the failure has an identity.
    if (starting || record.state === "update-failed" && !this.attempts.has(record.id))
      this.attempts.set(record.id, { attemptId: this.ports.attemptId(), startedAt: this.ports.now(), compatibilityBlocked: false, declined: null });
    this.refresh(record.id);
  }
  private refresh(appId: string) {
    const record = this.records.get(appId);
    if (!record) return;
    const next = this.compute(record), current = this.statuses.get(appId);
    const same = current && canonicalJson({ ...current, updatedAt: 0 }) === canonicalJson({ ...next, updatedAt: 0 });
    if (same) return;
    this.statuses.set(appId, next);
    for (const listener of this.listeners) listener(appId);
  }
  private compute(record: AppRecord): AppBuildStatus {
    const attempt = this.attempts.get(record.id) ?? null;
    const base = { appId: record.id, enabled: record.enabled, enabledRevision: record.enabledRevision, attemptId: attempt?.attemptId ?? null, startedAt: attempt?.startedAt ?? null, updatedAt: this.ports.now(), confirm: null };
    if (record.state === "updating") {
      const pending = this.ports.consent.pending(record.id);
      return pending ? { ...base, phase: "waiting-confirm", confirm: { requestId: pending.requestId, extensionCount: pending.extensionCount, expiresAt: pending.expiresAt },
        outcome: null } : { ...base, phase: "building", outcome: attempt?.declined ?? null };
    }
    if (record.state === "update-failed")
      return { ...base, phase: "failed", outcome: { kind: "failed", code: record.lastError?.reason === "interrupted" ? "interrupted" : "build-failed" } };
    if (attempt?.compatibilityBlocked) return { ...base, phase: "failed", outcome: { kind: "failed", code: "compatibility-blocked" } };
    return { ...base, phase: "idle", outcome: attempt?.declined ?? null };
  }
}
