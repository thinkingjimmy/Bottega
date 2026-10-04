/**
 * [INPUT]: The product locale.
 * [OUTPUT]: Shared evidence and remote recovery copy in five languages.
 * [POS]: Copy for workflow detail surfaces on desktop, Web and phone.
 */
const en = {
  files: "{count} changed files", commands: "{count} commands recorded", diff: "View diff", report: "Read full text", close: "Close evidence",
  loading: "Loading evidence…", failed: "Evidence could not be read. Keep the computer online and try again.",
  truncated: "This view is shortened (up to 64 KiB). Open the workflow Chat on the computer for the complete evidence.",
  unavailable: "No diff was saved for this step.", offline: "{computer} is offline. Connect it to continue.",
  upgrade: "Update Bottega on {computer} to use this action. You can still follow the instructions there.",
  plugin: "On {computer}, open Settings → Plugins → {provider} and turn it on, then retry this step.",
  provider: "On {computer}, open Settings → Providers → {provider} and finish setup or sign-in, then retry this step.",
  config: "On {computer}, open this Project’s workflow settings and choose an available Agent configuration for {step}.",
  enable: "Turn on {provider} on {computer}", enabling: "Turning on the plugin and retrying this step…",
  enableFailed: "Could not continue this step. Check the plugin and its dependencies on {computer}, then retry.",
};
type Copy = Record<keyof typeof en, string>;
const translations: Record<string, Copy> = {
  en,
  "zh-CN": { files: "{count} 个改动文件", commands: "已记录 {count} 条命令", diff: "查看 diff", report: "查看正文", close: "收起证据",
    loading: "正在读取证据…", failed: "未能读取证据，请让电脑保持在线后重试。", truncated: "当前展示已截断（最多 64 KiB）。请在电脑上打开流程 Chat 查看完整证据。",
    unavailable: "此步骤没有保存 diff。", offline: "{computer} 已离线，请连接后继续。", upgrade: "请更新 {computer} 上的 Bottega 以使用此操作。仍可按下方指引在电脑上处理。",
    plugin: "请在 {computer} 上打开“设置 → 插件 → {provider}”，开启后重试此步骤。",
    provider: "请在 {computer} 上打开“设置 → Provider → {provider}”，完成安装或登录后重试此步骤。",
    config: "请在 {computer} 上打开此 Project 的流程设置，为“{step}”选择可用的 Agent 配置。",
    enable: "在 {computer} 上开启 {provider}", enabling: "正在开启插件并重试此步骤…", enableFailed: "未能继续此步骤，请在 {computer} 上检查插件及其依赖后重试。" },
  ja: { files: "変更ファイル {count} 件", commands: "記録されたコマンド {count} 件", diff: "差分を表示", report: "全文を読む", close: "証拠を閉じる",
    loading: "証拠を読み込み中…", failed: "証拠を読めませんでした。コンピューターをオンラインにして再試行してください。", truncated: "表示は最大 64 KiB です。完全な証拠はコンピューターのワークフロー Chat で確認してください。",
    unavailable: "このステップの差分は保存されていません。", offline: "{computer} はオフラインです。接続して続行してください。", upgrade: "この操作には {computer} の Bottega の更新が必要です。下の手順は利用できます。",
    plugin: "{computer} で「設定 → プラグイン → {provider}」を開き、有効にしてから再試行してください。", provider: "{computer} で「設定 → Provider → {provider}」を開き、設定またはサインイン後に再試行してください。",
    config: "{computer} でこの Project のワークフロー設定を開き、{step} に利用可能な Agent 設定を選んでください。", enable: "{computer} で {provider} を有効にする", enabling: "プラグインを有効にして再試行中…", enableFailed: "続行できませんでした。{computer} でプラグインと依存関係を確認してください。" },
  fr: { files: "{count} fichiers modifiés", commands: "{count} commandes enregistrées", diff: "Voir le diff", report: "Lire le texte complet", close: "Fermer les preuves",
    loading: "Chargement des preuves…", failed: "Lecture impossible. Gardez l’ordinateur en ligne et réessayez.", truncated: "Vue limitée à 64 Kio. Ouvrez le Chat du workflow sur l’ordinateur pour les preuves complètes.",
    unavailable: "Aucun diff enregistré pour cette étape.", offline: "{computer} est hors ligne. Connectez-le pour continuer.", upgrade: "Mettez à jour Bottega sur {computer} pour cette action. Les instructions restent disponibles.",
    plugin: "Sur {computer}, ouvrez Réglages → Plugins → {provider}, activez-le puis réessayez cette étape.", provider: "Sur {computer}, ouvrez Réglages → Providers → {provider}, terminez la configuration ou la connexion puis réessayez.",
    config: "Sur {computer}, ouvrez les réglages du workflow de ce Project et choisissez une configuration Agent disponible pour {step}.", enable: "Activer {provider} sur {computer}", enabling: "Activation du plugin et nouvel essai…", enableFailed: "Impossible de continuer. Vérifiez le plugin et ses dépendances sur {computer}." },
  es: { files: "{count} archivos modificados", commands: "{count} comandos registrados", diff: "Ver diff", report: "Leer texto completo", close: "Cerrar evidencias",
    loading: "Cargando evidencias…", failed: "No se pudieron leer las evidencias. Conecta el ordenador e inténtalo de nuevo.", truncated: "Vista limitada a 64 KiB. Abre el Chat del flujo en el ordenador para ver todas las evidencias.",
    unavailable: "No se guardó un diff de este paso.", offline: "{computer} está sin conexión. Conéctalo para continuar.", upgrade: "Actualiza Bottega en {computer} para usar esta acción. Puedes seguir las instrucciones allí.",
    plugin: "En {computer}, abre Ajustes → Plugins → {provider}, actívalo y reintenta este paso.", provider: "En {computer}, abre Ajustes → Providers → {provider}, completa la configuración o el inicio de sesión y reintenta.",
    config: "En {computer}, abre los ajustes del flujo de este Project y elige una configuración Agent disponible para {step}.", enable: "Activar {provider} en {computer}", enabling: "Activando el plugin y reintentando…", enableFailed: "No se pudo continuar. Comprueba el plugin y sus dependencias en {computer}." },
};
export const detailCopy = (locale: string): Copy => translations[locale] ?? en;
