/**
 * [INPUT]: Depends on SubmissionContentV1 strict schema, Agent backend/runtime snapshot with transcript/owner-native attachment source authority port
 * [OUTPUT]: Provides assertTrustedGallerySubmission, capability, conversation with the target Chat by invoke
 * [POS]: The entrance authority of the gallery; The renderer epoch is used only for the anti-competitive mode, and the actual facts determine whether or not the renderer epoch is accessed
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
