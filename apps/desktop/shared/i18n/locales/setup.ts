/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides five languages of syntax Setup backend card text: status tags, actions, and the installation/login instructions in the backend × runtimeStatus key
 * [POS]: Setup feature catalog for shared/i18n/locales; The main is to stop roasting the product instructions into the diagnostic string, and the instructions here are to take the id key, and the renderer will take the unspelled one
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
  status: { ready: "Ready", missing: "Not installed", unsupported: "Update required", "auth-required": "Sign-in required", error: "Check failed" },
  install: "Install", login: "Sign in", update: "Update available",
  updateAria: "Update {{backend}}", checkLatest: "Check the latest {{backend}} version", recheck: "Check {{backend}} again",
  details: "What to do about {{backend}}",
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
  status: { ready: "就绪", missing: "未安装", unsupported: "版本过低", "auth-required": "待登录", error: "检测失败" },
  install: "安装", login: "登录", update: "可更新",
  updateAria: "更新 {{backend}}", checkLatest: "检查 {{backend}} 最新版本", recheck: "重新检测 {{backend}}",
  details: "{{backend}} 该怎么处理",
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
  status: { ready: "利用可能", missing: "未インストール", unsupported: "更新が必要", "auth-required": "ログインが必要", error: "検出に失敗" },
  install: "インストール", login: "ログイン", update: "更新できます",
  updateAria: "{{backend}} を更新", checkLatest: "{{backend}} の最新バージョンを確認", recheck: "{{backend}} を再検出",
  details: "{{backend}} の対処方法",
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
  status: { ready: "Prêt", missing: "Non installé", unsupported: "Mise à jour requise", "auth-required": "Connexion requise", error: "Échec de la détection" },
  install: "Installer", login: "Se connecter", update: "Mise à jour disponible",
  updateAria: "Mettre à jour {{backend}}", checkLatest: "Vérifier la dernière version de {{backend}}", recheck: "Revérifier {{backend}}",
  details: "Que faire pour {{backend}}",
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
  status: { ready: "Listo", missing: "No instalado", unsupported: "Requiere actualización", "auth-required": "Requiere inicio de sesión", error: "Fallo la comprobación" },
  install: "Instalar", login: "Iniciar sesión", update: "Actualización disponible",
  updateAria: "Actualizar {{backend}}", checkLatest: "Comprobar la última versión de {{backend}}", recheck: "Volver a comprobar {{backend}}",
  details: "Qué hacer con {{backend}}",
  guide: {
    claude: { install: "Instala primero Claude Code.", login: "Ejecuta `claude auth login` en una terminal." },
    codex: { install: "Instala primero la CLI de Codex.", login: "Ejecuta `codex login` en una terminal." },
    kimi: { install: "Instala primero Kimi Code.", login: "Ejecuta `kimi login` en una terminal." },
    opencode: { install: "Instala primero OpenCode.", login: "Ejecuta `opencode auth login` en una terminal." },
  },
};
