/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides five languages of syntax Settings › Personalization text file (see the editor's top-down action, premise slots, and the file to find the volume/recommended readings)
 * [POS]: The feature catalog of the global Agent instruction file shared/i18n/locales/settings; The unit symbol (KiB) is not in the international writing code catalog
 */

export const settingsPersonalizationEn = {
  title: "Personalization",
  sectionTitle: "Custom instructions",
  description: "Edit the global instruction file used by each installed Agent.",
  loading: "Loading instruction files…",
  emptyTitle: "No Agent is installed",
  emptyHint: "Install an Agent in Backends settings, then return here.",
  placeholder: "Write plain-text instructions for this Agent…",
  createHint: "This file does not exist yet. Saving creates it at {{path}}.",
  save: "Save instructions",
  saving: "Saving…",
  copyPath: "Copy path",
  copied: "Path copied",
  reveal: "Show in file manager",
  oversized: "This file is larger than 256 KiB. It is not loaded or editable here.",
  find: {
    open: "Find in file",
    placeholder: "Find in file",
    count: "{{current}} / {{total}}",
    noMatches: "No matches",
    previous: "Previous match",
    next: "Next match",
    close: "Close find",
  },
  metrics: {
    lines: "{{lines}} lines",
    limit: "{{size}} limit",
    recommendedLines: "{{lines}} lines recommended",
    recommendedSize: "{{size}} recommended",
  },
  errors: {
    bridge: "Personalization is unavailable in this app build.",
    conflict: "The file changed outside the app. Your unsaved edits are kept; saving again will overwrite the newer disk version.",
    tooLarge: "Instructions cannot exceed 256 KiB.",
    oversizedFile: "The file is larger than 256 KiB and cannot be edited here.",
    symlinkUnresolvable: "The symbolic link is broken or cyclic. Repair it before saving.",
    readFailed: "The instruction file could not be read safely.",
    writeFailed: "The instruction file could not be saved.",
  },
};

type Catalog = typeof settingsPersonalizationEn;

export const settingsPersonalizationZhCN: Catalog = {
  title: "个性化", sectionTitle: "自定义指令", description: "直接编辑每个已安装 Agent 使用的全局指令文件。",
  loading: "正在读取指令文件…", emptyTitle: "尚未安装 Agent", emptyHint: "请先在后端设置中安装 Agent，再返回这里。",
  placeholder: "为这个 Agent 编写纯文本指令…", createHint: "文件尚不存在；保存后会创建于 {{path}}。",
  save: "保存指令", saving: "正在保存…", copyPath: "复制路径", copied: "路径已复制", reveal: "在文件管理器中显示",
  oversized: "文件大于 256 KiB，因此不会在这里加载或编辑。",
  find: { open: "在文件中查找", placeholder: "在文件中查找", count: "{{current}} / {{total}}", noMatches: "无匹配", previous: "上一个匹配", next: "下一个匹配", close: "关闭查找" },
  metrics: { lines: "{{lines}} 行", limit: "上限 {{size}}", recommendedLines: "建议不超过 {{lines}} 行", recommendedSize: "建议不超过 {{size}}" },
  errors: { bridge: "当前应用版本不支持个性化。", conflict: "文件已在应用外被修改。你的未保存修改仍保留；再次保存将覆盖磁盘上的新版本。", tooLarge: "指令不能超过 256 KiB。", oversizedFile: "文件大于 256 KiB，无法在这里编辑。", symlinkUnresolvable: "符号链接已断开或形成循环，请修复后再保存。", readFailed: "无法安全读取指令文件。", writeFailed: "无法保存指令文件。" },
};

export const settingsPersonalizationJa: Catalog = {
  title: "パーソナライズ", sectionTitle: "カスタム指示", description: "インストール済み Agent ごとのグローバル指示ファイルを編集します。",
  loading: "指示ファイルを読み込み中…", emptyTitle: "Agent がインストールされていません", emptyHint: "バックエンド設定で Agent をインストールしてから戻ってください。",
  placeholder: "この Agent へのプレーンテキスト指示を入力…", createHint: "ファイルはまだありません。保存すると {{path}} に作成します。",
  save: "指示を保存", saving: "保存中…", copyPath: "パスをコピー", copied: "パスをコピーしました", reveal: "ファイルマネージャーで表示",
  oversized: "256 KiB を超えるため、ここでは読み込みも編集もしません。",
  find: { open: "ファイル内を検索", placeholder: "ファイル内を検索", count: "{{current}} / {{total}}", noMatches: "一致なし", previous: "前の一致", next: "次の一致", close: "検索を閉じる" },
  metrics: { lines: "{{lines}} 行", limit: "上限 {{size}}", recommendedLines: "推奨は {{lines}} 行以内", recommendedSize: "推奨は {{size}} 以内" },
  errors: { bridge: "このビルドではパーソナライズを利用できません。", conflict: "アプリ外でファイルが変更されました。未保存の編集は保持されています。再度保存するとディスク上の新しい版を上書きします。", tooLarge: "指示は 256 KiB 以下にしてください。", oversizedFile: "256 KiB を超えるため編集できません。", symlinkUnresolvable: "シンボリックリンクが壊れているか循環しています。", readFailed: "指示ファイルを安全に読み込めませんでした。", writeFailed: "指示ファイルを保存できませんでした。" },
};

export const settingsPersonalizationFr: Catalog = {
  title: "Personnalisation", sectionTitle: "Instructions personnalisées", description: "Modifiez le fichier d’instructions global de chaque Agent installé.",
  loading: "Chargement des fichiers d’instructions…", emptyTitle: "Aucun Agent installé", emptyHint: "Installez un Agent dans les réglages Backends, puis revenez ici.",
  placeholder: "Écrivez les instructions en texte brut pour cet Agent…", createHint: "Ce fichier n’existe pas encore. L’enregistrement le créera dans {{path}}.",
  save: "Enregistrer", saving: "Enregistrement…", copyPath: "Copier le chemin", copied: "Chemin copié", reveal: "Afficher dans le gestionnaire de fichiers",
  oversized: "Ce fichier dépasse 256 Kio ; il n’est ni chargé ni modifiable ici.",
  find: { open: "Rechercher dans le fichier", placeholder: "Rechercher dans le fichier", count: "{{current}} / {{total}}", noMatches: "Aucun résultat", previous: "Résultat précédent", next: "Résultat suivant", close: "Fermer la recherche" },
  metrics: { lines: "{{lines}} lignes", limit: "limite de {{size}}", recommendedLines: "{{lines}} lignes recommandées", recommendedSize: "{{size}} recommandé" },
  errors: { bridge: "La personnalisation n’est pas disponible dans cette version.", conflict: "Le fichier a été modifié hors de l’application. Vos modifications non enregistrées sont conservées ; réenregistrer écrasera la version plus récente du disque.", tooLarge: "Les instructions ne peuvent pas dépasser 256 Kio.", oversizedFile: "Le fichier dépasse 256 Kio et ne peut pas être modifié ici.", symlinkUnresolvable: "Le lien symbolique est rompu ou cyclique.", readFailed: "Impossible de lire le fichier en toute sécurité.", writeFailed: "Impossible d’enregistrer le fichier." },
};

export const settingsPersonalizationEs: Catalog = {
  title: "Personalización", sectionTitle: "Instrucciones personalizadas", description: "Edita el archivo global de instrucciones de cada Agent instalado.",
  loading: "Cargando archivos de instrucciones…", emptyTitle: "No hay ningún Agent instalado", emptyHint: "Instala un Agent en Ajustes de Backends y vuelve aquí.",
  placeholder: "Escribe instrucciones de texto sin formato para este Agent…", createHint: "El archivo aún no existe. Al guardar se creará en {{path}}.",
  save: "Guardar instrucciones", saving: "Guardando…", copyPath: "Copiar ruta", copied: "Ruta copiada", reveal: "Mostrar en el gestor de archivos",
  oversized: "El archivo supera 256 KiB; aquí no se carga ni se puede editar.",
  find: { open: "Buscar en el archivo", placeholder: "Buscar en el archivo", count: "{{current}} / {{total}}", noMatches: "Sin coincidencias", previous: "Coincidencia anterior", next: "Coincidencia siguiente", close: "Cerrar búsqueda" },
  metrics: { lines: "{{lines}} líneas", limit: "límite de {{size}}", recommendedLines: "{{lines}} líneas recomendadas", recommendedSize: "{{size}} recomendado" },
  errors: { bridge: "La personalización no está disponible en esta versión.", conflict: "El archivo cambió fuera de la aplicación. Tus cambios sin guardar se conservan; volver a guardar sobrescribirá la versión más reciente del disco.", tooLarge: "Las instrucciones no pueden superar 256 KiB.", oversizedFile: "El archivo supera 256 KiB y no se puede editar aquí.", symlinkUnresolvable: "El enlace simbólico está roto o es cíclico.", readFailed: "No se pudo leer el archivo de forma segura.", writeFailed: "No se pudo guardar el archivo." },
};
