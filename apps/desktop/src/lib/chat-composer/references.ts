/**
 * [INPUT]: Native composer lifetime and explicitly selected workspace reference identities.
 * [OUTPUT]: Retains reference provenance across remote transport resets and releases it on explicit local reselection.
 * [POS]: Draft-owned workspace custody; the remote transport store is never its source of truth.
 */
import type { RemoteFileReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { readComposer, updateComposer } from "../chat-composer-store";

export const composerWorkspaceReferences = (chatId: string) => [...readComposer(chatId).workspaceReferences.values()];

export function selectComposerWorkspaceReference(chatId: string, path: string, reference?: RemoteFileReference) {
  updateComposer(chatId, current => {
    const workspaceReferences = new Map(current.workspaceReferences);
    if (reference) workspaceReferences.set(path, reference);
    else workspaceReferences.delete(path);
    return { ...current, workspaceReferences };
  });
}
