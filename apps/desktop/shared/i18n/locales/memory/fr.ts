/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Includes Memory access selection, explicit workflow-read consent, plugin chrome and native-memory distinction; Provides memoryFr, the French Memory catalog
 * [POS]: French leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryFr: typeof memoryEn = {
  ...memoryEn,
  plugin: { serviceDisabled: "Activez le plugin Memory pour utiliser ce service. Votre choix pour le service est conservé lorsque le plugin est désactivé.", open: "Ouvrir le plugin Memory", name: "Memory", official: "Officiel · Intégré", about: "À propos de Memory", unsupported: "Memory n’est pas pris en charge sur cette plateforme. Il est actuellement disponible uniquement sur macOS.", nativeDistinction: "Bottega Memory est distinct de la mémoire native gérée dans les paramètres des plugins Codex et Claude." },
  access: {"none": "Aucune", "readOnly": "Lecture seule", "description": "Rappelle les souvenirs pertinents pour ce rôle. Les rôles de workflow n’écrivent jamais dans Memory.", "workflowOff": "La lecture des workflows n’est pas autorisée dans le plugin Memory.", "workflowOn": "La lecture des workflows est autorisée sur cet ordinateur."},
  workflow: {"sectionTitle": "Accès et commandes", "label": "Autoriser les rôles de workflow à lire Memory", "description": "Seuls les rôles configurés en lecture seule peuvent rappeler des souvenirs. Ils n’écrivent jamais dans Memory.", "consentTitle": "Autoriser la lecture par les workflows ?", "consentBody": "Les rôles configurés de planification, développement et revue peuvent rappeler des souvenirs à partir du nom de la tâche et de ses critères d’acceptation, dans le Chat ou Project actuel. Ils n’écrivent pas de souvenirs. Mettre Memory en pause ou retirer cette autorisation arrête le rappel à l’étape suivante.", "confirm": "Autoriser la lecture seule", "requiresActive": "Activez Memory et terminez le consentement avant d’autoriser la lecture. Reprenez Memory s’il est en pause.", "personal": "La lecture des workflows n’est pas disponible dans le pool personnel. Choisissez le périmètre Chat ou Project.", "saveFailed": "Impossible d’enregistrer l’autorisation. Réessayez."},
  store: {
    providerListFailed: "Échec du chargement des fournisseurs Memory",
    statusFailed: "Échec de la lecture de l’état de Memory",
    healthFailed: "Échec de la vérification de l’état de Memory",
    historyPreviewFailed: "Échec de l’aperçu de l’historique Memory",
    attentionFailed: "Échec du traitement de l’élément Memory en attente",
    runtimeStatusFailed: "Échec de la lecture de l’état du runtime Memory",
    configIssueFailed: "Échec de la résolution du problème de configuration Memory",
    manualConfigPreviewFailed: "Échec de l’aperçu de la destination configurée manuellement",
    runtimeOperationFailed: "Échec de l’opération du runtime Memory",
    updateCheckFailed: "Échec de la recherche de mises à jour Memory",
    configPreviewFailed: "Échec de l’aperçu de la destination Memory",
    configAuthorityFailed: "Échec de l’autorisation de la destination Memory",
    manualConfigAuthorityFailed: "Échec de l’autorisation de la destination configurée manuellement",
    configSubmitFailed: "Échec de l’envoi de la configuration du runtime Memory",
    destructiveAuthorityFailed: "Échec de l’autorisation de l’opération destructive Memory",
    destructiveFailed: "Échec de l’opération destructive Memory",
  },
  common: { unread: "Pas encore lu", paused: "en pause", enabled: "activé" },
  time: { none: "Aucun", now: "à l’instant" },
  page: { ...memoryEn.page, pausedBanner: "La mémoire à long terme est en pause. Chat, Tools, Apps et Skills continuent normalement." },
  sharing: {
    title: "Portée du partage", description: "Choisissez depuis quels Chats les nouvelles mémoires peuvent être rappelées. Un changement ne réutilise jamais automatiquement l’ancienne portée.", disabledMemory: "Activez d’abord la mémoire à long terme.", disabledTarget: "La destination mémoire actuelle est indisponible.", previewFailed: "Impossible de prévisualiser le changement de portée",
    dialogTitle: "Modifier la portée de partage ?", oldScopeRetained: "Les données de l’ancienne portée sont conservées mais ne sont plus rappelées ni fusionnées automatiquement.", historyPaused: "La portée peut changer en pause ; reprenez la mémoire pour importer l’historique.", confirm: "Confirmer la portée", readingScope: "Lecture de la portée…",
    mode: { chat: "Ce Chat uniquement", group: "Pool Project / Chat autonome", personal: "Pool mémoire personnel" },
    isolation: { chat: "Seule l’incarnation actuelle du Chat peut rappeler les nouvelles mémoires.", group: "Les Chats d’un Project se rappellent mutuellement ; les Chats autonomes partagent un pool séparé.", personal: "Tous les Projects et Chats autonomes rappellent depuis le même pool personnel." },
  },
  runtime: { running: "Opération en cours…", openRunning: "Ouvrir l’état de l’opération Memory" },
  receipt: { used: "Mémoire à long terme · {{count}} éléments envoyés", usedDetail: "L’envoi ne signifie pas que le modèle les a utilisés", none: "Mémoire à long terme · aucun contenu pertinent", unavailable: "Mémoire indisponible · non utilisée pour ce tour", planMode: "Mémoire à long terme · non utilisée en mode Plan", promptNotIssued: "Mémoire à long terme · requête Agent non envoyée", failure: { initialization: "Échec de l’initialisation de la mémoire", "scope-resolution": "Impossible de résoudre la portée mémoire de ce tour", "policy-store": "Le registre de politique mémoire est indisponible", "runtime-configuration": "La configuration du runtime mémoire est indisponible", identity: "Échec de la vérification de l’identité du service mémoire", provider: "Échec du fournisseur de mémoire", ownership: "Échec de la vérification de propriété de la mémoire", deadline: "Le rappel mémoire a dépassé son délai", "render-budget": "Le contexte mémoire dépasse le budget d’affichage", "stale-capability": "L’autorisation mémoire a expiré" } },
};
