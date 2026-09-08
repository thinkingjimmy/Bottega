/**
 * [INPUT]: Depends on the SubmissionContentV1 schema, shared AgentBackendId/BackendCapabilities/GalleryMediaSourceRef types, and caller-supplied runtime-resolution and source-authority ports
 * [OUTPUT]: Provides assertTrustedGallerySubmission: validates gallery attachments belong to the target conversation, confirms the backend has imageInput capability installed, and authorizes each attachment source
 * [POS]: Gallery's submission entry-point authority; ignores any renderer-reported epoch and decides purely from live runtime facts, not client-claimed state
 */

import type {
  AgentBackendId,
  BackendCapabilities,
} from "../../../shared/agent-ipc";
import {
  submissionContentV1Schema,
  type SubmissionContentV1,
} from "../../../shared/submission";
import type { GalleryMediaSourceRef } from "../../../shared/gallery-media-ipc";

type RuntimeAuthority = {
  runtimeStatus: string;
  capabilities: Pick<BackendCapabilities, "imageInput">;
};

export async function assertTrustedGallerySubmission(
  submission: SubmissionContentV1,
  context: {
    backend: AgentBackendId;
    conversationId: string;
    resolveRuntime(backend: AgentBackendId): Promise<RuntimeAuthority>;
    assertSource(
      sourceRef: GalleryMediaSourceRef,
      destinationChatId: string
    ): Promise<void>;
  }
) {
  const value = submissionContentV1Schema.parse(submission);
  const attachments =
    value.origin === "composer" ? value.gallery?.attachments ?? [] : [];
  if (
    attachments.some(
      ({ sourceRef }) =>
        sourceRef.kind === "transcript" &&
        sourceRef.chatId !== context.conversationId
    )
  ) {
    throw new Error("GALLERY_CONVERSATION_MISMATCH");
  }
  if (!attachments.length) return;
  const runtime = await context.resolveRuntime(context.backend);
  if (
    runtime.runtimeStatus !== "installed" ||
    !runtime.capabilities.imageInput
  ) {
    throw new Error("EPOCH_MISMATCH");
  }
  await Promise.all(
    attachments.map(({ sourceRef }) =>
      context.assertSource(sourceRef, context.conversationId)
    )
  );
}
