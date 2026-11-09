/**
 * [INPUT]: Active locale and lightweight context trigger copy.
 * [OUTPUT]: Localized built-in and ordinary plugin mode descriptions, readable plugin provenance, source/Project search and native capability verification messages.
 * [POS]: On-demand mode/work-object menus; no cold entry dependency.
 */
import {pluginContextCopy} from './context-copy';
const en={
  "standardDescription": "Work with code, files and research. The Agent uses search, editing and terminal tools as needed.",
  "createDescription": "Customize Bottega through conversation. Create plugins, add features or interfaces, and combine tools and prompts into your own modes.",
  "pluginSource": "From {{plugin}}",
  "pluginModeDescription": "Use this plugin’s prompts and tools for your task.",
  "search": "Search projects or plugins",
  "projects": "Projects",
  "source": "Source project",
  "newProject": "New Project",
  "newPlugin": "New plugin",
  "workInChat": "Work in Chat",
  "empty": "No projects or plugins found.",
  "readonlyUnsupported": "Read-only access is not verified for ordinary Chat with this Agent.",
  "toolsUnsupported": "Native tool filtering is not verified for ordinary Chat with this Agent.",
  "more": "Load more",
  "nativeNote": "Plugin switches control Bottega tools. They do not disable the Agent CLI’s own tools.",
  "sourceMissing": "The source folder is missing. Restore the folder before editing."
};
type Copy=typeof en;
const localized:Record<string,Copy>={
  "zh": {
    "standardDescription": "处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。",
    "createDescription": "用对话定制 Bottega：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。",
    "pluginSource": "来自 {{plugin}}",
    "pluginModeDescription": "使用此插件的提示词和工具处理任务。",
    "search": "搜索项目或插件",
    "projects": "Projects",
    "source": "源工程",
    "newProject": "新建 Project",
    "newPlugin": "新建插件",
    "workInChat": "在 Chat 中工作",
    "empty": "未找到项目或插件。",
    "readonlyUnsupported": "普通 Chat 尚未验证此 Agent 的只读约束。",
    "toolsUnsupported": "普通 Chat 尚未验证此 Agent 的原生工具裁剪。",
    "more": "加载更多",
    "nativeNote": "插件开关控制 Bottega 工具，不会关闭 Agent CLI 自带的工具。",
    "sourceMissing": "找不到源码文件夹。请恢复文件夹后再编辑。"
  },
  "ja": {
    "standardDescription": "コード、ファイル、資料を扱う一般的な作業に適しています。Agent は必要に応じて検索、編集、ターミナルのツールを使います。",
    "createDescription": "会話で Bottega をカスタマイズします。プラグインや機能、画面を作成し、ツールとプロンプトを組み合わせて独自のモードも作れます。",
    "pluginSource": "提供元：{{plugin}}",
    "pluginModeDescription": "このプラグインのプロンプトとツールで作業します。",
    "search": "プロジェクトまたはプラグインを検索",
    "projects": "Projects",
    "source": "ソースプロジェクト",
    "newProject": "新規 Project",
    "newPlugin": "新規プラグイン",
    "workInChat": "Chat で作業",
    "empty": "プロジェクトやプラグインが見つかりません。",
    "readonlyUnsupported": "通常の Chat では、この Agent の読み取り専用制御は未検証です。",
    "toolsUnsupported": "通常の Chat では、この Agent のネイティブツール制限は未検証です。",
    "more": "さらに読み込む",
    "nativeNote": "プラグインのスイッチは Bottega ツールを制御します。Agent CLI 自身のツールは無効にしません。",
    "sourceMissing": "ソースフォルダーがありません。編集する前に復元してください。"
  },
  "fr": {
    "standardDescription": "Travaillez sur du code, des fichiers et des recherches. L’Agent utilise les outils de recherche, d’édition et de terminal selon les besoins.",
    "createDescription": "Personnalisez Bottega par la conversation. Créez des plugins, des fonctions ou des interfaces, et combinez outils et prompts dans vos propres modes.",
    "pluginSource": "Fourni par {{plugin}}",
    "pluginModeDescription": "Utilisez les prompts et les outils de ce plugin pour votre tâche.",
    "search": "Rechercher des projets ou plugins",
    "projects": "Projects",
    "source": "Projet source",
    "newProject": "Nouveau Project",
    "newPlugin": "Nouveau plugin",
    "workInChat": "Travailler dans Chat",
    "empty": "Aucun projet ou plugin trouvé.",
    "readonlyUnsupported": "La lecture seule avec cet Agent n’est pas vérifiée dans un Chat ordinaire.",
    "toolsUnsupported": "Le filtrage des outils natifs de cet Agent n’est pas vérifié dans un Chat ordinaire.",
    "more": "Charger la suite",
    "nativeNote": "Les interrupteurs contrôlent les outils de Bottega. Ils ne désactivent pas les outils propres au CLI de l’Agent.",
    "sourceMissing": "Le dossier source est introuvable. Restaurez-le avant toute modification."
  },
  "es": {
    "standardDescription": "Trabaja con código, archivos e investigación. El Agent usa herramientas de búsqueda, edición y terminal según sea necesario.",
    "createDescription": "Personaliza Bottega mediante la conversación. Crea plugins, funciones o interfaces, y combina herramientas y prompts en tus propios modos.",
    "pluginSource": "De {{plugin}}",
    "pluginModeDescription": "Usa los prompts y las herramientas de este plugin para tu tarea.",
    "search": "Buscar proyectos o plugins",
    "projects": "Projects",
    "source": "Proyecto de código",
    "newProject": "Nuevo Project",
    "newPlugin": "Nuevo plugin",
    "workInChat": "Trabajar en Chat",
    "empty": "No se encontraron proyectos ni plugins.",
    "readonlyUnsupported": "El acceso de solo lectura con este Agent no está verificado en un Chat normal.",
    "toolsUnsupported": "El filtrado de herramientas nativas de este Agent no está verificado en un Chat normal.",
    "more": "Cargar más",
    "nativeNote": "Los controles de plugins afectan a las herramientas de Bottega. No desactivan las herramientas propias del CLI del Agent.",
    "sourceMissing": "Falta la carpeta de código. Restáurala antes de editar."
  }
};
export const pluginPickerCopy=(locale:string)=>({...pluginContextCopy(locale),...(localized[locale.toLowerCase().split('-')[0]??'en']??en)});
