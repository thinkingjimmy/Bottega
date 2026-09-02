/**
 * [INPUT]: Depends on Workspace readRef client, the app translation provider, PromptInput atomic attachment admission, composer scope/capability, and the RichInput candidate contract
 * [OUTPUT]: Provides useWorkspaceImageSelection with localized read/admission failures; selection fresh-signs and retries exactly once only for explicit TTL expiry
 * [POS]: the boundaries of the composer/workspace's image candidate affairs; Read, decode, access, and chat compose are done in one place, and the Chat Composer only takes the pending status
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import type { AttachmentsContext } from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { RichInputProps } from "@ai-chat/ui/components/ai-elements/rich-input";
import {
  ATTACHMENT_BYTE_LIMIT,
  ATTACHMENT_LIMIT,
} from "../../../../../shared/agent-ipc";
import {
  readWorkspaceFile,
  resignWorkspaceFile,
} from "@/lib/workspace-files-client";
import type { ChatSessionController } from "../../runtime/use-chat-session";
import { useAppTranslation } from "@/components/providers/i18n-provider";

const IMAGE_PATH_PATTERN = /\.(?:png|jpe?g|gif|webp)$/i;

function readRefExpired(cause: unknown) {
  return (
    cause instanceof Error &&
    (cause.message.includes("WORKSPACE_READ_REF_EXPIRED") ||
      cause.message.includes("Workspace readRef 已失效"))
  );
}

export function useWorkspaceImageSelection({
  attachments,
  controller,
}: {
  attachments: AttachmentsContext;
  controller: ChatSessionController["composer"];
}) {
  const { t } = useAppTranslation();
  const generation = useRef(0);
  const mounted = useRef(true);
  const latest = useRef({
    fileNodeCount: controller.fileNodeCount,
    imageInputAvailable: controller.imageInputAvailable,
    scopeKey: controller.workspaceScopeKey,
  });

  useLayoutEffect(() => {
    latest.current = {
      fileNodeCount: controller.fileNodeCount,
      imageInputAvailable: controller.imageInputAvailable,
      scopeKey: controller.workspaceScopeKey,
    };
  });
  useLayoutEffect(() => {
    generation.current += 1;
  }, [
    controller.chatId,
    controller.imageInputAvailable,
    controller.workspaceScopeKey,
  ]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  return useCallback<NonNullable<RichInputProps["onSuggestionSelect"]>>(
    (item) => {
      if (
        item.kind !== "workspace-file" ||
        item.entryKind === "dir" ||
        !IMAGE_PATH_PATTERN.test(item.path) ||
        !controller.imageInputAvailable
      ) {
        return false;
      }
      return (async () => {
        const requestGeneration = ++generation.current;
        const scopeKey = controller.workspaceScopeKey;
        const stillCurrent = () =>
          mounted.current &&
          requestGeneration === generation.current &&
          scopeKey === latest.current.scopeKey &&
          latest.current.imageInputAvailable;

        try {
          let readRef = await resignWorkspaceFile({
            scope: controller.workspaceScope,
            path: item.path,
            entryKind: "file",
          });
          if (!stillCurrent()) return true;
          let result;
          try {
            result = await readWorkspaceFile({
              scope: controller.workspaceScope,
              readRef,
            });
          } catch (cause) {
            if (!readRefExpired(cause) || !stillCurrent()) {
              throw cause;
            }
            readRef = await resignWorkspaceFile({
              scope: controller.workspaceScope,
              path: item.path,
              entryKind: "file",
            });
            if (!stillCurrent()) return true;
            result = await readWorkspaceFile({
              scope: controller.workspaceScope,
              readRef,
            });
          }
          if (!stillCurrent()) return true;
          if (result.kind !== "image") {
            if (result.kind === "metadata" && result.reason === "too-large") {
              throw new Error(
                `${t("ui.fileSizeError")} (${result.size} > ${ATTACHMENT_BYTE_LIMIT})`
              );
            }
            throw new Error(t("chat.workspaceImage.unsupported"));
          }
          const payload = result.dataUrl.slice(result.dataUrl.indexOf(",") + 1);
          const bytes = Uint8Array.from(atob(payload), (character) =>
            character.charCodeAt(0)
          );
          const file = new File([bytes], result.name, {
            type: result.mediaType,
          });
          if (!stillCurrent()) return true;
          const selection = attachments.addValidated([file], {
            accept: "image/*",
            externalFileCount: latest.current.fileNodeCount,
            maxFiles: ATTACHMENT_LIMIT,
            maxFileSize: ATTACHMENT_BYTE_LIMIT,
          });
          if (selection.error || selection.files.length !== 1) {
            throw new Error(
              selection.error?.message ?? t("chat.workspaceImage.admissionFailed")
            );
          }
          return true;
        } catch (cause) {
          if (!stillCurrent()) return true;
          controller.setAttachmentNotice(
            cause instanceof Error
              ? cause.message
              : t("chat.workspaceImage.readFailed")
          );
          return false;
        }
      })();
    },
    [attachments, controller, t]
  );
}
