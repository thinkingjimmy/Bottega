/**
 * [INPUT]: Active locale and lightweight context trigger copy.
 * [OUTPUT]: Localized source/Project search and context-specific native capability verification messages.
 * [POS]: On-demand mode/work-object menus; no cold entry dependency.
 */
import {pluginContextCopy} from './context-copy';
const en={
  "search": "Search projects or plugins",
  "projects": "Projects",
  "source": "Source project",
  "newProject": "New Project",
  "newPlugin": "New plugin",
  "workInChat": "Work in Chat",
  "empty": "No projects or plugins found.",
  "readonlyUnsupported": "Read-only access is not verified for ordinary Chat with this Agent.",
  "toolsUnsupported": "Native tool filtering is not verified for ordinary Chat with this Agent.",
  "sessionsUnsupported": "This Agent cannot continue member sessions.",
  "more": "Load more",
  "nativeNote": "Plugin switches control Bottega tools. They do not disable the Agent CLI’s own tools.",
  "sourceMissing": "The source folder is missing. Restore the folder before editing."
};
type Copy=typeof en;
const localized:Record<string,Copy>={
  "zh": {
    "search": "搜索项目或插件",
    "projects": "Projects",
    "source": "源工程",
    "newProject": "新建 Project",
    "newPlugin": "新建插件",
    "workInChat": "在 Chat 中工作",
    "empty": "未找到项目或插件。",
    "readonlyUnsupported": "普通 Chat 尚未验证此 Agent 的只读约束。",
    "toolsUnsupported": "普通 Chat 尚未验证此 Agent 的原生工具裁剪。",
    "sessionsUnsupported": "此 Agent 不支持继续成员会话。",
    "more": "加载更多",
    "nativeNote": "插件开关控制 Bottega 工具，不会关闭 Agent CLI 自带的工具。",
    "sourceMissing": "找不到源码文件夹。请恢复文件夹后再编辑。"
  },
  "ja": {
    "search": "プロジェクトまたはプラグインを検索",
    "projects": "Projects",
    "source": "ソースプロジェクト",
    "newProject": "新規 Project",
    "newPlugin": "新規プラグイン",
    "workInChat": "Chat で作業",
    "empty": "プロジェクトやプラグインが見つかりません。",
    "readonlyUnsupported": "通常の Chat では、この Agent の読み取り専用制御は未検証です。",
    "toolsUnsupported": "通常の Chat では、この Agent のネイティブツール制限は未検証です。",
    "sessionsUnsupported": "この Agent はメンバーセッションを継続できません。",
    "more": "さらに読み込む",
    "nativeNote": "プラグインのスイッチは Bottega ツールを制御します。Agent CLI 自身のツールは無効にしません。",
    "sourceMissing": "ソースフォルダーがありません。編集する前に復元してください。"
  },
  "fr": {
    "search": "Rechercher des projets ou plugins",
    "projects": "Projects",
    "source": "Projet source",
    "newProject": "Nouveau Project",
    "newPlugin": "Nouveau plugin",
    "workInChat": "Travailler dans Chat",
    "empty": "Aucun projet ou plugin trouvé.",
    "readonlyUnsupported": "La lecture seule avec cet Agent n’est pas vérifiée dans un Chat ordinaire.",
    "toolsUnsupported": "Le filtrage des outils natifs de cet Agent n’est pas vérifié dans un Chat ordinaire.",
    "sessionsUnsupported": "Cet Agent ne peut pas reprendre les sessions des membres.",
    "more": "Charger la suite",
    "nativeNote": "Les interrupteurs contrôlent les outils de Bottega. Ils ne désactivent pas les outils propres au CLI de l’Agent.",
    "sourceMissing": "Le dossier source est introuvable. Restaurez-le avant toute modification."
  },
  "es": {
    "search": "Buscar proyectos o plugins",
    "projects": "Projects",
    "source": "Proyecto de código",
    "newProject": "Nuevo Project",
    "newPlugin": "Nuevo plugin",
    "workInChat": "Trabajar en Chat",
    "empty": "No se encontraron proyectos ni plugins.",
    "readonlyUnsupported": "El acceso de solo lectura con este Agent no está verificado en un Chat normal.",
    "toolsUnsupported": "El filtrado de herramientas nativas de este Agent no está verificado en un Chat normal.",
    "sessionsUnsupported": "Este Agent no puede continuar las sesiones de los miembros.",
    "more": "Cargar más",
    "nativeNote": "Los controles de plugins afectan a las herramientas de Bottega. No desactivan las herramientas propias del CLI del Agent.",
    "sourceMissing": "Falta la carpeta de código. Restáurala antes de editar."
  }
};
export const pluginPickerCopy=(locale:string)=>({...pluginContextCopy(locale),...(localized[locale.toLowerCase().split('-')[0]??'en']??en)});
