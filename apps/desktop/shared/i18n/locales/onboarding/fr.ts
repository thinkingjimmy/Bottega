/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Includes Memory plugin enable, paused/resume and unsupported states; Provides onboardingFr, the French Onboarding catalog
 * [POS]: French leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingFr: typeof onboardingEn = {
  optional: "Facultatif",
  heading: { "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Configurez vos Agents", extras: "Tirez davantage parti de {{product}}" },
  description: {
    "chat-home": "Les conversations, fichiers et Skills vivent dans un dossier qui vous appartient. Dans tous les cas, les réglages du compte, les clés et les autorisations restent sur cet ordinateur.",
    agent: "{{product}} s’appuie sur les Agents de code de cet ordinateur. Installez-en au moins un pour continuer — vous pourrez ajouter les autres à tout moment depuis Settings › Providers.",
    extras: "Tout est facultatif. Passez ce que vous voulez et activez-le plus tard dans Settings.",
  },
  back: "Retour", next: "Continuer", start: "Commencer",
  folder: {
    aria: "Où conserver vos fichiers",
    fresh: "Repartir de zéro", recommended: "Recommandé", freshDetail: "Crée {{path}} pour vous.",
    found: "Reprendre là où vous en étiez", foundBadge: "Trouvé", foundDetail: "{{path}} contient déjà vos conversations et fichiers {{product}}.",
    choose: "Choisir un dossier…", chooseDetail: "Nouveau ou existant — {{product}} s’en charge.",
  },
  opening: "Ouverture…",
  folderProgress: { opening: "Ouverture de vos fichiers… {{completed}} sur {{total}}", saving: "Enregistrement de vos fichiers… {{completed}} sur {{total}}" },
  agentLater: "Installer plus tard",
  agentLaterFailed: "Impossible d’enregistrer ce choix. Réessayez.",
  agentInstalled: "Installé",
  agentChecking: "Vérification…",
  agentInstalling: "Installation en attente…",
  agentCheckFailed: "Impossible de vérifier l’installation. Réessayez.",
  agentAbout: { codex: "L’Agent de code d’OpenAI", claude: "L’Agent de code d’Anthropic", kimi: "L’Agent de code de Moonshot", opencode: "Open source, avec le modèle de votre choix" },
  extras: { skills: "Skills", memory: "Plugin Memory" },
  skillsAbout: "Importez les Skills que vos Agents possèdent déjà, pour que chaque conversation puisse les utiliser.",
  skillsFound: "{{count}} trouvés", skillsImported: "Importés", skillsImport: "Tout importer",
  skillsScanning: "Recherche des Skills existants…", skillsNone: "Aucun Skill à importer pour le moment", skillsDone: "Votre Skills Library personnelle est prête",
  skillsScanFailed: "Impossible de rechercher les Skills. Réessayez ou ajoutez-les plus tard dans Settings.",
  skillsImportTitle: "{{count}} Skills trouvés dans vos Agents existants",
  skillsImportDescription: "Importez-les pour les utiliser dans chaque conversation compatible.",
  skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
  memory: {
    badge: { start: "Non configurée", installing: "Installation", failed: "Inachevée", connect: "Installée", ready: "Prête", on: "Activée", paused: "En pause", unsupported: "Non pris en charge" },
    about: "Retient l’essentiel de vos conversations passées. Fait tourner un petit service sur cet ordinateur.",
    installing: "Installation de {{provider}} — se poursuit en arrière-plan. Vous pourrez terminer la configuration plus tard.",
    failed: "L’installation de {{provider}} ne s’est pas terminée.",
    connect: "{{provider}} {{version}} est installé. Connectez un modèle pour commencer à mémoriser.",
    ready: "{{provider}} est prêt. Activez-le pour lancer le rappel et l’extraction.",
    on: "Consultez les paramètres du plugin Memory pour voir son activité et les éléments manquants.",
    paused: "Memory est en pause. Les souvenirs enregistrés sont conservés.", resume: "Reprendre",
    setUp: "Configurer…", retry: "Réessayer…", connectAction: "Connecter…", progress: "Voir la progression", turnOn: "Activer le plugin Memory",
  },
};
