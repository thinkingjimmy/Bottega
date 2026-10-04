/**
 * [INPUT]: Depends on original Project operations/receipts, a fresh portable head and scoped Store identities.
 * [OUTPUT]: Projects deletion candidates and resolves an explicitly reviewed conflict in one existing Store commit.
 * [POS]: Pure Project deletion recovery leaf; original receipts remain immutable and retry creates a separately reviewed operation.
 */
import { createHash } from "node:crypto";
import { canonicalJson, type PortableProject } from "@ai-chat/cloud-protocol";
import { sameScope, type SyncScope } from "../../../../../shared/local-storage/contracts";
import { projectDeletionCandidateSchema, type ProjectDeletionDecision } from "../../../../../shared/cloud/projects/deletion";
import type { StoredProject } from "../project-store-schema";
import { freezeOperation, withProjection } from "./queue";
export function projectDeletionCandidate(project: StoredProject, scope: SyncScope) {
  const sync = project.sync;
  if (!sync || !sameScope(sync.scope, scope) || project.role !== "workspace" || project.workspaceBinding.kind === "app" || sync.confirmed?.appId) return null;
  const pending = sync.pending.some(item => item.operation.command.kind === "delete"), conflicted = sync.conflicts.some(item => item.operation.command.kind === "delete");
  if (!pending && !conflicted && !sync.deletionKept && !(sync.deleted && (sync.pending.length || sync.conflicts.length))) return null;
  const proposedNames = [...new Set([...sync.pending.map(item => item.operation), ...sync.conflicts.map(item => item.operation)]
    .flatMap(operation => operation.command.kind === "patch" && operation.command.changes.name ? [operation.command.changes.name] : []))].slice(0, 20);
  return projectDeletionCandidateSchema.parse({ projectId: project.id, name: sync.confirmed?.name ?? project.name,
    state: sync.deleted ? "deleted" : conflicted ? "conflicted" : sync.deletionKept ? "kept" : "pending", proposedNames,
    candidateHash: createHash("sha256").update(canonicalJson([project.id, sync])).digest("hex") });
}
export function resolveProjectDeletion(project: StoredProject, scope: SyncScope, decision: ProjectDeletionDecision, head: PortableProject) {
  const candidate = projectDeletionCandidate(project, scope), sync = structuredClone(project.sync);
  if (!candidate || !sync || !["conflicted", "kept"].includes(candidate.state) || candidate.candidateHash !== decision.review.candidateHash ||
    decision.review.projectId !== project.id || head.id !== project.id || head.appId || head.role !== "workspace" ||
    head.cloudRevision !== decision.review.revision || head.name !== decision.review.name || head.cloudRevision < sync.cloudRevision) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
  if (sync.pending.length || sync.conflicts.some(item => item.operation.command.kind !== "delete")) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
  if (head.cloudRevision === sync.cloudRevision && sync.confirmed && canonicalJson(head) !== canonicalJson(sync.confirmed)) throw new Error("PROJECT_REVISION_CONFLICT");
  const original = sync.conflicts[0]?.operation ?? sync.deletionKept;
  sync.confirmed = head; sync.cloudRevision = head.cloudRevision; sync.conflicts = [];
  if (decision.action === "delete") {
    delete sync.deletionKept;
    sync.pending.push({ operation: freezeOperation({ operationId: decision.decisionId, projectId: project.id,
      command: { kind: "delete", expectedRevision: head.cloudRevision } }), predecessorId: null, attempts: 0, state: "queued" });
  } else {
    if (!original) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
    sync.deletionKept = { operationId: original.operationId, payloadHash: original.payloadHash };
  }
  return withProjection(project, sync);
}
