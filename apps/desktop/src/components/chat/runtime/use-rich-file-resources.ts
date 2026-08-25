/**
 * [INPUT]: Depends on React, per-chat composer store, PromptInput file node, workspace scope and preload file authorization API
 * [OUTPUT]: Provides callback-stable use RichFileResources store front, unified authorization, fileFor and permanent discard
 * [POS]: The rich file resource area of chat/runtime; The real lifecycle of the resource is returned to the composer store, reference collections are no longer attached to the components, and recycling is retained by the author himself
 */

import { useCallback, useMemo } from "react";
import type {
  RichNode,
} from "@ai-chat/ui/components/ai-elements/prompt-input";
import type { AgentWorkspaceScope } from "../../../../shared/agent-ipc";
import { readComposer, updateComposer } from "@/lib/chat-composer-store";

type FileNode = Extract<RichNode, { type: "file" }>;

export function useRichFileResources(
  chatId: string,
  workspaceScope: AgentWorkspaceScope
) {

  const authorize = useCallback(
    async (file: File): Promise<FileNode> => {
      if (!window.app) throw new Error("本地文件能力仅在 Electron 中可用");
      const grant = await window.app.authorizeFile(file, workspaceScope);
      const node: FileNode = {
        id: crypto.randomUUID(),
        type: "file",
        ref: grant.fileRef,
        name: grant.name,
        mediaType: grant.mediaType || "application/octet-stream",
      };
      updateComposer(chatId, (current) => {
        const fileResources = new Map(current.fileResources);
        fileResources.set(node.id, { file, node });
        return { ...current, fileResources };
      });
      return node;
    },
    [chatId, workspaceScope]
  );

  const discard = useCallback((node: Exclude<RichNode, { type: "text" }>) => {
    if (node.type !== "file") return;
    const resource = readComposer(chatId).fileResources.get(node.id);
    if (!resource) return;
    updateComposer(chatId, (current) => {
      const fileResources = new Map(current.fileResources);
      fileResources.delete(node.id);
      return { ...current, fileResources };
    });
    void window.app?.releaseFile(resource.node.ref);
  }, [chatId]);

  const fileFor = useCallback((nodeId: string) =>
    readComposer(chatId).fileResources.get(nodeId)?.file, [chatId]);

  return useMemo(() => ({
    authorize,
    discard,
    fileFor,
  }), [authorize, discard, fileFor]);
}
