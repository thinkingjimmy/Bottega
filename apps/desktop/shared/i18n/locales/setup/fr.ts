/**
 * [INPUT]: Depends on the setupEn structural type
 * [OUTPUT]: Provides setupFr, the French Setup catalog
 * [POS]: French leaf of shared/i18n/locales/setup; loaded on demand by the matching top-level locale
 */

import type { setupEn } from "./en";

export const setupFr: typeof setupEn = {
  provider: {
    mainWindowOnly: "Gérez l’environnement Agent dans la fenêtre principale.",
  },
  install: "Installer", login: "Se connecter",
  checkAgain: "Revérifier",
  completed: "J’ai terminé, revérifier",
  state: {
    installed: "Installé, prêt à essayer",
    previouslyReady: "Prêt au dernier contrôle",
    checkFailed: "Vérification incomplète",
    waiting: "En attente du terminal",
    updateRequired: "Mise à jour requise",
    signInRequired: "Connexion requise",
  },
  feedback: {
    load: "Impossible de charger l’état des Agents",
    check: "Impossible de terminer la vérification",
    install: "Impossible d’ouvrir l’installation",
    update: "Impossible d’ouvrir la mise à jour",
    login: "Impossible d’ouvrir la connexion",
    clipboard: "Commande copiée",
    clipboardFailed: "Impossible de copier la commande",
    pasteCommand: "Collez et exécutez la commande dans votre terminal. Revérifiez une fois terminé.",
    retryHint: "Réessayez. L’état précédent de l’Agent est conservé.",
  },
  guide: {
    claude: { install: "Installez d'abord Claude Code.", login: "Exécutez `claude auth login` dans un terminal." },
    codex: { install: "Installez d'abord la CLI Codex.", login: "Exécutez `codex login` dans un terminal." },
    kimi: { install: "Installez d'abord Kimi Code.", login: "Exécutez `kimi login` dans un terminal." },
    opencode: { install: "Installez d'abord OpenCode.", login: "Exécutez `opencode auth login` dans un terminal." },
  },
};
