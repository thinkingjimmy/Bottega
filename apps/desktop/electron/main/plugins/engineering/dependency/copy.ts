/**
 * [INPUT]: Active interface locale, plugin/package names supplied separately by the lazy dependency owner.
 * [OUTPUT]: Complete five-language dependency-script consent and skipped-script warning templates.
 * [POS]: Operation-loaded native copy; only dependency/owner imports it, so startup never loads these dictionaries eagerly.
 */
const en = {
  "title": "Plugin dependency scripts",
  "message": "Allow dependency build scripts for {plugin}?",
  "packages": "These packages request installation scripts:",
  "detail": "Scripts run in the managed plugin build process. Keep them off unless this plugin needs their generated files.",
  "keepOff": "Keep scripts off",
  "allowBuilds": "Allow these build scripts",
  "skipped": "Installation scripts were skipped for {package}. Approve this dependency only if its build step is required."
};
type Copy = typeof en;
const localized: Record<string, Copy> = {
  "zh": {
    "title": "插件依赖脚本",
    "message": "允许 {plugin} 的依赖构建脚本？",
    "packages": "以下软件包请求运行安装脚本：",
    "detail": "脚本在受管插件构建进程中运行。只有插件需要其生成文件时才启用。",
    "keepOff": "保持脚本关闭",
    "allowBuilds": "允许这些构建脚本",
    "skipped": "已跳过 {package} 的安装脚本。只有需要其构建步骤时才批准此依赖。"
  },
  "ja": {
    "title": "プラグインの依存スクリプト",
    "message": "{plugin} の依存ビルドスクリプトを許可しますか？",
    "packages": "次のパッケージがインストールスクリプトを要求しています：",
    "detail": "スクリプトは管理されたプラグインのビルドプロセスで実行します。プラグインが生成ファイルを必要とする場合のみ許可してください。",
    "keepOff": "スクリプトを無効のままにする",
    "allowBuilds": "このビルドスクリプトを許可",
    "skipped": "{package} のインストールスクリプトを省略しました。ビルド処理が必要な場合のみ、この依存関係を許可してください。"
  },
  "fr": {
    "title": "Scripts des dépendances du plugin",
    "message": "Autoriser les scripts de compilation des dépendances pour {plugin} ?",
    "packages": "Ces paquets demandent des scripts d’installation :",
    "detail": "Les scripts s’exécutent dans le processus de compilation géré du plugin. Laissez-les désactivés sauf si le plugin a besoin des fichiers générés.",
    "keepOff": "Garder les scripts désactivés",
    "allowBuilds": "Autoriser ces scripts de compilation",
    "skipped": "Les scripts d’installation de {package} ont été ignorés. Autorisez cette dépendance uniquement si son étape de compilation est nécessaire."
  },
  "es": {
    "title": "Scripts de dependencias del plugin",
    "message": "¿Permitir scripts de compilación de dependencias para {plugin}?",
    "packages": "Estos paquetes solicitan scripts de instalación:",
    "detail": "Los scripts se ejecutan en el proceso gestionado de compilación del plugin. Déjalos desactivados salvo que el plugin necesite los archivos generados.",
    "keepOff": "Mantener los scripts desactivados",
    "allowBuilds": "Permitir estos scripts de compilación",
    "skipped": "Se omitieron los scripts de instalación de {package}. Aprueba esta dependencia solo si necesita su paso de compilación."
  }
};
export const pluginDependencyCopy = (locale: string): Copy => localized[locale.toLowerCase().startsWith('zh') ? 'zh' : locale.split('-')[0] ?? 'en'] ?? en;
