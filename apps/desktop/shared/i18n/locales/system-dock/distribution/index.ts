/**
 * [INPUT]: The interface locale and the official directory's visible states.
 * [OUTPUT]: Localized descriptions, incompatibility reasons and failures for the browse dialog.
 * [POS]: Settings-only copy, loaded with the dialog.
 */
const translations = {
  "en": {
    "description": "Official Widgets from Bottega.",
    "unavailable": "The official catalog is temporarily unavailable.",
    "empty": "No Widgets available to download.",
    "update": "Update",
    "installedVersion": "Installed · {{version}}",
    "minimum": "Requires Bottega {{version}} or later.",
    "runtime": "This Mac cannot run the available versions.",
    "contract": "The available versions require a different Widget data contract.",
    "downloadFailed": "The Widget download failed. Try again.",
    "verificationFailed": "The Widget could not be verified. Try again.",
    "installFailed": "The Widget could not be installed. Try again.",
    "recover": "Repair from this build"
  },
  "zh-CN": {
    "description": "浏览 Bottega 发布的官方 Widget。",
    "unavailable": "官方目录暂时不可用。",
    "empty": "暂无可下载的 Widget。",
    "update": "更新",
    "installedVersion": "已安装 · {{version}}",
    "minimum": "需要 Bottega {{version}} 或更高版本。",
    "runtime": "此 Mac 无法运行可用版本。",
    "contract": "可用版本需要其他 Widget 数据接口。",
    "downloadFailed": "下载 Widget 失败。请重试。",
    "verificationFailed": "校验 Widget 失败。请重试。",
    "installFailed": "安装 Widget 失败。请重试。",
    "recover": "使用随包版本修复"
  },
  "ja": {
    "description": "Bottega の公式 Widget を閲覧します。",
    "unavailable": "公式カタログは一時的に利用できません。",
    "empty": "ダウンロードできる Widget はありません。",
    "update": "アップデート",
    "installedVersion": "インストール済み · {{version}}",
    "minimum": "Bottega {{version}} 以降が必要です。",
    "runtime": "この Mac で利用できるバージョンはありません。",
    "contract": "利用可能なバージョンには別の Widget データ仕様が必要です。",
    "downloadFailed": "Widget をダウンロードできませんでした。再試行してください。",
    "verificationFailed": "Widget を検証できませんでした。再試行してください。",
    "installFailed": "Widget をインストールできませんでした。再試行してください。",
    "recover": "同梱版で修復"
  },
  "fr": {
    "description": "Widgets officiels de Bottega.",
    "unavailable": "Le catalogue officiel est temporairement indisponible.",
    "empty": "Aucun widget à télécharger.",
    "update": "Mettre à jour",
    "installedVersion": "Installé · {{version}}",
    "minimum": "Nécessite Bottega {{version}} ou une version ultérieure.",
    "runtime": "Ce Mac ne peut pas exécuter les versions disponibles.",
    "contract": "Les versions disponibles exigent une autre interface de données.",
    "downloadFailed": "Échec du téléchargement. Réessayez.",
    "verificationFailed": "Échec de la vérification. Réessayez.",
    "installFailed": "Échec de l’installation. Réessayez.",
    "recover": "Réparer avec la version intégrée"
  },
  "es": {
    "description": "Widgets oficiales de Bottega.",
    "unavailable": "El catálogo oficial no está disponible temporalmente.",
    "empty": "No hay widgets para descargar.",
    "update": "Actualizar",
    "installedVersion": "Instalado · {{version}}",
    "minimum": "Requiere Bottega {{version}} o posterior.",
    "runtime": "Este Mac no puede ejecutar las versiones disponibles.",
    "contract": "Las versiones disponibles requieren otra interfaz de datos.",
    "downloadFailed": "No se pudo descargar el widget. Inténtalo de nuevo.",
    "verificationFailed": "No se pudo verificar el widget. Inténtalo de nuevo.",
    "installFailed": "No se pudo instalar el widget. Inténtalo de nuevo.",
    "recover": "Reparar con la versión incluida"
  }
};
export function widgetDirectoryCopy(locale: string) {
  return translations[locale as keyof typeof translations] ?? translations.en;
}
