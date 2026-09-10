/**
 * [INPUT]: Depends on no runtime modules; five locale branches share the English Setup catalog shape
 * [OUTPUT]: Provides five-language setup actions, unverified/expired/failed verification explanations and backend recovery guidance
 * [POS]: The Setup feature catalog; it keeps product language in the renderer while main transports only runtime/auth facts and raw diagnostics
 */

/* ============================================================
 * 指令为什么住在 renderer 的目录里，而不是 main 的 descriptor 上：
 * 「该装还是该登」是 runtimeStatus 的函数，renderer 手里本就有这一位；
 * main 多返回一个 setupGuide 字符串，只换来产品文案被烤成一门语言。
 * 诊断（CLI 原文）与指令（产品的话）是两种本体，拼成一个串就再也分不开。
 * ============================================================ */

export const setupEn = {
  provider: {
    mainWindowOnly: "Manage the Agent environment in the main window.",
    terminalClipboard: "The terminal is unavailable. The command was copied to the clipboard.",
  },
  install: "Install", login: "Sign in", manageLogin: "Manage sign-in", update: "Update available",
  updateAria: "Update {{backend}}", recheck: "Check {{backend}} again",
  details: "What to do about {{backend}}",
  verification: {
    unverified: "Sign-in hasn't been verified. You can try a chat or manage sign-in.",
    expired: "The previous sign-in check is out of date. Check again to refresh it.",
    failed: "Couldn't verify sign-in. Check again, or manage sign-in in your terminal.",
  },
  guide: {
    claude: { install: "Install Claude Code first.", login: "Run `claude auth login` in a terminal." },
    codex: { install: "Install the Codex CLI first.", login: "Run `codex login` in a terminal." },
    kimi: { install: "Install Kimi Code first.", login: "Run `kimi login` in a terminal." },
    opencode: { install: "Install OpenCode first.", login: "Run `opencode auth login` in a terminal." },
  },
};
type SetupCatalog = typeof setupEn;

export const setupZhCN: SetupCatalog = {
  provider: {
    mainWindowOnly: "请在主窗口管理 Agent 环境。",
    terminalClipboard: "终端不可用，命令已复制到剪贴板。",
  },
  install: "安装", login: "登录", manageLogin: "管理登录", update: "可更新",
  updateAria: "更新 {{backend}}", recheck: "重新检测 {{backend}}",
  details: "{{backend}} 该怎么处理",
  verification: {
    unverified: "尚未验证登录状态。你可以直接尝试对话，或管理登录。",
    expired: "之前的登录验证已过期，请重新检测以确认当前状态。",
    failed: "未能确认登录状态。请重新检测，或在终端管理登录。",
  },
  guide: {
    claude: { install: "请先安装 Claude Code。", login: "请在终端运行 `claude auth login`。" },
    codex: { install: "请先安装 Codex CLI。", login: "请在终端运行 `codex login`。" },
    kimi: { install: "请先安装 Kimi Code。", login: "请在终端运行 `kimi login`。" },
    opencode: { install: "请先安装 OpenCode。", login: "请在终端运行 `opencode auth login`。" },
  },
};

export const setupJa: SetupCatalog = {
  provider: {
    mainWindowOnly: "Agent 環境はメインウィンドウで管理してください。",
    terminalClipboard: "ターミナルを利用できません。コマンドをクリップボードにコピーしました。",
  },
  install: "インストール", login: "ログイン", manageLogin: "ログインを管理", update: "更新できます",
  updateAria: "{{backend}} を更新", recheck: "{{backend}} を再検出",
  details: "{{backend}} の対処方法",
  verification: {
    unverified: "ログイン状態は未確認です。チャットを試すか、ログインを管理できます。",
    expired: "前回のログイン確認は期限切れです。再検出して現在の状態を確認してください。",
    failed: "ログイン状態を確認できませんでした。再検出するか、ターミナルでログインを管理してください。",
  },
  guide: {
    claude: { install: "先に Claude Code をインストールしてください。", login: "ターミナルで `claude auth login` を実行してください。" },
    codex: { install: "先に Codex CLI をインストールしてください。", login: "ターミナルで `codex login` を実行してください。" },
    kimi: { install: "先に Kimi Code をインストールしてください。", login: "ターミナルで `kimi login` を実行してください。" },
    opencode: { install: "先に OpenCode をインストールしてください。", login: "ターミナルで `opencode auth login` を実行してください。" },
  },
};

export const setupFr: SetupCatalog = {
  provider: {
    mainWindowOnly: "Gérez l’environnement Agent dans la fenêtre principale.",
    terminalClipboard: "Le terminal est indisponible. La commande a été copiée dans le presse-papiers.",
  },
  install: "Installer", login: "Se connecter", manageLogin: "Gérer la connexion", update: "Mise à jour disponible",
  updateAria: "Mettre à jour {{backend}}", recheck: "Revérifier {{backend}}",
  details: "Que faire pour {{backend}}",
  verification: {
    unverified: "La connexion n’a pas été vérifiée. Essayez un chat ou gérez la connexion.",
    expired: "La dernière vérification a expiré. Revérifiez l’état actuel.",
    failed: "Impossible de vérifier la connexion. Réessayez ou gérez la connexion dans le terminal.",
  },
  guide: {
    claude: { install: "Installez d'abord Claude Code.", login: "Exécutez `claude auth login` dans un terminal." },
    codex: { install: "Installez d'abord la CLI Codex.", login: "Exécutez `codex login` dans un terminal." },
    kimi: { install: "Installez d'abord Kimi Code.", login: "Exécutez `kimi login` dans un terminal." },
    opencode: { install: "Installez d'abord OpenCode.", login: "Exécutez `opencode auth login` dans un terminal." },
  },
};

export const setupEs: SetupCatalog = {
  provider: {
    mainWindowOnly: "Gestiona el entorno del Agent en la ventana principal.",
    terminalClipboard: "La terminal no está disponible. El comando se copió al portapapeles.",
  },
  install: "Instalar", login: "Iniciar sesión", manageLogin: "Gestionar inicio de sesión", update: "Actualización disponible",
  updateAria: "Actualizar {{backend}}", recheck: "Volver a comprobar {{backend}}",
  details: "Qué hacer con {{backend}}",
  verification: {
    unverified: "El inicio de sesión no se ha verificado. Prueba un chat o gestiona el inicio de sesión.",
    expired: "La última comprobación ha caducado. Vuelve a comprobar el estado actual.",
    failed: "No se pudo verificar el inicio de sesión. Vuelve a comprobarlo o gestiónalo en la terminal.",
  },
  guide: {
    claude: { install: "Instala primero Claude Code.", login: "Ejecuta `claude auth login` en una terminal." },
    codex: { install: "Instala primero la CLI de Codex.", login: "Ejecuta `codex login` en una terminal." },
    kimi: { install: "Instala primero Kimi Code.", login: "Ejecuta `kimi login` en una terminal." },
    opencode: { install: "Instala primero OpenCode.", login: "Ejecuta `opencode auth login` en una terminal." },
  },
};
