/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingFr, the French Onboarding catalog
 * [POS]: French leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingFr: typeof onboardingEn = {
  mode: {"local": {"title": "Utiliser sur cet ordinateur", "description": "Tout reste sur cet ordinateur. Vous pourrez vous connecter et synchroniser dans les réglages."}, "account": {"title": "Connecter un compte existant", "description": "Connectez-vous à votre espace de synchronisation chiffré pour synchroniser le contenu entre appareils."}},
  accountUnavailable: "La connexion au compte est temporairement indisponible.",
  agentPlace: {"local": "Installer sur cet ordinateur", "remote": "Utiliser un autre ordinateur"},
  remoteEmpty: "Connectez-vous et installez un Agent sur un autre ordinateur.",
  folderProgress: {"opening": "Ouverture de vos fichiers… {{completed}} sur {{total}}", "saving": "Enregistrement de vos fichiers… {{completed}} sur {{total}}"} ,
  agentInstalled: "Installé",
  agentChecking: "Vérification…",
  agentInstalling: "Installation en attente…",
  agentCheckFailed: "Impossible de vérifier l’installation. Réessayez.",
  step: { mode: "Utilisation", account: "Connexion", "chat-home": "Emplacement", agent: "Agent", extras: "Plus de possibilités" },
  heading: { mode: "Comment utiliserez-vous {{product}} ?", "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Configurez votre Agent", extras: "Tirez davantage parti de {{product}}" },
  back: "Retour", next: "Continuer", start: "Commencer",
  description: { mode: "Choisissez comment commencer.", "chat-home": "Choisissez un dossier Bottega existant pour en restaurer le contenu, ou un dossier vide pour commencer. Les réglages du compte, les clés et les autorisations restent sur cet ordinateur.", agent: "Installez au moins un Agent pour continuer.", extras: "Importez des Skills réutilisables et configurez la mémoire à long terme. Les deux sont facultatifs et modifiables plus tard dans Settings." },
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
