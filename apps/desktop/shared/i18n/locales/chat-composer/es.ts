/**
 * [INPUT]: Shared native/Web branch and Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Spanish Chat composer catalog with the exact English structure
 * [POS]: Spanish Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/es";
import { branchEs } from "@ai-chat/chat-ui/branch-copy/es";
import { projectSelectorEs } from "@ai-chat/chat-ui/project-copy";

export const chatComposerEs: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "Predeterminado",
    standardSpeed: "Estándar",
  },
  approval: sharedComposer.approval,
  branch: branchEs,
  surface: {
    plan: "Plan",
    authorizeFileFailed: "No se pudo autorizar {{file}}",
    branchBusy: "Espera a que termine la operación de rama antes de enviar.",
    fileAuthorizationBusy: "Espera a que termine la autorización del archivo antes de enviar.",
    previewMarkdown: "Previsualizar Markdown",
    previewWorkspaceFile: "Previsualizar archivo de Workspace",
    queueSubmit: "Añadir a la cola",
  },
  plan: sharedComposer.chat.composer.plan,
  project: projectSelectorEs,
  userInput: sharedComposer.userInput,
  queue: sharedComposer.chat.composer.queue,
};
