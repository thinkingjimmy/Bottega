/**
 * [INPUT]: Shared native/Web Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the Spanish Chat composer catalog with the exact English structure
 * [POS]: Spanish Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/es";
import { projectSelectorEs } from "@ai-chat/chat-ui/project-copy";

export const chatComposerEs: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "Predeterminado",
    standardSpeed: "Estándar",
  },
  approval: sharedComposer.approval,
  branch: {
    uncommitted_one: "{{count}} archivo sin confirmar",
    uncommitted_other: "{{count}} archivos sin confirmar",
    loadFailed: "No se pudieron cargar las ramas",
    checkoutFailed: "No se pudo cambiar de rama",
    createFailed: "No se pudo crear la rama",
    fallback: "Ramas",
    search: "Buscar ramas",
    empty: "No se encontraron ramas",
    detached: "HEAD separado",
    group: "Ramas",
    refreshing: "Actualizando ramas…",
    newAction: "Crear y cambiar a una rama nueva…",
    createTitle: "Crear y cambiar de rama",
    createDescription: "Crea una rama local desde el HEAD actual y cambia a ella.",
    name: "Nombre de la rama",
    placeholder: "new-branch",
    close: "Cerrar",
    creating: "Creando…",
    createAndCheckout: "Crear y cambiar",
  },
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
