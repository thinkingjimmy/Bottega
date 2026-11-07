/**
 * [INPUT]: Active interface locale only.
 * [OUTPUT]: Lightweight localized mode, locked footer and work-object trigger labels.
 * [POS]: Cold composer/sidebar shell; picker and management text load with their controls.
 */
const en={
  "standard": "Standard mode",
  "create": "Create mode",
  "mode": "Work mode",
  "locked": "Mode is locked after the first send. Start a new Chat to change it.",
  "object": "Work object",
  "plugins": "Plugins",
  "chat": "Chat",
  "unavailable": "This capability is unavailable on this computer.",
  "localOnly": "Plugin source editing runs on this computer. Select this computer to continue.",
  "loadFailed": "Could not load plugins. Retry to read their current state."
};
type Copy=typeof en;
const localized:Record<string,Copy>={
  "zh": {
    "standard": "标准模式",
    "create": "创造模式",
    "mode": "工作模式",
    "locked": "首轮后锁定，换模式请新建 Chat",
    "object": "工作对象",
    "plugins": "插件",
    "chat": "Chat",
    "unavailable": "此电脑暂不支持这项能力。",
    "localOnly": "插件源码编辑在本机执行。请选择本机后继续。",
    "loadFailed": "无法读取插件。重试以获取当前状态。"
  },
  "ja": {
    "standard": "標準モード",
    "create": "作成モード",
    "mode": "作業モード",
    "locked": "最初の送信後は固定されます。変更するには新しい Chat を作成してください。",
    "object": "作業対象",
    "plugins": "プラグイン",
    "chat": "Chat",
    "unavailable": "このコンピューターでは利用できません。",
    "localOnly": "プラグインのソース編集はこのコンピューターで実行します。このコンピューターを選択してください。",
    "loadFailed": "プラグインを読み込めません。再試行してください。"
  },
  "fr": {
    "standard": "Mode standard",
    "create": "Mode création",
    "mode": "Mode de travail",
    "locked": "Le mode est fixé après le premier envoi. Créez un nouveau Chat pour le modifier.",
    "object": "Objet de travail",
    "plugins": "Plugins",
    "chat": "Chat",
    "unavailable": "Cette fonction est indisponible sur cet ordinateur.",
    "localOnly": "Le code du plugin est modifié sur cet ordinateur. Sélectionnez cet ordinateur pour continuer.",
    "loadFailed": "Impossible de charger les plugins. Réessayez."
  },
  "es": {
    "standard": "Modo estándar",
    "create": "Modo de creación",
    "mode": "Modo de trabajo",
    "locked": "El modo se fija tras el primer envío. Inicia un Chat nuevo para cambiarlo.",
    "object": "Objeto de trabajo",
    "plugins": "Plugins",
    "chat": "Chat",
    "unavailable": "Esta función no está disponible en este equipo.",
    "localOnly": "El código del plugin se edita en este equipo. Selecciona este equipo para continuar.",
    "loadFailed": "No se pudieron cargar los plugins. Reinténtalo."
  }
};
export const pluginContextCopy=(locale:string):Copy=>localized[locale.toLowerCase().split('-')[0]??'en']??en;
