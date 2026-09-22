/**
 * [INPUT]: Depends on canonical facts, the portable classification projection and SQLite custody.
 * [OUTPUT]: Freezes scoped lifecycle candidates/outbox operations, validates CAS and Project rescue or Base transfer proofs, and adopts reviewed facts without changing imported Chat lifecycle.
 * [POS]: Classification authority beneath ChatRepository; ordinary fact writes cannot invoke conversion.
 */
import { chatFactsSchema } from "../../chat-schema";
import type { ChatFacts } from "../../chat-summary";
import { canonicalJson, projectChatClassification, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { digest, json, type Row } from "../repository/codec";
import type { CloudAction } from "./protocol";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema, hashChatClassificationOperation } from "@ai-chat/cloud-protocol/chats/classification";
import { matchesBasePromotionProof } from "@ai-chat/cloud-protocol/apps/promotion";
import { readMetadataState, acceptMetadataHead } from "./delivery/metadata-confirm";
import { enqueueSource, releaseRoot } from "./retention";

export class ClassificationTransactions {
  constructor(private db: SqliteDatabase, private reader: ChatRepositoryReader, private writer: ChatRecordWriter, private now: () => number) {}
  get(operationId: string) {
    return this.db.prepare("SELECT * FROM chat_classification_candidates WHERE operation_id=?").get(operationId) as Row | undefined;
  }
  propose(action: Extract<CloudAction, { type: "propose-classification" }>, deviceId: string, scope: SyncScope | null) {
    if (action.basePromotion && !scope) throw new Error("Base promotion proof requires a cloud scope");
    const facts = chatFactsSchema.parse(action.facts) as ChatFacts;
    const candidate = json(facts), candidateHash = digest(candidate), existing = this.get(action.lifecycleOperationId);
    if (existing) {
      if (existing.environment !== (scope?.environment ?? null) || existing.user_id !== (scope?.userId ?? null) ||
          existing.candidate_hash !== candidateHash || existing.expected_revision !== action.expectedRevision ||
          existing.old_classification_json !== canonicalJson(action.previous) ||
          canonicalJson(existing.operation_json ? JSON.parse(String(existing.operation_json)).basePromotion ?? null : null) !==
            canonicalJson(action.basePromotion ?? null) ||
          canonicalJson(existing.operation_json ? JSON.parse(String(existing.operation_json)).projectRescue ?? null : null) !==
            canonicalJson(action.projectRescue ?? null)) throw new Error("Classification intent was reused");
      return { lifecycleOperationId: action.lifecycleOperationId, candidateHash, state: String(existing.state) };
    }
    const current = this.reader.listMetadata(deviceId, facts.id)[0];
    if (!current || current.chatRecordRevision !== action.expectedRevision ||
      current.incarnationId !== facts.incarnationId || facts.chatRecordRevision !== action.expectedRevision + 1 ||
      facts.chatMessageRevision !== current.chatMessageRevision ||
      canonicalJson(projectChatClassification(current)) !== canonicalJson(action.previous)) throw new Error("REVISION_STALE");
    if (current.readOnlyReason === "external-readonly" &&
      (facts.projectId !== null || facts.appRole !== null || facts.context.kind !== "ordinary")) {
      throw new Error("Readonly classification only supports Project detachment");
    }
    const rescue = action.projectRescue;
    if (scope && action.previous.conversationKind !== "ordinary" && facts.context.kind === "ordinary" && !rescue) throw new Error("Project rescue intent is required");
    if (rescue && (!scope || action.basePromotion || current.readOnlyReason || current.executionKind === "managed-worktree" || current.projectId !== rescue.projectId ||
      facts.context.kind !== "ordinary" || facts.projectId !== null || facts.appRole !== null || facts.session !== null)) {
      throw new Error("Invalid Project rescue");
    }
    if (facts.agent !== current.agent || facts.agentRevision !== current.agentRevision ||
      canonicalJson(facts.options) !== canonicalJson(current.options) || canonicalJson(facts.session) !== canonicalJson(rescue ? null : current.session)) {
      throw new Error("Classification conversion cannot change execution facts");
    }
    const omitClassification = (value: ChatFacts) => {
      const { context: _context, projectId: _project, appRole: _role, grants: _grants, grantRevision: _grantsRevision, chatRecordRevision: _revision, updatedAt: _time, ...rest } = value;
      return rescue ? { ...rest, session: null } : rest;
    };
    if (facts.grants.some(grant => !current.grants.some(old => canonicalJson(old) === canonicalJson(grant))) ||
        facts.grantRevision < current.grantRevision) throw new Error("Classification conversion cannot grant new authority");
    const { preview: _preview, ...rawCurrent } = current;
    const currentFacts = chatFactsSchema.parse(rawCurrent);
    const left = omitClassification(facts), right = omitClassification(currentFacts);
    const changed = Object.keys({ ...left, ...right }).filter(key => canonicalJson((left as Record<string, unknown>)[key] ?? null) !== canonicalJson((right as Record<string, unknown>)[key] ?? null));
    if (changed.length) throw new Error(`Classification conversion cannot alter other Chat facts: ${changed.join(", ")}`);
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(facts.id)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    let operation = null;
    if (scope) {
      const state = readMetadataState(this.db, scope, facts.id), head = state.head ? cloudChatHeadSchema.parse(state.head) : null;
      if (!head || state.deleted || state.conflicted || head.openTurnId || head.ownerDeviceId !== deviceId ||
          head.chat.incarnationId !== facts.incarnationId || canonicalJson(head.chat.classification) !== canonicalJson(action.previous) ||
          head.executionPreparation && head.executionPreparation.state !== "ready" ||
          this.db.prepare("SELECT 1 FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=? LIMIT 1")
            .get(scope.environment, scope.userId, facts.id)) throw new Error("CHAT_CLASSIFICATION_NOT_READY");
      operation = chatClassificationOperationSchema.parse({ lifecycleOperationId: action.lifecycleOperationId, chatId: facts.id,
        incarnationId: facts.incarnationId, candidateHash, payloadHash: "0".repeat(64), expectedRevision: head.chat.cloudRevision,
        previous: action.previous, next: projectChatClassification(facts),
        ...(action.basePromotion ? { basePromotion: action.basePromotion } : {}),
        ...(rescue ? { projectRescue: rescue } : {}) });
      operation.payloadHash = hashChatClassificationOperation(operation);
    }
    this.db.prepare(`INSERT INTO chat_classification_candidates(operation_id,chat_id,environment,user_id,
      expected_revision,old_classification_json,previous_json,candidate_json,candidate_hash,operation_json,state) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
      action.lifecycleOperationId, facts.id, scope?.environment ?? null, scope?.userId ?? null,
      action.expectedRevision, canonicalJson(action.previous), json(currentFacts), candidate, candidateHash, operation ? json(operation) : null, scope ? "pending" : "confirmed");
    if (scope && operation) enqueueSource(this.db, { id: action.lifecycleOperationId, scope, chatId: facts.id, entityKind: "chat",
      kind: "classification", revision: facts.chatRecordRevision, payload: operation, now: this.now() });
    return { lifecycleOperationId: action.lifecycleOperationId, candidateHash, state: scope ? "pending" : "confirmed" };
  }
  confirm(action: Extract<CloudAction, { type: "confirm-classification" }>, scope: SyncScope, deviceId: string) {
    const candidate = this.get(action.lifecycleOperationId);
    const receipt = chatClassificationReceiptSchema.parse(action.receipt);
    if (!candidate || candidate.environment !== scope.environment || candidate.user_id !== scope.userId ||
      candidate.operation_id !== receipt.lifecycleOperationId || candidate.candidate_hash !== receipt.candidateHash || receipt.sourceDeviceId !== deviceId) throw new Error("Classification receipt identity mismatch");
    if (candidate.receipt_json) {
      if (String(candidate.receipt_json) !== json(receipt)) throw new Error("Classification receipt changed");
      return { state: String(candidate.state) };
    }
    const operation = chatClassificationOperationSchema.parse(JSON.parse(String(candidate.operation_json)));
    if (receipt.chatId !== operation.chatId || receipt.payloadHash !== operation.payloadHash || receipt.expectedRevision !== operation.expectedRevision ||
        receipt.head && receipt.head.chat.incarnationId !== operation.incarnationId ||
        receipt.status === "applied" && (!receipt.head || receipt.head.chat.cloudRevision !== operation.expectedRevision + 1 ||
          canonicalJson(receipt.head.chat.classification) !== canonicalJson(operation.next) ||
          !matchesBasePromotionProof(operation.basePromotion, receipt.basePromotion)) ||
        receipt.status !== "applied" && receipt.basePromotion !== undefined) throw new Error("Classification receipt identity mismatch");
    const state = receipt.status === "applied" ? "confirmed" : "conflicted";
    this.db.prepare("UPDATE chat_classification_candidates SET receipt_json=?,state=? WHERE operation_id=?")
      .run(json(receipt), state, action.lifecycleOperationId);
    if (state === "conflicted") this.db.prepare("UPDATE cloud_outbox SET last_error='CHAT_CLASSIFICATION_CONFLICT' WHERE id=? AND kind='classification'").run(action.lifecycleOperationId);
    return { state };
  }
  discard(action: Extract<CloudAction, { type: "discard-classification" }>, scope: SyncScope) {
    const candidate = this.get(action.lifecycleOperationId);
    if (!candidate || candidate.environment !== scope.environment || candidate.user_id !== scope.userId ||
        candidate.candidate_hash !== action.candidateHash || !["conflicted", "discarded"].includes(String(candidate.state))) throw new Error("CLASSIFICATION_DISCARD_REVIEW_CHANGED");
    this.db.prepare("UPDATE chat_classification_candidates SET state='discarded' WHERE operation_id=?").run(action.lifecycleOperationId);
    this.retire(candidate);
    return { state: "discarded" as const };
  }
  commit(operationId: string, deviceId: string, scope: SyncScope | null) {
    const candidate = this.get(operationId);
    if (!candidate || candidate.environment !== (scope?.environment ?? null) || candidate.user_id !== (scope?.userId ?? null)) throw new Error("Classification candidate is unavailable");
    if (candidate.state === "committed") return { chatId: String(candidate.chat_id), state: "committed" };
    if (candidate.state !== "confirmed") throw new Error("Classification confirmation is required");
    const facts = chatFactsSchema.parse(JSON.parse(String(candidate.candidate_json))) as ChatFacts;
    const current = this.reader.listMetadata(deviceId, facts.id)[0];
    if (!current || current.chatRecordRevision !== candidate.expected_revision ||
      canonicalJson(projectChatClassification(current)) !== candidate.old_classification_json) throw new Error("REVISION_STALE");
    let head = null;
    if (scope) {
      const receipt = chatClassificationReceiptSchema.parse(JSON.parse(String(candidate.receipt_json)));
      const latest = readMetadataState(this.db, scope, facts.id);
      if (latest.deleted || receipt.sourceDeviceId !== deviceId || receipt.status !== "applied" || !receipt.head) throw new Error("Classification confirmation is required");
      head = latest.head && latest.head.catalogRevision > receipt.head.catalogRevision ? cloudChatHeadSchema.parse(latest.head) : receipt.head;
      if (head.ownerDeviceId !== deviceId ||
          canonicalJson(head.chat.classification) !== canonicalJson(projectChatClassification(facts))) throw new Error("CHAT_CLASSIFICATION_REMOTE_CHANGED");
    }
    if (current.readOnlyReason === "external-readonly") {
      // Detachment changes local membership only; imported Chats have no executable Home binding.
      const membership = this.db.prepare(`UPDATE chat_local_memberships
        SET local_project_id = NULL, membership_revision = membership_revision + 1
        WHERE chat_id = ? AND device_id = ?`).run(facts.id, deviceId);
      const aggregate = this.db.prepare(`UPDATE chat_local_aggregate_state SET aggregate_revision = ?
        WHERE chat_id = ? AND device_id = ? AND aggregate_revision = ?`)
        .run(facts.chatRecordRevision, facts.id, deviceId, candidate.expected_revision);
      if (Number(membership.changes) !== 1 || Number(aggregate.changes) !== 1) throw new Error("REVISION_STALE");
    } else {
      this.writer.writeCore(facts, current.importOrigin ? "external-managed" : "native", true);
      this.writer.writeLocalFacts(facts, deviceId);
    }
    this.db.prepare("UPDATE chat_classification_candidates SET state='committed' WHERE operation_id=?").run(operationId);
    if (scope && head) {
      acceptMetadataHead(this.db, this.writer, scope, deviceId, head, this.now());
      this.retire(candidate);
    }
    return { chatId: facts.id, state: "committed" };
  }
  private retire(candidate: Row) {
    this.db.prepare("DELETE FROM cloud_outbox WHERE id=? AND kind='classification'").run(String(candidate.operation_id));
    releaseRoot(this.db, `outbox:${candidate.operation_id}`);
  }
}
