/**
 * [INPUT]: Depends on the settingsUpdatesEn structural type
 * [OUTPUT]: Provides settingsUpdatesFr, the French Settings › Updates catalog
 * [POS]: French leaf of shared/i18n/locales/settings/updates; loaded on demand by the matching top-level locale
 */

import type { settingsUpdatesEn } from "./en";

export const settingsUpdatesFr: typeof settingsUpdatesEn = {
  title: "Mises à jour",
  description: "Gérez les mises à jour de Bottega et des CLI des fournisseurs.",
  updateAll: "Tout mettre à jour",
  updateOne: "Mettre à jour {{name}}",
  upToDate: "{{name}} est à jour",
  updating: "Mise à jour de {{name}}…",
  latestUnknown: "Dernière version inconnue",
  cliFailed: "Échec de la mise à jour",
  cliUnchanged: "La mise à jour s’est terminée, mais la version n’a pas changé. Essayez dans le Terminal.",
  cliTimeout: "La mise à jour a pris trop de temps et a été arrêtée.",
  cliUnavailable: "Ce CLI ne peut pas être mis à jour d’ici.",
  retry: "Réessayer",
  log: "Journal",
  terminal: "Mettre à jour dans le Terminal",
  empty: "Aucun CLI de fournisseur n’est encore installé.",
  checking: "Recherche de mises à jour…",
  current: "À jour{{checkedAt}}",
  available: "La version {{version}} est disponible",
  downloading: "Téléchargement de {{version}}",
  installing: "Mise à jour téléchargée · redémarrage pour l’installer",
  failed: "Échec de la mise à jour : {{message}}",
  failedUnknown: "La mise à jour a échoué pour une raison inconnue.",
  failedFallback:
    "La mise à jour n'a pas pu être installée automatiquement. Ouvrez la page Releases pour télécharger la version {{version}}.",
  failedResolution:
    "Téléchargez la nouvelle version depuis la page Releases, ou signalez le problème sur GitHub.",
  backgroundFailed: "La dernière vérification automatique a échoué",
  backgroundFailedOpen: "Les vérifications automatiques échouent ; ouvrez Mises à jour pour les détails",
  check: "Rechercher les mises à jour",
  upgrade: "Mettre à jour",
  manualUpgrade: "Ouvrir la page de téléchargement",
  unavailable: "Le service de mise à jour est disponible dans l’application installée",
  platformSupport: "Prise en charge de la plateforme",
  preview: "Aperçu {{platform}}",
  previewDescription:
    "Le paquet, le lancement et les mises à jour sont pris en charge. Ces capacités restent désactivées jusqu’à la finalisation des contrats de garde et d’isolation de l’OS :",
  features: {
    agentTurns: "conversations Agent",
    headlessSandbox: "tâches Agent sans interface",
    ownedGitMutation: "mutations Git gérées",
    serverApps: "Apps serveur",
    chromeImport: "import de connexion Chrome",
    memory: "Memory gérée",
  },
};
