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
  preview: {
    project: "Bottega Site",
    chats: { releaseNotes: "Publier les notes de version", settingsPanel: "Déplacer le panneau de réglages", changelog: "Rédiger les nouveautés", importTests: "Couvrir l’import CLI", onboarding: "Raccourcir l’onboarding", iconGrid: "Comparer les deux grilles d’icônes", acp: "Expliquer la négociation ACP" },
    priorAsk: "Parmi les PR fusionnées depuis 0.1.9, lesquelles un utilisateur remarquerait-il vraiment ?",
    priorReply: "Six sur dix-huit. La parité des Agents est celle qu’on sentira en premier ; les deux refactorisations internes tiennent en une ligne.",
    ask: "Rédige les notes de version 0.2.0 à partir des PR fusionnées depuis 0.1.9.",
    workedFor: "A travaillé {{duration}}",
    planTitle: "Notes de version 0.2.0", summary: "Résumé", summaryFirst: "Six changements majeurs depuis `0.1.9`, regroupés selon ce que l’utilisateur remarque d’abord.", summarySecond: "La parité des Agents ouvre la marche : `Kimi` et `OpenCode` atteignent désormais la même échelle d’autorisations que `Codex`.",
    plan: "Plan", model: "GPT-5.6 Sol",
    status: "Réponse en cours", askAnything: "Demandez ce que vous voulez",
  },
  skillsImportTitle: "{{count}} Skills trouvés dans vos Agents existants",
  skillsImportDescription: "Importez-les pour les utiliser dans chaque conversation compatible.",
  skillsImportAll: "Tout importer et activer", skillsSkip: "Ignorer", skillsUpdateFailed: "Impossible de mettre à jour l’accueil Skills",
};
