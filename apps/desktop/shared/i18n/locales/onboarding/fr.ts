/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingFr, the French Onboarding catalog
 * [POS]: French leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingFr: typeof onboardingEn = {
  agentLater: "Installer plus tard",
  agentLaterFailed: "Impossible d’enregistrer ce choix. Réessayez.",
  folderProgress: {"opening": "Ouverture de vos fichiers… {{completed}} sur {{total}}", "saving": "Enregistrement de vos fichiers… {{completed}} sur {{total}}"} ,
  agentInstalled: "Installé",
  agentChecking: "Vérification…",
  agentInstalling: "Installation en attente…",
  agentCheckFailed: "Impossible de vérifier l’installation. Réessayez.",
  step: { "chat-home": "Emplacement", agent: "Agent", extras: "Plus de possibilités" },
  heading: { "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Configurez votre Agent", extras: "Tirez davantage parti de {{product}}" },
  back: "Retour", next: "Continuer", start: "Commencer",
  description: { "chat-home": "Choisissez un dossier Bottega existant pour en restaurer le contenu, ou un dossier vide pour commencer. Les réglages du compte, les clés et les autorisations restent sur cet ordinateur.", agent: "Installez au moins un Agent pour continuer.", extras: "Importez des Skills réutilisables et configurez la mémoire à long terme. Les deux sont facultatifs et modifiables plus tard dans Settings." },
  extras: { skills: "Skills", memory: "Mémoire à long terme" },
  skillsScanFailed: "Impossible de rechercher les Skills. Réessayez ou ajoutez-les plus tard dans Settings.",
  skillsImportTitle: "{{count}} Skills trouvés dans vos Agents existants",
  skillsImportDescription: "Importez-les pour les utiliser dans chaque conversation compatible.",
  skillsScanning: "Recherche des Skills existants…", skillsFound: "{{count}} Skills trouvés dans vos Agents existants · Importez-les pour les utiliser dans chaque conversation compatible", skillsNone: "Aucun Skill à importer pour le moment", skillsDone: "Votre Skills Library personnelle est prête", skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
  chatHome: { unconfigured: "Choisissez un dossier sur cet ordinateur.", ready: "Votre dossier Bottega est prêt." },
  chatHomeUnset: "Pas encore choisi", choose: "Choisir un dossier…", opening: "Ouverture…",
  memoryEnabled: "Settings › Memory en montre l’activité et les lacunes.", memoryDisabled: "Installez le service de mémoire local et confirmez une fois la divulgation de confidentialité ; le rappel et l’extraction démarrent ensuite.",
  memoryAction: "Configurer la mémoire",
  memoryInstalling: "Installation de {{provider}}… se poursuit en arrière-plan. Vous pouvez commencer dès maintenant.", memoryInstallFailed: "L’installation de {{provider}} ne s’est pas terminée.",
  memoryConnect: "{{provider}} {{version}} est installé. Connectez un modèle pour terminer.", memoryReady: "{{provider}} est prêt. Activez-le pour lancer le rappel et l’extraction.",
  memoryProgress: "Voir la progression", memoryTurnOn: "Activer", memoryHide: "Masquer",
};
