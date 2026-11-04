/**
 * [INPUT]: Inert fixed design references and native comment/selection identities.
 * [OUTPUT]: Stable original-draft card identity independent of comment-only source revisions.
 * [POS]: Shared desktop/Web deduplication; removing a card never removes its source comment.
 */
import type { DesignReference } from "./model";
export function designReferenceKey(reference: DesignReference) {
  const target = reference.native;
  return target ? JSON.stringify([reference.documentId, target.kind, target.kind === "native-comment" ? target.commentId : [target.file ?? "", target.section ?? "", target.anchor]]) : JSON.stringify(reference);
}
