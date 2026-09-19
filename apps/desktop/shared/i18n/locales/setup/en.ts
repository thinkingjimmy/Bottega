/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides setupEn — active setup states, historical results, check causes, explicit Agent configuration and operation recovery — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/setup; it keeps product language in the renderer while main transports only runtime/auth facts and raw diagnostics
 */

// The renderer derives localized guidance from runtime facts; native CLI diagnostics remain separate.

export const setupEn = {
  configure: "Configure",
  provider: {
    mainWindowOnly: "Manage the Agent environment in the main window.",
  },
  install: "Install", login: "Sign in", manageLogin: "Manage sign-in", update: "Update available",
  updateAria: "Update {{backend}}", recheck: "Check {{backend}} again",
  checkAgain: "Check again",
  updateNow: "Update",
  reinstall: "Reinstall",
  more: "More actions for {{backend}}",
  completed: "I’ve finished, check again",
  checkedAt: "Last checked {{time}}",
  state: {
    installed: "Installed, try a chat",
    previouslyReady: "Previously ready",
    checkFailed: "Check incomplete",
    waiting: "Waiting for terminal",
    updateRequired: "Update required",
    signInRequired: "Sign-in required",
  },
  verification: {
    unverified: "Sign-in will be confirmed in your first conversation.",
    expired: "The last successful check is shown below.",
    failed: "The check couldn’t finish. Try again; the previous result is kept.",
    updateRequired: "Installed: {{version}}. Requires {{minimum}} or later.",
    signInRequired: "Sign in to use this Agent.",
    cannotCheck: "Couldn’t check the installation. Try again to confirm its status.",
    cannotStart: "This Agent couldn’t start. Check again, or reinstall from the more menu.",
    waiting: "Finish the terminal operation, then return here for an automatic check.",
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
  checkIssue: {
    timeout: "The check timed out. Try again when the Agent responds.",
    connection: "The check couldn’t reach the service. Check your connection and try again.",
    busy: "The Agent is busy. Try again when its current operation finishes.",
    failed: "The check could not finish. Check the details below and try again.",
  },
  guide: {
    claude: { install: "Install Claude Code first.", login: "Run `claude auth login` in a terminal." },
    codex: { install: "Install the Codex CLI first.", login: "Run `codex login` in a terminal." },
    kimi: { install: "Install Kimi Code first.", login: "Run `kimi login` in a terminal." },
    opencode: { install: "Install OpenCode first.", login: "Run `opencode auth login` in a terminal." },
  },
};
