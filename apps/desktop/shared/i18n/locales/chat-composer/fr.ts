/**
 * [INPUT]: Shared native/Web branch and Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the French Chat composer catalog with the exact English structure
 * [POS]: French Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/fr";
import { branchFr } from "@ai-chat/chat-ui/branch-copy/fr";
import { projectSelectorFr } from "@ai-chat/chat-ui/project-copy";

export const chatComposerFr: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "Par défaut",
    standardSpeed: "Standard",
  },
  approval: sharedComposer.approval,
  branch: { fallback: branchFr.fallback, loadFailed: branchFr.loadFailed, uncommitted_one: branchFr.uncommitted_one, uncommitted_other: branchFr.uncommitted_other },
  surface: {
    plan: "Plan",
    authorizeFileFailed: "Impossible d’autoriser {{file}}",
    branchBusy: "Attendez la fin de l’opération sur la branche avant d’envoyer.",
    fileAuthorizationBusy: "Attendez la fin de l’autorisation du fichier avant d’envoyer.",
    previewMarkdown: "Prévisualiser le Markdown",
    previewWorkspaceFile: "Prévisualiser le fichier Workspace",
    queueSubmit: "Ajouter à la file",
  },
  plan: sharedComposer.chat.composer.plan,
  project: projectSelectorFr,
  userInput: sharedComposer.userInput,
  queue: sharedComposer.chat.composer.queue,
};
