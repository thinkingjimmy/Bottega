/**
 * [INPUT]: Account-admitted resource identity, strict commands and the existing main workspace/custody owners.
 * [OUTPUT]: Bounded encrypted catalog/Canvas capability/edit/export results with exact original request recovery.
 * [POS]: Artifact resource domain; ResourceCommandRuntime verifies the operator and connection before every call.
 */
import { artifactWorkspace } from "../../../artifacts/workspace/runtime";
import { artifactEnabled, artifactGeneration, assertArtifactGeneration } from "../../../artifacts/admission/state";
import { PROTOCOL_VERSION } from "@ai-chat/cloud-protocol/config";
import { artifactOperationSchema, artifactDifferenceSchema, artifactCanvasTargetSchema } from "@ai-chat/cloud-protocol/resources/artifact/model";
import { resourceCommandBodySchema, resourceActionKind, type ResourceCommandBody, type ResourceResultBody } from "@ai-chat/cloud-protocol/resources/model";
import { artifactRuntime } from "../../../artifacts/core/runtime";
export async function artifactResourceAction(resourceId: string, raw: ResourceCommandBody, current: () => void, expectedOwnerDeviceId?: string): Promise<ResourceResultBody> {
  const body = resourceCommandBodySchema.parse(raw) as ResourceCommandBody;
  if (resourceActionKind(body.action) !== "artifact") throw new Error("unsupported-action");
  const input = body.input as Record<string, unknown>;
      current();
      if (resourceId !== input.chatId) throw new Error("artifact-unavailable");
      if (expectedOwnerDeviceId) {
        const head = await artifactRuntime()?.remote?.validate({ chatId: String(input.chatId), incarnationId: String(input.incarnationId), artifactId: String(input.artifactId ?? "catalog") });
        current(); if (!head || head.ownerDeviceId !== expectedOwnerDeviceId) throw new Error("artifact-unavailable");
      }
      if (body.action === "artifact-status") {
        const result = await artifactWorkspace().dispatch({ action: "list", chatId: input.chatId, incarnationId: input.incarnationId }) as {
          documents: { documentId: string; title: string; revision: number; snapshotRef: string; readSetDigest: string; dirty: boolean;
            undoRevision: number | null; redoRevision: number | null;
            fence: { id: string; bytes?: number; design?: { format: "bottega-design" | "bottega-design-system" } } }[] };
        const candidates = result.documents.sort((a, b) => a.documentId.localeCompare(b.documentId)).filter(value => !input.cursor || value.documentId > String(input.cursor));
        const documents = candidates.slice(0, 8).map(value => ({ documentId: value.documentId, title: value.title.slice(0, 80), artifactId: value.fence.id,
          revision: value.revision, snapshotRef: value.snapshotRef, readSetDigest: value.readSetDigest, bytes: value.fence.bytes!, format: value.fence.design!.format, dirty: value.dirty,
          undoRevision: value.undoRevision, redoRevision: value.redoRevision }));
        current(); return { ok: true, artifactStatus: { capability: { enabled: artifactEnabled(), generation: artifactGeneration(), protocolVersion: PROTOCOL_VERSION, publishedAt: Date.now() },
          documents, cursor: candidates.length > 8 ? documents.at(-1)!.documentId : null } };
      }
      try {
        if (body.action === "artifact-history") {
          const snapshot = await artifactWorkspace().version(input as never);
          const { designDocuments } = await import("../../../design/documents/runtime");
          const versions = designDocuments().store.versions(snapshot.version.authority, snapshot.version.manifest.documentId)
            .filter(version => version.revision > Number(input.cursor));
          current(); return { ok: true, artifactHistory: { cursor: versions.length > 8 ? versions[7]!.revision : null,
            versions: versions.slice(0, 8).map(version => ({ documentId: version.manifest.documentId, title: version.manifest.title.slice(0, 80),
              artifactId: version.artifactId, revision: version.revision, snapshotRef: version.snapshotRef, readSetDigest: version.readSetDigest,
              bytes: version.fence.bytes!, format: version.manifest.format, dirty: false, undoRevision: null, redoRevision: null })) } };
        }
        if (input.action === "cancel-thumbnail") { const value = await artifactWorkspace().dispatch(input); current(); return { ok: true, artifactCancellation: value as { cancelled: boolean } }; }
        if (input.action === "export" || input.action === "thumbnail") {
          if (input.action === "thumbnail") {
            const { transferDesignThumbnail } = await import("../../../artifacts/workspace/thumbnails");
            const result = await transferDesignThumbnail(input as never, artifactWorkspace()); current(); return { ok: true, artifactExport: result };
          }
          assertArtifactGeneration(input.generation as string);
          const { transferDesignExport } = await import("../../../artifacts/workspace/exports");
          const result = await transferDesignExport(input as never, artifactWorkspace()); current();
          return { ok: true, artifactExport: result };
        }
        const value = await artifactWorkspace().dispatch(input);
        if (["capture-status", "retry-capture"].includes(String(input.action))) { current(); return { ok: true, artifactRecovery: value as { fence: import("@ai-chat/cloud-protocol/turns/text/artifact-reference").ArtifactFence | null } }; }
        current();
        if (input.action === "canvas-target") return { ok: true, artifactCanvasTarget: artifactCanvasTargetSchema.parse(value) };
        if (input.action === "system-diff") return { ok: true, artifactDifference: artifactDifferenceSchema.parse(value) };
        const result = value as { status: "committed" | "pending" | "conflict"; requestId: string; documentId?: string; revision?: number;
          code?: "SOURCE_CHANGED"; sourceConflict?: unknown;
          readSetDigest?: string; snapshotRef?: string; artifactRef?: { artifactId: string }; operationRef?: string;
          recovery?: { status: string; attempts: number; code: string; message: string; action: string; nextRetryAt?: number } };
        return { ok: true, artifactOperation: artifactOperationSchema.parse({ status: result.status, requestId: result.requestId,
          ...(result.status === "conflict" ? { code: result.code, sourceConflict: result.sourceConflict } : {}),
          recovery: result.recovery ? { status: result.recovery.status, attempts: result.recovery.attempts, code: result.recovery.code, message: result.recovery.message.slice(0, 500), action: result.recovery.action.slice(0, 500), nextRetryAt: result.recovery.nextRetryAt } : undefined,
          ...(result.status === "committed" ? { documentId: result.documentId, revision: result.revision, readSetDigest: result.readSetDigest, snapshotRef: result.snapshotRef, artifactId: result.artifactRef?.artifactId } : { operationRef: result.operationRef }) }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : message;
        throw new Error(code === "artifact-thumbnail-busy" ? code : code.includes("ARTIFACT_DISABLED") ? "artifact-disabled" : code.includes("GENERATION") ? "artifact-generation-expired" :
          ["REVISION_CONFLICT", "SOURCE_CHANGED", "REQUEST_MISMATCH"].includes(code) ? "artifact-conflict" :
          code === "INVALID_DOCUMENT" ? "artifact-invalid" : code === "BUDGET_EXCEEDED" ? "artifact-budget" : code === "PATH_DENIED" ? "artifact-path" : "artifact-unavailable");
      }

}
