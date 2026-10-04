/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides setupEn — active setup states, install and sign-in actions and operation recovery — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/setup; it keeps product language in the renderer while main transports only runtime/auth facts and raw diagnostics
 */

// The renderer derives localized guidance from runtime facts; native CLI diagnostics remain separate.

export const setupEn = {
  provider: {
    mainWindowOnly: "Manage the Agent environment in the main window.",
  },
  install: "Install", login: "Sign in",
  checkAgain: "Check again",
  completed: "I’ve finished, check again",
  state: {
    installed: "Installed, try a chat",
    previouslyReady: "Previously ready",
    checkFailed: "Check incomplete",
    waiting: "Waiting for terminal",
    updateRequired: "Update required",
    signInRequired: "Sign-in required",
  },
  feedback: {
    load: "Couldn’t load Agent status",
    check: "Couldn’t complete the check",
    install: "Couldn’t open installation",
    update: "Couldn’t open the update",
    login: "Couldn’t open sign-in",
    clipboard: "Command copied",
    clipboardFailed: "Couldn’t copy the command",
    pasteCommand: "Paste and run the command in your terminal. Check again when you’re done.",
    retryHint: "Try again. Your previous Agent status is unchanged.",
  },
  guide: {
    claude: { install: "Install Claude Code first.", login: "Run `claude auth login` in a terminal." },
    codex: { install: "Install the Codex CLI first.", login: "Run `codex login` in a terminal." },
    kimi: { install: "Install Kimi Code first.", login: "Run `kimi login` in a terminal." },
    opencode: { install: "Install OpenCode first.", login: "Run `opencode auth login` in a terminal." },
  },
};
