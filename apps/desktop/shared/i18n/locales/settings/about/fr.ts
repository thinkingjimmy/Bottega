/**
 * [INPUT]: Depends on the settingsAboutEn structural type
 * [OUTPUT]: Provides settingsAboutFr, the French Settings › About catalog
 * [POS]: French leaf of shared/i18n/locales/settings/about; loaded on demand by the matching top-level locale
 */

import type { settingsAboutEn } from "./en";

export const settingsAboutFr: typeof settingsAboutEn = {
  title: "À propos",
  tagline: "L’espace de travail Agent pour macOS",
  version: "Version {{version}}",
  licenseName: "Licence MIT",
  readLicense: "Lire la licence MIT",
  licenseUnavailable: "La licence incluse est indisponible. Consultez la copie officielle en ligne.",
  licenseCanonical: "Ouvrir la copie officielle",
  copy: "Copier",
  copied: "Copié",
  copyDiagnostics: "Copier les informations de version",
  links: "Liens",
  repository: "Dépôt source",
  feedback: "Signaler un problème",
  feedbackDescription: "Rechercher un problème connu ou en signaler un nouveau",
  releaseNotes: "Notes de version",
  releaseNotesDescription: "Ce qui a changé dans chaque version",
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
  backgroundFailedOpen:
    "Les vérifications automatiques des mises à jour échouent ; ouvrir les détails",
  check: "Rechercher les mises à jour",
  upgrade: "Mettre à jour",
  manualUpgrade: "Ouvrir la page de téléchargement",
  checkedAt: " · vérifié à {{time}}",
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
