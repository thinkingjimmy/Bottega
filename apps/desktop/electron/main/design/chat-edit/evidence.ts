/**
 * [INPUT]: Original source-backed native references, exact Chat authority and current immutable journal heads.
 * [OUTPUT]: Verified comment/selection evidence and formal-send frozen current baselines without model execution.
 * [POS]: Original Chat edit admission; adding another comment cannot stale unchanged target content.
 */
import { designReferenceSchema, type DesignReference } from "@ai-chat/cloud-protocol/artifacts/design/reference/model";
import { frozenArtifactEditSchema, type FrozenArtifactEdit } from "@ai-chat/cloud-protocol/artifacts/design/chat/model";
import { readNativeComments } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { CanonicalRichInputNode } from "../../../../shared/content/rich/rich-input-projection";
import type { ChatTurnOptions } from "../../../../shared/chat-agent/options";
import { artifactGeneration, assertArtifactGeneration } from "../../artifacts/admission/state";
import { designDocuments } from "../documents/runtime";
import { designDigest } from "../documents/model";
import type { DesignRevision } from "../documents/store";
import { requireNativeCandidateProvider } from "../native/candidate-job";
type Files = readonly { path: string; data: Uint8Array }[];
export async function nativeReference(input: WorkspaceCommand, snapshot: { version: DesignRevision; files: Files }): Promise<DesignReference> {
  const { nativeTargetDigest } = await import("./targets");
  const { version, files } = snapshot;
  if (input.documentId && input.documentId !== version.manifest.documentId) throw new Error("Native reference belongs to another document");
  assertArtifactGeneration(input.generation);
  const thread = input.nativeCommentId ? readNativeComments(files).threads.find(value => value.id === input.nativeCommentId) : undefined;
  if (input.nativeCommentId && !thread) throw new Error("Original native comment is missing");
  const file = typeof thread?.location.file === "string" ? thread.location.file : input.nativeTarget?.file;
  const section = typeof thread?.location.section === "string" ? thread.location.section : input.nativeTarget?.section;
  const text = thread ? thread.messages.map(message => message.text).join("\n\n") : input.value?.trim();
  if (!text) throw new Error("Native edit instructions are empty");
  const reference = designReferenceSchema.parse({ artifactId: version.artifactId, documentId: version.manifest.documentId, revision: version.revision,
    readSetDigest: version.readSetDigest, generation: input.generation, purpose: "edit",
    native: { kind: thread ? "native-comment" : "native-selection", ...(thread ? { commentId: thread.id, commentDigest: designDigest(JSON.stringify(thread)) } : {}),
      anchor: thread?.anchor ?? input.nativeTarget?.anchor ?? "document", label: thread?.label ?? input.nativeTarget?.label ?? version.manifest.title,
      ...(file ? { file } : {}), ...(section ? { section } : {}), sourceDigest: nativeTargetDigest(files, file, thread?.anchor ?? input.nativeTarget?.anchor), text } });
  if (Buffer.byteLength(JSON.stringify(reference)) > 7000) throw new Error("This comment exceeds the 7 KiB draft-reference budget. Split it into shorter comments before adding it to Chat.");
  return reference;
}
export async function assertNativeEvidence(reference: DesignReference, files: Files) {
  const target = reference.native; if (!target) return;
  const { nativeTargetDigest } = await import("./targets");
  if (nativeTargetDigest(files, target.file, target.anchor) !== target.sourceDigest) throw new Error("Native target content changed. Reopen the target before sending.");
  if (target.kind === "native-comment") {
    const thread = readNativeComments(files).threads.find(value => value.id === target.commentId);
    if (!thread || designDigest(JSON.stringify(thread)) !== target.commentDigest || thread.anchor !== target.anchor || thread.messages.map(message => message.text).join("\n\n") !== target.text) throw new Error("Native comment evidence does not match its fixed saved version");
  }
}
export async function freezeArtifactEdit(input: { chatId: string; incarnationId?: string; requestId: string; nodes: readonly CanonicalRichInputNode[]; options: ChatTurnOptions; planMode?: boolean }): Promise<FrozenArtifactEdit | undefined> {
  const references = input.nodes.flatMap(node => node.type === "design" && node.reference.purpose === "edit" ? [node.reference] : []);
  if (!references.length) return;
  const { nativeTargetDigest } = await import("./targets");
  if (!input.incarnationId || input.planMode) throw new Error("Artifact editing requires its original Chat in execution mode. Your draft is retained.");
  await requireNativeCandidateProvider(input.options);
  const { artifactWorkspace } = await import("../../artifacts/workspace/runtime");
  const documents = designDocuments(), generation = artifactGeneration(), works: FrozenArtifactEdit["works"] = [];
  for (const reference of references) {
    const original = await artifactWorkspace().authorizeReference(input.chatId, input.incarnationId, reference);
    await assertNativeEvidence(reference, original.files);
    const existing = works.find(work => work.documentId === reference.documentId);
    if (existing) { existing.references.push(reference); continue; }
    const authority = documents.authority(input.chatId, input.incarnationId), head = documents.store.latest(authority.ownerId, reference.documentId, authority);
    if (!head) throw new Error("The current source is unavailable");
    const current = await documents.readRevision(input.chatId, input.incarnationId, reference.documentId, head.revision);
    if (nativeTargetDigest(current.files, reference.native!.file, reference.native!.anchor) !== reference.native!.sourceDigest) throw new Error("The annotated content changed. Compare it before sending.");
    const status = await documents.currentHead(input.chatId, input.incarnationId, reference.documentId);
    if (status.dirty || status.pending) throw new Error("Save or recover the current source before sending this edit");
    works.push({ documentId: reference.documentId, artifactId: head.artifactId, revision: head.revision, readSetDigest: head.readSetDigest, snapshotRef: head.snapshotRef, references: [reference] });
  }
  for (const work of works) {
    const fixed = await documents.readRevision(input.chatId, input.incarnationId, work.documentId, work.revision);
    for (const reference of work.references) if (nativeTargetDigest(fixed.files, reference.native!.file, reference.native!.anchor) !== reference.native!.sourceDigest) throw new Error("An annotated target changed");
  }
  assertArtifactGeneration(generation);
  return frozenArtifactEditSchema.parse({ kind: "artifact-edit/v1", chatId: input.chatId, incarnationId: input.incarnationId, requestId: input.requestId, generation, works });
}
