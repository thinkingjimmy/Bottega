/**
 * [INPUT]: Depends on the active locale and declared package capability names.
 * [OUTPUT]: Provides localized record permissions and accurate package installation descriptions.
 * [POS]: Shared human-readable disclosure; unknown capabilities remain visible verbatim for review.
 */
const en = { read: "Read the selected record", results: "Read this record’s results", report: "Save results with this record", settings: "Read this plugin’s settings",
  action: "Record action", ui: "Isolated record interface. No Chat session or desktop access.", process: "Plugin code running in a managed process on this computer.",
  enabled: "The plugin is enabled after confirmation.", disable: "Turn this plugin off before uninstalling it." };
type Copy = { [K in keyof typeof en]: string };
const copies: Record<string, Copy> = {
  en,
  "zh-cn": { read: "读取选中的记录", results: "读取该记录的结果", report: "为该记录保存结果", settings: "读取本插件的设置", action: "记录动作", ui: "隔离的记录界面，不提供对话或桌面访问权限。", process: "插件代码在这台电脑的受管进程中运行。", enabled: "确认后会启用插件。", disable: "请先关闭插件，再卸载。" },
  ja: { read: "選択したレコードを読む", results: "このレコードの結果を読む", report: "このレコードに結果を保存", settings: "このプラグインの設定を読む", action: "レコード操作", ui: "独立したレコード画面。チャットやデスクトップへのアクセスはありません。", process: "このコンピューターの管理対象プロセスで動くプラグインです。", enabled: "確認後にプラグインが有効になります。", disable: "アンインストール前にプラグインを無効にしてください。" },
  es: { read: "Leer el registro seleccionado", results: "Leer los resultados de este registro", report: "Guardar resultados en este registro", settings: "Leer los ajustes de este plugin", action: "Acción del registro", ui: "Interfaz aislada. Sin acceso al chat ni al escritorio.", process: "Código del plugin en un proceso administrado en este equipo.", enabled: "El plugin se activará después de confirmar.", disable: "Desactiva el plugin antes de desinstalarlo." },
  fr: { read: "Lire l’enregistrement sélectionné", results: "Lire les résultats de cet enregistrement", report: "Enregistrer des résultats pour cet enregistrement", settings: "Lire les réglages de ce plugin", action: "Action sur l’enregistrement", ui: "Interface isolée. Aucun accès au chat ou au bureau.", process: "Code du plugin exécuté dans un processus géré sur cet ordinateur.", enabled: "Le plugin sera activé après confirmation.", disable: "Désactivez ce plugin avant de le désinstaller." },
};
export const packageDisclosureCopy = (locale: string): Copy => copies[locale.toLowerCase()] ?? copies[locale.split("-")[0]] ?? en;
export function packagePermissionLabels(values: readonly string[], locale: string) {
  const copy = packageDisclosureCopy(locale), labels: Record<string, string | null> = {
    "record-ui:base.record.read": copy.read, "record-ui:base.results.list": copy.results, "record-ui:base.results.read": copy.results,
    "record-ui:base.results.report": copy.report, "record-ui:plugin.settings.read": copy.settings,
    "record-ui:plugin.open": null, "record-ui:plugin.heartbeat": null, "record-ui:plugin.close": null,
  };
  return [...new Set(values.flatMap(value => value.startsWith("record-action:") ? [`${copy.action}: ${value.slice(value.indexOf(" ") + 1)}`]
    : value in labels ? labels[value] ? [labels[value]!] : [] : [value]))];
}
