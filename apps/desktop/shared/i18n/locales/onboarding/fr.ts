/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingFr, the French Onboarding catalog
 * [POS]: French leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingFr: typeof onboardingEn = {
  rail: {
    steps: "Étapes de configuration",
    intro: "Trois étapes rapides. Tout ceci reste modifiable plus tard dans Settings.",
    footer: "{{product}} fonctionne en local. Rien ne quitte cet ordinateur sans votre demande.",
    done: "Terminé",
  },
  step: {
    "chat-home": { label: "Emplacement", hint: "Où vivent vos conversations et fichiers" },
    agent: { label: "Agents", hint: "Au moins un pour commencer à discuter" },
    extras: { label: "Plus", hint: "Skills et mémoire — facultatif" },
  },
  heading: { "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Configurez vos Agents", extras: "Tirez davantage parti de {{product}}" },
  description: {
    "chat-home": "Choisissez un dossier vide pour repartir de zéro, ou un dossier {{product}} existant pour reprendre là où vous vous étiez arrêté. Dans les deux cas, les réglages du compte, les clés et les autorisations restent sur cet ordinateur.",
    agent: "{{product}} s’appuie sur les Agents de code de cet ordinateur. Installez-en au moins un pour continuer — vous pourrez ajouter les autres à tout moment depuis Settings › Providers.",
    extras: "Tout est facultatif. Passez ce que vous voulez et activez-le plus tard dans Settings.",
  },
  back: "Retour", next: "Continuer", start: "Commencer",
  folder: "Dossier {{product}}",
  chatHome: { unconfigured: "Non choisi", ready: "Prêt" },
  chatHomeUnset: "Choisissez un dossier sur cet ordinateur.", choose: "Choisir…", opening: "Ouverture…",
  folderProgress: { opening: "Ouverture de vos fichiers… {{completed}} sur {{total}}", saving: "Enregistrement de vos fichiers… {{completed}} sur {{total}}" },
  agentLater: "Installer plus tard",
  agentLaterFailed: "Impossible d’enregistrer ce choix. Réessayez.",
  agentInstalled: "Installé",
  agentChecking: "Vérification…",
  agentInstalling: "Installation en attente…",
  agentCheckFailed: "Impossible de vérifier l’installation. Réessayez.",
  agentAbout: { codex: "L’Agent de code d’OpenAI", claude: "L’Agent de code d’Anthropic", kimi: "L’Agent de code de Moonshot", opencode: "Open source, avec le modèle de votre choix" },
  extras: { skills: "Skills", memory: "Mémoire à long terme" },
  skillsAbout: "Importez les Skills que vos Agents possèdent déjà, pour que chaque conversation puisse les utiliser.",
  skillsFound: "{{count}} trouvés", skillsImported: "Importés", skillsImport: "Tout importer",
  skillsScanning: "Recherche des Skills existants…", skillsNone: "Aucun Skill à importer pour le moment", skillsDone: "Votre Skills Library personnelle est prête",
  skillsScanFailed: "Impossible de rechercher les Skills. Réessayez ou ajoutez-les plus tard dans Settings.",
  skillsImportTitle: "{{count}} Skills trouvés dans vos Agents existants",
  skillsImportDescription: "Importez-les pour les utiliser dans chaque conversation compatible.",
  skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
  memory: {
    badge: { start: "Non configurée", installing: "Installation", failed: "Inachevée", connect: "Installée", ready: "Prête", on: "Activée" },
    about: "Retient l’essentiel de vos conversations passées. Fait tourner un petit service sur cet ordinateur.",
    installing: "Installation de {{provider}} — se poursuit en arrière-plan. Vous pourrez terminer la configuration plus tard.",
    failed: "L’installation de {{provider}} ne s’est pas terminée.",
    connect: "{{provider}} {{version}} est installé. Connectez un modèle pour commencer à mémoriser.",
    ready: "{{provider}} est prêt. Activez-le pour lancer le rappel et l’extraction.",
    on: "Settings › Memory en montre l’activité et les lacunes.",
    setUp: "Configurer…", retry: "Réessayer…", connectAction: "Connecter…", progress: "Voir la progression", turnOn: "Activer",
  },
};
