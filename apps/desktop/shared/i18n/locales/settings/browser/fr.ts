/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserFr, the French Settings › Browser catalog
 * [POS]: French leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserFr: typeof settingsBrowserEn = {
  sectionTitle: "Importer la session depuis Chrome",
  loginState: "Session Chrome",
  detecting: "Détection de Chrome…",
  detectingAria: "Détection de Chrome",
  readyDescription:
    "Choisissez un profil et des domaines avant l’importation. Les données Chrome sont en lecture seule et ne seront pas modifiées.",
  noProfiles: "Google Chrome ou un profil utilisable est introuvable.",
  detectFailed: "Impossible de détecter les profils Chrome.",
  platformUnavailable: "L’import de connexion Chrome n’est pas disponible dans cette version d’aperçu.",
  startImport: "Commencer l’importation",
  startImportAria: "Commencer à importer la session Chrome",
  learnMore: "En savoir plus",
  capability: {
    persistentTitle: "Se connecter une fois et conserver la session",
    persistentDetail:
      "Même sans importation, vous pouvez vous connecter dans le Browser intégré. Les Cookies persistent entre les onglets et les redémarrages, et l’Agent utilise la même session.",
    limitedTitle: "Mots de passe, extensions et favoris non importés",
    limitedDetail:
      "Electron n’expose ni le gestionnaire de mots de passe Chrome ni toutes ses API d’extension, et les favoris ne servent pas à l’Agent. Les données sensibles inutiles ne sont donc pas déplacées.",
  },
  result: "Importés {{imported}} / ignorés {{skipped}} / échecs {{failed}}",
  resultFallback:
    "Certains sites n’ont pas pu être importés. Connectez-vous une fois dans Browser pour conserver la session et la partager avec l’Agent.",
  dialogTitle: "Importer la session depuis Chrome",
  dialogDescription:
    "Choisissez un profil et les domaines à importer. Tous les domaines sont sélectionnés par défaut et peuvent être décochés. Les données Chrome ne sont pas modifiées.",
  profile: "Profil Chrome",
  cookieDomains: "Domaines des Cookies",
  selectedDomains: "{{domains}} domaines sélectionnés, environ {{cookies}} Cookies persistants",
  selectAll: "Tout sélectionner",
  deselectAll: "Tout désélectionner",
  loadingDomains: "Lecture des domaines…",
  previewUnknown: "Erreur inconnue",
  previewFailed: "Impossible de lire les domaines Cookie de ce profil.",
  previewFailureTruth:
    "Les Cookies de ce profil sont illisibles, ce qui ne signifie pas qu’il n’est pas connecté.",
  noCookies: "Ce profil ne contient aucun Cookie persistant à importer.",
  keychainNotice:
    "Après validation, macOS demandera l’accès à « Chrome Safe Storage ». Le déchiffrement et l’importation restent sur ce Mac ; aucun Cookie n’est envoyé. Un refus n’affecte pas Chrome.",
  importAction: "Importer la session",
  importFailed:
    "L’importation de la session a échoué. Vous pouvez toujours vous connecter une fois dans Browser et conserver la session.",
};
