/**
 * [INPUT]: Depends on the current account/binding, original Base/Project writers, shared admission gate and existing scope drainage.
 * [OUTPUT]: Provides account-fenced Base comparisons, durable decisions and explicitly requested independent candidate copies.
 * [POS]: Main-owned presentation service; no second outbox, network writer or raw renderer operation exists.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { BaseStore } from "../../bases/base-store";
import type { CloudAccountState } from "../../../../shared/cloud-ipc";
import { baseSyncReviewSchema, type baseSyncReviewRequestSchema, type baseCandidateRequestSchema, type baseCandidateDecisionSchema, type baseCandidateCopySchema } from "../../../../shared/cloud/base";
import type { SyncBindingStore } from "../sync/account/binding";
import type { ProjectStore } from "../../projects/store/project-store";
import type { AdmissionGate } from "../../lifecycle/admission-gate";
import { ChangeNotifier } from "../runtime/notifier";
type Account = { snapshot(): CloudAccountState; subscribe(changed: (state: CloudAccountState) => void): () => void };
export class CloudBaseReview {
  private closed = false;
  private readonly listeners = new ChangeNotifier();
  private readonly unsubscribe: () => void;
  constructor(private readonly ports: { config: CloudBuildConfig; binding: SyncBindingStore; account: Account; store: BaseStore;
    recovery?: { projects: ProjectStore; gate: AdmissionGate };
    own(activity: { close(): Promise<void> }): () => void; changed(): void }) {
    this.unsubscribe = ports.account.subscribe(() => this.changed());
  }
  private scope(expectedUserId: string) {
    const account = this.ports.account.snapshot(), binding = this.ports.binding.snapshot();
    if (this.closed || !binding || binding.phase === "closing" || expectedUserId !== binding.userId || account.profile?.userId !== binding.userId ||
      account.deviceId !== binding.deviceId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("BASE_ACCOUNT_UNAVAILABLE");
    return { environment: this.ports.config.environmentId, userId: binding.userId };
  }
  review(input: z.infer<typeof baseSyncReviewRequestSchema>) {
    const scope = this.scope(input.expectedUserId);
    const value = this.ports.store.sync.review(input.ownerKey, input.baseId, scope, input.afterId);
    return value ? baseSyncReviewSchema.parse({ ...value, connected: this.ports.account.snapshot().status === "ready", paused: this.ports.binding.snapshot()!.paused }) : null;
  }
  detail(input: z.infer<typeof baseCandidateRequestSchema>) {
    return this.ports.store.sync.candidate(input.ownerKey, input.baseId, this.scope(input.expectedUserId), input.operationId, input.offset);
  }
  async decide(input: z.infer<typeof baseCandidateDecisionSchema>) {
    const scope = this.scope(input.expectedUserId);
    let work!: Promise<unknown>;
    const release = this.ports.own({ close: async () => { await work?.catch(() => {}); } });
    try {
      work = this.ports.store.sync.resolve(input.ownerKey, input.baseId, scope, input.operationId,
        input.action === "restore" ? { kind: "restore", operationId: randomUUID(), expectedPayloadHash: input.payloadHash } :
          { kind: "discard", expectedPayloadHash: input.payloadHash });
      await work; this.scope(input.expectedUserId); this.ports.changed();
    } finally { release(); }
  }
  async copy(input: z.infer<typeof baseCandidateCopySchema>) {
    const scope = this.scope(input.expectedUserId), { store, recovery } = this.ports;
    if (!recovery) throw new Error("BASE_CANDIDATE_COPY_UNAVAILABLE");
    const plan = store.sync.copyPlan(scope, input);
    let work!: Promise<{ ownerKey: string; baseId: string }>;
    const release = this.ports.own({ close: async () => { await work?.catch(() => {}); } });
    try {
      work = recovery.gate.runExclusiveAll([input.ownerKey, `base:${input.baseId}`, `project:${plan.projectId}`], async () => {
        this.scope(input.expectedUserId);
        const current = await store.sync.prepareCopy(scope, input); this.scope(input.expectedUserId);
        if (current.candidate.copiedTo && !recovery.projects.get(current.projectId)) throw new Error("BASE_CANDIDATE_COPY_PROJECT_CHANGED");
        await recovery.projects.portable.ensureRecoveredBaseProject(scope, current); this.scope(input.expectedUserId);
        await store.sync.copyCandidate(scope, input); this.scope(input.expectedUserId);
        this.ports.changed(); return { ownerKey: `project:${current.projectId}`, baseId: current.baseId };
      });
      return await work;
    } finally { release(); }
  }
  subscribe = this.listeners.subscribe;
  changed() { this.listeners.notify(); }
  close() { this.closed = true; this.unsubscribe(); this.listeners.clear(); }
}
