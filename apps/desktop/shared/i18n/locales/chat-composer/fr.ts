/**
 * [INPUT]: Shared native/Web Project selector and Plan catalogs and the English Chat composer structural type.
 * [OUTPUT]: Provides the French Chat composer catalog with the exact English structure
 * [POS]: French Chat composer locale leaf; assembled inside the top-level chat.composer namespace
 */

import type { chatComposerEn } from "./en";

import { copy as sharedComposer } from "@ai-chat/chat-ui/composer-control-copy/fr";
import { projectSelectorFr } from "@ai-chat/chat-ui/project-copy";

export const chatComposerFr: typeof chatComposerEn = {
  modelFallback: {
    defaultEffort: "Par défaut",
    standardSpeed: "Standard",
  },
  approval: sharedComposer.approval,
  branch: {
    uncommitted_one: "{{count}} fichier non validé",
    uncommitted_other: "{{count}} fichiers non validés",
    loadFailed: "Impossible de charger les branches",
    checkoutFailed: "Impossible de changer de branche",
    createFailed: "Impossible de créer la branche",
    fallback: "Branches",
    search: "Rechercher des branches",
    empty: "Aucune branche trouvée",
    detached: "HEAD détachée",
    group: "Branches",
    refreshing: "Actualisation des branches…",
    newAction: "Créer et extraire une nouvelle branche…",
    createTitle: "Créer et extraire une branche",
    createDescription: "Créez une branche locale depuis la HEAD actuelle et extrayez-la.",
    name: "Nom de la branche",
    placeholder: "new-branch",
    close: "Fermer",
    creating: "Création…",
    createAndCheckout: "Créer et extraire",
  },
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
