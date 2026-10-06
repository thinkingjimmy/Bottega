/**
 * [INPUT]: Depends on the onboardingEn structural type
 * [OUTPUT]: Provides onboardingFr, the French two-step Onboarding and Chat Skills prompt catalog
 * [POS]: French leaf of shared/i18n/locales/onboarding; loaded on demand by the matching top-level locale
 */

import type { onboardingEn } from "./en";

export const onboardingFr: typeof onboardingEn = {
  heading: { "chat-home": "Où {{product}} doit-il conserver vos fichiers ?", agent: "Configurez vos Agents" },
  description: {
    "chat-home": "Les conversations, fichiers et Skills vivent dans un dossier qui vous appartient. Dans tous les cas, les réglages du compte, les clés et les autorisations restent sur cet ordinateur.",
    agent: "{{product}} s’appuie sur les Agents de code de cet ordinateur. Installez-en au moins un pour continuer — vous pourrez ajouter les autres à tout moment depuis Settings › Providers.",
  },
  next: "Continuer", start: "Commencer",
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
  skillsImportTitle: "{{count}} Skills trouvés dans vos Agents existants",
  skillsImportDescription: "Importez-les pour les utiliser dans chaque conversation compatible.",
  skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
};
