/**
 * [INPUT]: Depends on consent-bound account state, fixed lifecycle identities and the existing Chat/Base/App/Project Store facades; request-bound single-record decoders.
 * [OUTPUT]: Freezes conversion candidates, delivers outside domain locks and adopts receipt-confirmed Base and App identities.
 * [POS]: Main Base conversion adapter; the original classification outbox and lifecycle journal own all recovery state.
 */
import { z } from "zod";
import { appItemSchema, appPackageSchema } from "@ai-chat/cloud-protocol/apps/model";
import { portableProjectSchema } from "@ai-chat/cloud-protocol";
import { openProjectHeadForRequest } from "@ai-chat/cloud-protocol/projects/encrypted/client";
import { openAppHeadForRequest, openAppPackageForRequest } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { appDescriptor } from "../apps/descriptor";
import type { ChatCipherPort } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { projectChatClassification, sameScope, syncScopeSchema, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { type SaveCloudPromotion, type SaveCloudPromotionInput } from "../../../apps/conversion/cloud-promotion";
import { CloudPromotionDelivery, type ProjectBasePromotionInput } from "../../../bases/store/promotion/port";
import { confirmedBasePromotionSchema, type ConfirmedBasePromotion } from "../../../bases/store/promotion/cloud";
import { chatFactsSchema } from "../../../chats/chat-schema";
import { moveChatProjectRecord, withFactRevision } from "../../../chats/chat-record-lifecycle";
import type { LifecycleIntentStore } from "../../../lifecycle/intent-store";
import type { LifecycleIntent } from "../../../lifecycle/intent-types";
import type { CloudAccountService } from "../../runtime/service";
import type { AccountTransport } from "../../runtime/transport";
import type { SyncBindingStore } from "../account/binding";
import type { CleanupOwners } from "../account/cleanup/plan";
import { DesktopClassificationPublisher } from "../chats/classification/publisher";

const adoptionSchema = z.object({ scope: syncScopeSchema, operationId: z.string(), receiptHash: z.string(),
  app: appItemSchema, project: portableProjectSchema, package: appPackageSchema.nullable() }).strict();
type Ports = { config: CloudBuildConfig; deviceId: string; crypto(): ChatCipherPort; binding: SyncBindingStore; owners: CleanupOwners; journal: LifecycleIntentStore;
  account(): ReturnType<CloudAccountService["snapshot"]>; transport: Pick<AccountTransport, "query" | "mutate">;
  own(activity: { close(): Promise<void> }): () => unknown; changed(): void };
export class DesktopBaseConversion implements SaveCloudPromotion {
  constructor(private readonly ports: Ports) {}
  private current(scope: SyncScope) {
    const binding = this.ports.binding.snapshot(), account = this.ports.account();
    if (!binding || binding.phase !== "active" || binding.paused || binding.userId !== scope.userId ||
      binding.deviceId !== this.ports.deviceId || scope.environment !== this.ports.config.environmentId ||
      account.status !== "ready" || account.profile?.userId !== scope.userId) throw new Error("CLOUD_PROMOTION_ACCOUNT_NOT_READY");
  }
  async prepare(input: SaveCloudPromotionInput) {
    if (!this.ports.binding.snapshot() && !input.intent.recoveryState.cloudPromotionScope) return null;
    const child = await this.ports.journal.createChild({ parentIntentId: input.intent.intentId, linkKey: "promotionIntentId", kind: "base-promotion",
      requestId: input.identity.promotionRequestId, input: { chatId: input.chat.id, projectId: input.identity.projectId } });
    return this.prepareTransfer(input.intent, input.chat, child.intentId, { kind: "app", projectId: input.identity.projectId,
      appId: input.identity.appId, displayName: input.name });
  }
  async prepareProject(input: ProjectBasePromotionInput) {
    const chat = this.ports.owners.chats.getMetadata(input.chatId);
    if (!chat || chat.context.kind !== "ordinary" || chat.projectId !== input.projectId) throw new Error("BASE_PROMOTION_CHAT_CHANGED");
    return this.prepareTransfer(input.intent, chat, input.intent.intentId, { kind: "project", projectId: input.projectId });
  }
  private async prepareTransfer(intent: LifecycleIntent, chat: SaveCloudPromotionInput["chat"], exportIntentId: string,
    destination: NonNullable<import("@ai-chat/cloud-protocol/chats/classification").ChatClassificationOperation["basePromotion"]>["destination"]) {
    const { owners, binding, journal } = this.ports;
    const bound = binding.snapshot();
    if (!bound && !intent.recoveryState.cloudPromotionScope) return null;
    const scope = syncScopeSchema.parse(intent.recoveryState.cloudPromotionScope ??
      { environment: this.ports.config.environmentId, userId: bound?.userId });
    this.current(scope);
    const operationId = hashChatContent([intent.kind, scope, intent.intentId]);
    let candidate = await this.candidate(scope, operationId);
    if (!candidate) {
      const base = owners.bases.get(`chat:${chat.id}`, chat.incarnationId);
      if (!base) throw new Error("BASE_PROMOTION_SOURCE_UNAVAILABLE");
      const envelope = owners.bases.sync.read(`chat:${chat.id}`, base.meta.ownerInstanceId);
      if (!envelope.scope || !sameScope(envelope.scope, scope) || !envelope.confirmed || envelope.tombstones.includes("base")) throw new Error("BASE_PROMOTION_SYNC_NOT_READY");
      const project = owners.projects.get(destination.projectId);
      if (!project || project.role !== "workspace" || (destination.kind === "app" ?
        project.workspaceBinding.kind !== "app" || project.workspaceBinding.appId !== destination.appId :
        project.workspaceBinding.kind === "app" || !project.sync?.confirmed || project.sync.confirmed.appId !== null || project.sync.deleted || !sameScope(project.sync.scope, scope))) throw new Error("BASE_PROMOTION_PROJECT_CHANGED");
      const { preview: _preview, ...facts } = chat;
      const next = withFactRevision(facts, moveChatProjectRecord(facts, { expectedSource: facts.projectId, target: project.id, appRole: destination.kind === "app" ? "edit" : null }, {
        isAppProject: id => owners.projects.get(id)?.workspaceBinding.kind === "app",
        appForProject: id => destination.kind === "app" && id === project.id ? { appId: destination.appId, editableSource: true } : null,
      }));
      await journal.advance(intent.intentId, intent.phase, { cloudPromotionScope: scope });
      this.current(scope);
      await owners.chats.sync.mutate(scope, hashChatContent([operationId, "propose"]), { type: "propose-classification", lifecycleOperationId: operationId,
        expectedRevision: facts.chatRecordRevision, previous: projectChatClassification(facts), facts: chatFactsSchema.parse(next),
        basePromotion: { baseId: base.meta.ownerInstanceId, expectedRevision: envelope.confirmed.cloudRevision,
          destination } });
      candidate = await this.candidate(scope, operationId);
    }
    if (!candidate?.operation_json) throw new Error("APP_PROMOTION_CANDIDATE_UNAVAILABLE");
    const operation = chatClassificationOperationSchema.parse(JSON.parse(candidate.operation_json));
    if (canonicalJson(operation.basePromotion?.destination) !== canonicalJson(destination)) throw new Error("APP_PROMOTION_CANDIDATE_CHANGED");
    if (candidate.state === "conflicted" || candidate.state === "discarded") throw new Error("APP_PROMOTION_CONFLICT_REQUIRES_REVIEW");
    this.current(scope);
    try { await owners.bases.sync.freezePromotion(`chat:${chat.id}`, scope, exportIntentId, operation); }
    catch (error) {
      // A baseline advanced before delivery can only reject this original CAS; obtain its durable decision.
      if (error instanceof Error && error.message === "BASE_PROMOTION_BASELINE_CHANGED" && !candidate.receipt_json) {
        throw new CloudPromotionDelivery(() => this.deliver(scope, operationId, intent.intentId));
      }
      throw error;
    }
    this.ports.changed();
    if (!candidate.receipt_json) throw new CloudPromotionDelivery(() => this.deliver(scope, operationId, intent.intentId));
    return confirmedBasePromotionSchema.parse({ scope, operation, receipt: chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json)) });
  }
  private async candidate(scope: SyncScope, lifecycleOperationId: string) {
    const result = await this.ports.owners.chats.sync.read(scope, { type: "classification", lifecycleOperationId });
    if (result.type !== "classification") throw new Error("APP_PROMOTION_CANDIDATE_UNAVAILABLE");
    return result.value;
  }
  private async deliver(scope: SyncScope, operationId: string, intentId: string) {
    this.current(scope); let cancelled = false, flight: Promise<void> = Promise.resolve();
    const release = this.ports.own({ close: async () => { cancelled = true; await flight.catch(() => {}); } });
    const current = () => { if (cancelled) throw new Error("CLOUD_PROMOTION_DELIVERY_CLOSED"); this.current(scope); };
    try {
      flight = (async () => {
        const outbox = await this.ports.owners.chats.sync.read(scope, { type: "outbox", afterId: null, limit: 1, id: operationId }); current();
        if (outbox.type !== "outbox") throw new Error("APP_PROMOTION_OUTBOX_UNAVAILABLE");
        const item = outbox.value.find(item => item.id === operationId);
        if (!item) throw new Error("APP_PROMOTION_OUTBOX_UNAVAILABLE");
        await new DesktopClassificationPublisher({ ...this.ports, scope, store: this.ports.owners.chats.sync, current }).confirmPromotion([item]);
        await this.stageAdoption(scope, operationId, intentId); current();
      })();
      await flight;
    } finally { release(); }
  }
  private async stageAdoption(scope: SyncScope, operationId: string, intentId: string) {
    this.current(scope);
    const { journal } = this.ports, candidate = await this.candidate(scope, operationId);
    if (!candidate?.receipt_json || !candidate.operation_json) throw new Error("APP_PROMOTION_RECEIPT_UNAVAILABLE");
    const receipt = chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json));
    if (receipt.status !== "applied") return;
    const proof = confirmedBasePromotionSchema.parse({ scope, operation: JSON.parse(candidate.operation_json), receipt }), transfer = proof.operation.basePromotion!;
    if (transfer.destination.kind !== "app") return;
    const intent = await journal.getById(intentId); if (!intent) throw new Error("APP_PROMOTION_INTENT_UNAVAILABLE");
    if (intent.recoveryState.cloudPromotionAdoption) {
      const existing = adoptionSchema.parse(intent.recoveryState.cloudPromotionAdoption);
      if (!sameScope(existing.scope, scope) || existing.operationId !== operationId || existing.receiptHash !== hashChatContent(receipt)) throw new Error("APP_PROMOTION_ADOPTION_CHANGED");
      return;
    }
    const { transport } = this.ports, destination = transfer.destination, crypto = this.ports.crypto(), signal = new AbortController().signal;
    const header = { ...protocolHeader(this.ports.config), expectedUserId: scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const appWire = await transport.query("apps/api:get", { ...header, appId: destination.appId }); this.current(scope);
    const projectWire = await transport.query("projects/sync:head", { ...header, projectId: destination.projectId }); this.current(scope);
    if (!appWire || !projectWire) throw new Error("APP_PROMOTION_DESTINATION_UNAVAILABLE");
    const app = await openAppHeadForRequest(appWire, destination.appId, crypto, signal), project = await openProjectHeadForRequest(projectWire, destination.projectId, crypto, signal); this.current(scope);
    if (app.projectId !== destination.projectId || app.baseId !== transfer.baseId || project.appId !== destination.appId) throw new Error("APP_PROMOTION_DESTINATION_CHANGED");
    const packageWire = app.activePackageRevision ? await transport.query("apps/packages:get", { ...header, appId: app.appId, packageRevision: app.activePackageRevision }) : null;
    this.current(scope);
    if (app.activePackageRevision && !packageWire) throw new Error("APP_PROMOTION_PACKAGE_UNAVAILABLE");
    const version = packageWire ? await openAppPackageForRequest(packageWire, destination.appId, app.activePackageRevision!, crypto, signal) : null; this.current(scope);
    const saved = adoptionSchema.parse({ scope, operationId, receiptHash: hashChatContent(receipt), app, project, package: version });
    const latest = await journal.getById(intentId); if (!latest) throw new Error("APP_PROMOTION_INTENT_UNAVAILABLE");
    this.current(scope); await journal.advance(intentId, latest.phase, { cloudPromotionAdoption: saved }); this.current(scope);
  }
  async commit(proof: ConfirmedBasePromotion) {
    this.current(proof.scope);
    await this.ports.owners.chats.sync.mutate(proof.scope, hashChatContent(["classification-commit", proof.operation.lifecycleOperationId]),
      { type: "commit-classification", lifecycleOperationId: proof.operation.lifecycleOperationId });
    this.current(proof.scope); this.ports.changed();
  }
  async adopt(proofInput: ConfirmedBasePromotion) {
    const proof = confirmedBasePromotionSchema.parse(proofInput), transfer = proof.operation.basePromotion!;
    if (transfer.destination.kind !== "app") throw new Error("APP_PROMOTION_DESTINATION_CHANGED");
    this.current(proof.scope);
    const { owners, journal } = this.ports, destination = transfer.destination;
    const intent = (await journal.listPending()).find(item => {
      const saved = confirmedBasePromotionSchema.safeParse(item.recoveryState.cloudPromotion);
      return saved.success && saved.data.operation.lifecycleOperationId === proof.operation.lifecycleOperationId && sameScope(saved.data.scope, proof.scope);
    });
    if (!intent) throw new Error("APP_PROMOTION_INTENT_UNAVAILABLE");
    if (!intent.recoveryState.cloudPromotionAdoption) throw new CloudPromotionDelivery(() => this.stageAdoption(proof.scope, proof.operation.lifecycleOperationId, intent.intentId));
    const saved = adoptionSchema.parse(intent.recoveryState.cloudPromotionAdoption);
    if (!sameScope(saved.scope, proof.scope) || saved.operationId !== proof.operation.lifecycleOperationId || saved.receiptHash !== hashChatContent(proof.receipt)) throw new Error("APP_PROMOTION_ADOPTION_CHANGED");
    const { app, project, package: version } = saved;
    const base = owners.bases.get(`project:${destination.projectId}`, transfer.baseId);
    if (!base || owners.bases.sync.read(`project:${destination.projectId}`, transfer.baseId).tombstones.includes("base")) throw new Error("APP_PROMOTION_BASE_UNAVAILABLE");
    await owners.projects.portable.acceptPromotion(proof, project);
    this.current(proof.scope);
    const { syncGeneration: _generation, syncHash: _hash, ...meta } = base.meta;
    await owners.apps.portable.publication.capture({ scope: proof.scope, manifestId: this.ports.binding.snapshot()!.manifestId, source: null, promotion: proof,
      operation: { kind: "create", operationId: proof.operation.lifecycleOperationId, appId: destination.appId, projectId: destination.projectId,
        baseId: transfer.baseId, displayName: destination.displayName, metaJson: canonicalJson({ ...meta, revision: 0, rowsGeneration: 0, galleryGeneration: 0, historyGeneration: 0 }) } });
    await owners.apps.portable.publication.checkpoint(proof.scope, destination.appId, {}, appDescriptor(app, version));
    this.current(proof.scope); this.ports.changed();
  }
  async discard(intent: LifecycleIntent, candidateHash: string, recordDecision: () => Promise<void>) {
    const scope = syncScopeSchema.parse(intent.recoveryState.cloudPromotionScope);
    this.current(scope);
    const operationId = hashChatContent([intent.kind, scope, intent.intentId]), candidate = await this.candidate(scope, operationId);
    if (!candidate?.receipt_json || !candidate.operation_json || candidate.candidate_hash !== candidateHash ||
      !["conflicted", "discarded"].includes(candidate.state)) throw new Error("APP_PROMOTION_REVIEW_CHANGED");
    const operation = chatClassificationOperationSchema.parse(JSON.parse(candidate.operation_json));
    const receipt = chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json));
    if (receipt.status === "applied") throw new Error("APP_PROMOTION_ALREADY_CONFIRMED");
    const childId = intent.kind === "base-promotion" ? intent.intentId : intent.recoveryState.promotionIntentId;
    if (typeof childId !== "string") throw new Error("APP_PROMOTION_CHILD_UNAVAILABLE");
    await recordDecision(); this.current(scope);
    await this.ports.owners.chats.sync.mutate(scope, hashChatContent([operationId, "discard", candidateHash]), {
      type: "discard-classification", lifecycleOperationId: operationId, candidateHash });
    await this.ports.owners.bases.sync.releasePromotion(`chat:${operation.chatId}`, scope, childId, operation, receipt);
    if (intent.kind === "save-as-app") await this.ports.journal.settle(childId, { status: "rolled-back", error: { code: "APP_PROMOTION_DISCARDED", message: "The original Base was kept." } });
    this.ports.changed();
  }
}
