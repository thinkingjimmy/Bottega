/**
 * [INPUT]: Depends on canonical facts, the portable classification projection and SQLite custody.
 * [OUTPUT]: Provides version-fenced lifecycle candidates, CAS confirmation and atomic local adoption.
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

export class ClassificationTransactions {
  constructor(private db: SqliteDatabase, private reader: ChatRepositoryReader, private writer: ChatRecordWriter) {}
  get(operationId: string) {
    return this.db.prepare("SELECT * FROM chat_classification_candidates WHERE operation_id=?").get(operationId) as Row | undefined;
  }
  propose(action: Extract<CloudAction, { type: "propose-classification" }>, deviceId: string, scope: SyncScope | null) {
    const facts = chatFactsSchema.parse(action.facts) as ChatFacts;
    const current = this.reader.listMetadata(deviceId, facts.id)[0];
    if (!current || current.chatRecordRevision !== action.expectedRevision ||
      current.incarnationId !== facts.incarnationId || facts.chatRecordRevision !== action.expectedRevision + 1 ||
      facts.chatMessageRevision !== current.chatMessageRevision ||
      canonicalJson(projectChatClassification(current)) !== canonicalJson(action.previous)) throw new Error("REVISION_STALE");
    if (facts.agent !== current.agent || facts.agentRevision !== current.agentRevision ||
      canonicalJson(facts.options) !== canonicalJson(current.options) || canonicalJson(facts.session) !== canonicalJson(current.session)) {
      throw new Error("Classification conversion cannot change execution facts");
    }
    const omitClassification = (value: ChatFacts) => {
      const { context: _context, projectId: _project, appRole: _role, grants: _grants, grantRevision: _grantsRevision, chatRecordRevision: _revision, updatedAt: _time, ...rest } = value;
      return rest;
    };
    if (facts.grants.some(grant => !current.grants.some(old => canonicalJson(old) === canonicalJson(grant))) ||
        facts.grantRevision < current.grantRevision) throw new Error("Classification conversion cannot grant new authority");
    const { preview: _preview, ...rawCurrent } = current;
    const currentFacts = chatFactsSchema.parse(rawCurrent);
    const left = omitClassification(facts), right = omitClassification(currentFacts);
    const changed = Object.keys({ ...left, ...right }).filter(key => canonicalJson((left as Record<string, unknown>)[key] ?? null) !== canonicalJson((right as Record<string, unknown>)[key] ?? null));
    if (changed.length) throw new Error(`Classification conversion cannot alter other Chat facts: ${changed.join(", ")}`);
    const candidate = json(facts);
    const candidateHash = digest(candidate);
    const existing = this.get(action.lifecycleOperationId);
    if (existing) {
      if (existing.candidate_hash !== candidateHash) throw new Error("Classification intent was reused");
      return { lifecycleOperationId: action.lifecycleOperationId, candidateHash, state: String(existing.state) };
    }
    if (this.db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(facts.id)) throw new Error("CHAT_CLASSIFICATION_PENDING");
    this.db.prepare(`INSERT INTO chat_classification_candidates(operation_id,chat_id,environment,user_id,
      expected_revision,old_classification_json,candidate_json,candidate_hash,state) VALUES(?,?,?,?,?,?,?,?,?)`).run(
      action.lifecycleOperationId, facts.id, scope?.environment ?? null, scope?.userId ?? null,
      action.expectedRevision, canonicalJson(action.previous), candidate, candidateHash, scope ? "pending" : "confirmed");
    return { lifecycleOperationId: action.lifecycleOperationId, candidateHash, state: scope ? "pending" : "confirmed" };
  }
  confirm(action: Extract<CloudAction, { type: "confirm-classification" }>, scope: SyncScope) {
    const candidate = this.get(action.lifecycleOperationId);
    const receipt = action.receipt;
    if (!candidate || candidate.environment !== scope.environment || candidate.user_id !== scope.userId ||
      candidate.operation_id !== receipt.lifecycleOperationId || candidate.candidate_hash !== receipt.candidateHash) throw new Error("Classification receipt identity mismatch");
    if (candidate.receipt_json) {
      if (String(candidate.receipt_json) !== json(receipt)) throw new Error("Classification receipt changed");
      return { state: String(candidate.state) };
    }
    const chat = this.db.prepare("SELECT cloud_revision FROM chats WHERE id=?").get(String(candidate.chat_id)) as Row;
    if (!chat || chat.cloud_revision !== receipt.expectedCloudRevision || receipt.cloudRevision !== receipt.expectedCloudRevision + 1) throw new Error("CLOUD_REVISION_STALE");
    const state = receipt.outcome === "applied" ? "confirmed" : "conflicted";
    this.db.prepare("UPDATE chat_classification_candidates SET receipt_json=?,state=? WHERE operation_id=?")
      .run(json(receipt), state, action.lifecycleOperationId);
    return { state };
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
    this.writer.writeCore(facts, current.importOrigin ? "external-managed" : "native", true);
    this.writer.writeLocalFacts(facts, deviceId);
    if (scope) {
      const receipt = JSON.parse(String(candidate.receipt_json)) as { cloudRevision: number };
      this.db.prepare("UPDATE chats SET cloud_revision=? WHERE id=?").run(receipt.cloudRevision, facts.id);
    }
    this.db.prepare("UPDATE chat_classification_candidates SET state='committed' WHERE operation_id=?").run(operationId);
    return { chatId: facts.id, state: "committed" };
  }
}
