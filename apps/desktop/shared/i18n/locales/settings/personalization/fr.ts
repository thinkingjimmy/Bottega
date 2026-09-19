/**
 * [INPUT]: Depends on the settingsPersonalizationEn structural type
 * [OUTPUT]: Provides settingsPersonalizationFr, the French Settings › Personalization catalog
 * [POS]: French leaf of shared/i18n/locales/settings/personalization; loaded on demand by the matching top-level locale
 */

import type { settingsPersonalizationEn } from "./en";

export const settingsPersonalizationFr: typeof settingsPersonalizationEn = {
  title: "Personnalisation", sectionTitle: "Instructions personnalisées", description: "Modifiez le fichier d’instructions global de chaque Agent installé.",
  loading: "Chargement des fichiers d’instructions…", emptyTitle: "Aucun Agent installé", emptyHint: "Installez un Agent dans les réglages Backends, puis revenez ici.",
  placeholder: "Écrivez les instructions en texte brut pour cet Agent…", createHint: "Ce fichier n’existe pas encore. L’enregistrement le créera dans {{path}}.",
  save: "Enregistrer", saving: "Enregistrement…", copyPath: "Copier le chemin", copied: "Chemin copié", reveal: "Afficher dans le gestionnaire de fichiers",
  oversized: "Ce fichier dépasse 256 Kio ; il n’est ni chargé ni modifiable ici.",
  find: { open: "Rechercher dans le fichier", placeholder: "Rechercher dans le fichier", count: "{{current}} / {{total}}", noMatches: "Aucun résultat", previous: "Résultat précédent", next: "Résultat suivant", close: "Fermer la recherche" },
  metrics: { lines: "{{lines}} lignes", limit: "limite de {{size}}", recommendedLines: "{{lines}} lignes recommandées", recommendedSize: "{{size}} recommandé" },
  errors: { bridge: "La personnalisation n’est pas disponible dans cette version.", conflict: "Le fichier a été modifié hors de l’application. Vos modifications non enregistrées sont conservées ; réenregistrer écrasera la version plus récente du disque.", tooLarge: "Les instructions ne peuvent pas dépasser 256 Kio.", oversizedFile: "Le fichier dépasse 256 Kio et ne peut pas être modifié ici.", symlinkUnresolvable: "Le lien symbolique est rompu ou cyclique.", readFailed: "Impossible de lire le fichier en toute sécurité.", writeFailed: "Impossible d’enregistrer le fichier." },
};
