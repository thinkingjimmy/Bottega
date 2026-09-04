/**
 * [INPUT]: Depends on the chatSurfacesEn structural type
 * [OUTPUT]: Provides the French Chat surfaces catalog with the exact English structure
 * [POS]: French Chat surfaces locale leaf assembled into the existing chat namespace
 */

import { chatSurfacesEn } from "./en";

export const chatSurfacesFr: typeof chatSurfacesEn = {
  sidePanel: {
    shell: {
      loadingBase: "Chargement de Base",
      closePreview: "Fermer l’aperçu",
      readingFile: "Lecture du fichier…",
      bytes: "{{count}} octets",
      resize: "Redimensionner le panneau latéral",
      resizeHint:
        "Faites glisser ou utilisez les touches fléchées pour redimensionner le panneau latéral",
    },
    appGrant: {
      badgeAria:
        "Autorisations de {{name}} — données : {{data}} ; agit à votre place : {{delegation}}",
      on: "Activé",
      off: "Désactivé",
      omittedIntro:
        "L’Agent n’a pas vu cette App au tour précédent — {{reason}}",
      omission: {
        referenceLimit:
          "ce Chat contient trop d’Apps jointes. Retirez-en quelques-unes puis réessayez.",
        instructionBudget:
          "les instructions des Apps jointes dépassent la limite de 2 Ko. Retirez-en quelques-unes puis réessayez.",
        backendUnsupported:
          "le backend actuel ne possède aucun canal d’outils : agir à votre place est indisponible. L’accès aux fichiers en lecture seule reste appliqué.",
        baseToolsDisabled:
          "les outils de lecture et d’écriture de Base sont tous deux désactivés. Activez-les dans Réglages › Outils.",
      },
      degradation: {
        baseReadsDisabled:
          "Ce tour-ci, elle peut seulement modifier des lignes, pas lire les tables : la lecture de Base est désactivée.",
        baseRowMutationsDisabled:
          "Ce tour-ci, elle peut seulement lire les tables, pas modifier les lignes : la modification de lignes de Base est désactivée.",
      },
      excludedIntro:
        "Une Extension n’a pas été livrée au tour précédent, cette App ne fonctionne donc pas entièrement : {{items}}",
      excludedItem: "{{name}} ({{code}})",
      excludedRequiredItem: "{{name}} ({{code}}, obligatoire)",

      extensionDetails: "Détails des Extensions et de la livraison",
      requirementSummary:
        "Exigence : {{requirement}} ; installée : {{installed}} ; admission : {{admission}} ; génération : {{generation}} ; activée : {{enabled}} ; autorisée pour l’App : {{granted}}",
      required: "Obligatoire",
      optional: "Facultative",
      yes: "Oui",
      no: "Non",
      none: "Aucun",
      unknown: "Inconnu",
      unresolved: "Non résolu",
      configOverrideDiff: "Dérogation de configuration : {{value}}",
      eligible: "Éligibilité : {{value}}",
      turnActive: "Active pendant ce tour : {{active}}",
    },
    appTab: {
      readFailed: "Impossible de lire l’état de l’App",
      surfaceFailed: "Impossible d’émettre la surface de l’App",
      unavailable:
        "L’App est indisponible ou en cours de suppression. Son emplacement est conservé, mais aucune capacité d’exécution ou de données ne sera émise.",
      stop: "Arrêter l’App",
      startFailed: "Impossible de démarrer l’App",
      open: "Ouvrir l’App",
      notAuthorized:
        "Cette App n’est pas encore autorisée dans cette conversation : elle ne peut ni lire de données ni ouvrir sa surface ici.",
      authorize: "Autoriser dans cette conversation",
    },
    image: {
      fallbackTitle: "Image",
      preview: "Aperçu de l’image",
      previewNamed: "Aperçu de l’image : {{name}}",
      zoom: "Zoom",
      restoring: "Restauration de l’image",
      reading: "Lecture de l’image",
      unavailable:
        "L’image ne figure plus dans cette conversation ou est temporairement indisponible.",
      retry: "Réessayer",
    },
  },
  transcript: {
    image: {
      unavailable: "Aperçu de l’image indisponible",
      reading: "Lecture de l’image",
      generatedAlt: "Image générée",
      openInSidePanel: "Ouvrir l’image dans le panneau latéral : {{title}}",
      fallbackTitle: "Image",
    },
    actions: {
      copy: "Copier",
      copied: "Copié",
    },
    outlineLabel: "Plan de la conversation",
    plan: {
      editingAria: "Modification du Plan en cours",
      editing: "Modification",
      title: "Plan",
      copy: "Copier le Plan",
      copied: "Copié",
      collapsePanel: "Fermer le panneau latéral du Plan",
      showPanel: "Afficher le Plan dans le panneau latéral",
      showFullPanel: "Afficher le Plan complet dans le panneau latéral",
    },
    loadEarlier: "Afficher les messages précédents",
    loadingEarlier: "Chargement des messages précédents…",
    fatalResultTitle: "Le résultat de ce tour n’a pas pu être enregistré",
    fatalResultLocked:
      "La saisie reste verrouillée jusqu’à ce que vous ignoriez le résultat de ce tour.",
    abandonFatal: "Ignorer le résultat de ce tour",
    cleanupFailedTitle: "Le nettoyage des processus n’est pas terminé",
    cleanupFailed:
      "Le nettoyage du groupe de processus {{backend}} a échoué. Confirmez que les processus concernés sont terminés avant de déverrouiller ce Chat.",
    acknowledgeCleanup: "J’ai confirmé la fin des processus",
    loadedEarlier: "{{count}} messages précédents chargés",
    subagentDetailsCleared: "Les détails de ce Subagent ont été effacés",
    subagentDetailsLimited: "La limite des détails en temps réel est atteinte",
    showLess: "Afficher moins",
    showMore: "Afficher plus",
    openAttachmentInSidePanel:
      "Ouvrir l’image dans le panneau latéral : {{title}}",
    workingFor: "Traitement depuis {{duration}}",
  },
  usageLimit: {
    unavailable: "{{backend}} est temporairement indisponible",
    resetTime: "Heure de réinitialisation",
    usageWindow: "Période d’utilisation",
    window: {
      fiveHour: "Fenêtre de 5 heures",
      weekly: "Fenêtre hebdomadaire",
    },
    retry: "Réessayer maintenant",
    resetAt: "{{date}} ({{zone}})",
    aboutMinutes: "Environ {{minutes}} min",
    aboutHours: "Environ {{hours}} h",
    aboutHoursMinutes: "Environ {{hours}} h {{minutes}} min",
  },
};
