/**
 * [INPUT]: Depends on the settingsBrowserEn structural type
 * [OUTPUT]: Provides settingsBrowserFr, the French Settings › Browser catalog
 * [POS]: French leaf of shared/i18n/locales/settings/browser; loaded on demand by the matching top-level locale
 */

import type { settingsBrowserEn } from "./en";

export const settingsBrowserFr: typeof settingsBrowserEn = {
  detecting: "Détection de Chrome…",
  noProfiles: "Google Chrome ou un profil utilisable est introuvable.",
  detectFailed: "Impossible de détecter les profils Chrome.",
  platformUnavailable: "L’import de connexion Chrome n’est pas disponible dans cette version d’aperçu.",
  guideTitle: "Utilisez vos sessions Chrome dans Bottega",
  guideDescription:
    "Importez l’état de connexion des sites choisis pour que les Agents naviguent comme vous. Vous choisissez le profil et les sites avant toute importation.",
  guideAction: "Importer depuis Chrome…",
  facts: {
    readOnlyTitle: "Lecture seule",
    readOnlyDetail: "Chrome n’est pas modifié.",
    localTitle: "Reste sur ce Mac",
    localDetail: "Les cookies ne sont jamais téléversés.",
    keychainTitle: "Accès au trousseau",
    keychainDetail: "macOS demande une seule fois ; refuser n’affecte pas Chrome.",
  },
  lastImport: "Dernière importation",
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
    "Après validation, macOS demandera l’accès à « Chrome Safe Storage ». Le déchiffrement et l’importation restent sur ce Mac ; aucun Cookie n’est envoyé. Un refus n’affecte pas Chrome.",
  importAction: "Importer la session",
  importFailed:
    "L’importation de la session a échoué. Vous pouvez toujours vous connecter une fois dans Browser et conserver la session.",
};
