/**
 * [INPUT]: Depends on the chatEn structural type
 * [OUTPUT]: Provides chatFr, the French Chat catalog
 * [POS]: French leaf of shared/i18n/locales/chat; loaded on demand by the matching top-level locale
 */

import type { chatEn } from "./en";

export const chatFr: typeof chatEn = {
  provider: {
    listFailed: "Échec du chargement des chats : {{message}}",
    renameFailed: "Échec du renommage du chat : {{message}}",
    sortFailed: "Échec du déplacement du chat : {{message}}",
    archiveFailed: "Échec de l’archivage du chat : {{message}}",
    deleteFailed: "Échec de la suppression du chat : {{message}}",
  },
  sidebar: {
    priority: "Priorité",
    nothingNeedsAttention: "Rien ne requiert votre attention",
    waiting: "En attente de votre réponse",
    running: "Génération en cours",
    done: "Nouvelle réponse disponible",
    failed: "Échec de l’exécution",
    archiveChat: "Archiver le chat",
    moreActions: "Plus d’actions",
    archive: "Archiver",
    reorder: {
      pickedUp: "{{title}} saisi",
      moved: "{{title}} déplacé en position {{position}} sur {{count}}",
      unchanged: "{{title}} garde sa position",
      cancelled: "Réorganisation annulée",
    },
  },
  workspaceFiles: {
    bridgeUnavailable: "Les fichiers Workspace sont indisponibles dans cet environnement.",
    searchFailed: "La recherche de fichiers Workspace a échoué.",
  },
  interrupted: "Réponse interrompue. Les résultats partiels sont conservés.",
  noText: "Ce tour n’a renvoyé aucun texte.",
  relayStopConfirm: "Arrêter la requête actuelle et déconnecter toute la chaîne de relais Section ?",
  workspaceImage: {
    unsupported: "Le chemin sélectionné ne correspond pas à une image prise en charge.",
    admissionFailed: "L’image n’a pas pu être ajoutée en pièce jointe.",
    readFailed: "Impossible de lire l’image du Workspace.",
  },
  queue: {
    limit: "La file d’attente accepte au maximum {{count}} messages.",
    chatBudget: "Les pièces jointes en attente de ce Chat dépassent 256 Mio.",
    enqueueFailed: "Impossible d’ajouter le message à la file d’attente.",
    globalBudget: "Les pièces jointes en attente de tous les Chats dépassent 1 Gio.",
    frozenBudget: "Les pièces jointes finalisées dépassent la mémoire allouée à la file d’attente.",
    workspaceChanged: "Le Workspace a changé. {{removed}} messages locaux ont été retirés ; {{retained}} messages envoyés ou en rapprochement sont conservés pour vérification et ne peuvent pas être renvoyés dans le nouveau Workspace.",
  },
  userInput: {
    expired: "Cette question a expiré. Attendez que l’Agent poursuive.",
    answerRequired: "Saisissez une réponse avant de continuer.",
  },
  browser: {
    invalidAddress: "Saisissez une URL http(s) ou un domaine.",
    desktopOnly: "Browser est disponible uniquement dans l’application de bureau.",
    back: "Précédent",
    forward: "Suivant",
    reload: "Actualiser",
    addressLabel: "Adresse du navigateur",
    addressPlaceholder: "Saisissez une URL",
    opening: "Ouverture de la page Web…",
    agentControlling: "L’Agent contrôle le navigateur",
    stopAgentAction: "Arrêter les actions de navigation de l’Agent",
    stop: "Arrêter",
    operationFailed: "L’opération du navigateur a échoué.",
  },
  dock: {
    latestTurn: "Dernier tour",
    collapseLatest: "Replier le dernier tour",
    expandLatest: "Déplier le dernier tour",
    newReply: "Nouvelle réponse",
  },
  subagent: {
    detailUnavailable: "Les détails en temps réel ne sont pas disponibles.",
    starting: "Démarrage…",
    noTranscript: "Aucune transcription n’a été enregistrée.",
    active: "Actifs",
    done: "Terminés",
    empty: "Cette conversation ne contient encore aucun Subagent.",
    back: "Revenir à la liste des Subagents",
    detailLimit: "La limite des détails en temps réel est atteinte ; le nom et l’état de ce Subagent restent disponibles.",
    avatarLabel: "Subagent {{agent}}",
  },
  skillControl: {
    capabilityChecking: "La capacité Plan est en cours de vérification. Réessayez dans un instant.",
    workspaceChanged: "L’espace de travail a changé. Réessayez.",
    planUnavailable: "L’Agent actuel ne prend pas en charge le mode Plan.",
    invalidated: "Ce Skill a changé ou a été supprimé. Retirez la puce et sélectionnez-le à nouveau.",
  },
  skillFailure: {
    "ref-invalid": "Ce Skill n’est plus disponible. Retirez la puce et sélectionnez-le à nouveau.",
    "requirement-blocked": "Ce Skill n’est pas disponible pour l’Agent ou le mode Plan actuel.",
    "file-too-large": "Ce Skill est trop volumineux pour être chargé en toute sécurité.",
    "changed-during-read": "Le Skill a changé pendant son chargement. Réessayez.",
    "plan-unsupported": "L’Agent actuel ne prend pas en charge le mode Plan.",
    "invalid-request": "La demande de Skill est invalide.",
    "staging-rejected": "Le Skill n’a pas pu être préparé en toute sécurité.",
    "package-invalid": "Le paquet Skill est invalide.",
    unavailable: "Les Skills sont temporairement indisponibles.",
    conflict: "L’état des Skills a changé. Actualisez puis réessayez.",
    "read-only": "La gestion des Skills est actuellement en lecture seule.",
    failed: "L’opération Skill a échoué. Réessayez.",
  },
  suggestions: {
    chats: "Conversations", files: "Fichiers", skills: "Skills",
    loadingChats: "Chargement des conversations…", loadingSkills: "Chargement des Skills…",
    noChats: "Aucune conversation disponible", noSkills: "Aucun Skill disponible",
    sectionDescription: "Géré par {{agent}}", historyDescription: "Conversation {{agent}} importée",
    hiddenSkills: "{{count}} Skills correspondants supplémentaires sont masqués. Affinez la recherche.",
    filesTruncated: "Certains fichiers n’ont pas été indexés. Précisez votre recherche.",
  },
};
