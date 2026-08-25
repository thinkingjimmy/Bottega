/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides five-language concurrent operating permissions file formats and Full Access risk disclosure
 * [POS]: Permission feature catalog of shared/i18n/locales; The rank key, which is Agent PermissionMode, is listed, and the documentation does not assume suppliers
 */

export const permissionEn = {
  trigger: "Current action permission: {{mode}}",
  heading: "How should {{backend}} actions be approved?",
  learnMore: "Learn more",
  selected: "Selected",
  mode: {
    "ask-for-approval": {
      label: "Ask for approval",
      description: "Ask before actions that require your approval",
    },
    "approve-for-me": {
      label: "Approve for me",
      description: "Approve safe actions; sensitive requests still ask",
    },
    "full-access": {
      label: "Full access",
      description:
        "Unrestricted access to the internet and any file on your computer",
    },
  },
  fullAccess: {
    title: "Turn on Full Access?",
    description:
      "The Agent will be able to run commands, use the internet, and create and edit files outside this chat without your permission. AI Chat's control data remains protected, but your other files do not. This includes but is not limited to:",
    files: {
      title: "Files and folders",
      description:
        "Read, create, modify, upload, or delete files anywhere on this computer",
    },
    terminal: {
      title: "Terminal commands",
      description: "Run commands, install software, and change system settings",
    },
    internet: {
      title: "Internet and connected apps",
      description: "Access websites, send data, and use enabled plugins",
    },
    risk:
      "This comes with risks like loss or exposure of sensitive data and prompt injection. You can turn this off.",
    confirm: "Confirm",
    confirming: "Confirming…",
    failed: "Full Access could not be enabled: {{reason}}",
  },
};

type PermissionCatalog = typeof permissionEn;

export const permissionZhCN: PermissionCatalog = {
  trigger: "当前操作权限：{{mode}}",
  heading: "{{backend}} 的操作如何批准？",
  learnMore: "了解更多",
  selected: "已选择",
  mode: {
    "ask-for-approval": {
      label: "逐项询问",
      description: "需要你批准的操作，执行前先询问",
    },
    "approve-for-me": {
      label: "代我批准",
      description: "安全操作自动批准；敏感请求仍会询问",
    },
    "full-access": {
      label: "完全访问",
      description: "不受限制地访问互联网与这台电脑上的任何文件",
    },
  },
  fullAccess: {
    title: "开启完全访问？",
    description:
      "Agent 将无需你的许可即可执行命令、访问互联网，并在本次聊天之外创建和修改文件。AI Chat 的控制数据仍受保护，你的其他文件不受保护。这包括但不限于：",
    files: {
      title: "文件与文件夹",
      description: "读取、创建、修改、上传或删除这台电脑上任意位置的文件",
    },
    terminal: {
      title: "终端命令",
      description: "执行命令、安装软件并更改系统设置",
    },
    internet: {
      title: "互联网与已连接的应用",
      description: "访问网站、发送数据并使用已启用的插件",
    },
    risk: "这会带来敏感数据泄露或丢失、提示注入等风险。你可以随时关闭它。",
    confirm: "确认",
    confirming: "确认中…",
    failed: "无法开启完全访问：{{reason}}",
  },
};

export const permissionJa: PermissionCatalog = {
  trigger: "現在の操作権限：{{mode}}",
  heading: "{{backend}} の操作をどう承認しますか？",
  learnMore: "詳細",
  selected: "選択中",
  mode: {
    "ask-for-approval": {
      label: "毎回確認する",
      description: "承認が必要な操作は実行前に確認します",
    },
    "approve-for-me": {
      label: "任せて承認",
      description: "安全な操作は自動承認し、機微な要求は確認します",
    },
    "full-access": {
      label: "フルアクセス",
      description:
        "インターネットとこのコンピューター上のあらゆるファイルへ無制限にアクセス",
    },
  },
  fullAccess: {
    title: "フルアクセスを有効にしますか？",
    description:
      "Agent はあなたの許可なしにコマンドを実行し、インターネットを利用し、このチャットの外でファイルを作成・編集できるようになります。AI Chat の制御データは保護されますが、その他のファイルは保護されません。これには次が含まれます（これらに限りません）：",
    files: {
      title: "ファイルとフォルダー",
      description:
        "このコンピューター上のどこにあるファイルでも読み取り・作成・変更・アップロード・削除",
    },
    terminal: {
      title: "ターミナルコマンド",
      description: "コマンドの実行、ソフトウェアのインストール、システム設定の変更",
    },
    internet: {
      title: "インターネットと連携アプリ",
      description: "ウェブサイトへのアクセス、データ送信、有効なプラグインの利用",
    },
    risk:
      "機微なデータの流出や消失、プロンプトインジェクションなどのリスクがあります。いつでもオフにできます。",
    confirm: "確認",
    confirming: "確認中…",
    failed: "フルアクセスを有効にできませんでした：{{reason}}",
  },
};

export const permissionFr: PermissionCatalog = {
  trigger: "Permission d’action actuelle : {{mode}}",
  heading: "Comment approuver les actions de {{backend}} ?",
  learnMore: "En savoir plus",
  selected: "Sélectionné",
  mode: {
    "ask-for-approval": {
      label: "Demander l’approbation",
      description: "Demander avant les actions qui nécessitent votre approbation",
    },
    "approve-for-me": {
      label: "Approuver pour moi",
      description:
        "Approuver les actions sûres ; les demandes sensibles restent soumises à approbation",
    },
    "full-access": {
      label: "Accès complet",
      description:
        "Accès illimité à Internet et à tous les fichiers de cet ordinateur",
    },
  },
  fullAccess: {
    title: "Activer l’accès complet ?",
    description:
      "L’Agent pourra exécuter des commandes, utiliser Internet, créer et modifier des fichiers hors de ce chat sans votre permission. Les données de contrôle d’AI Chat restent protégées, mais pas vos autres fichiers. Cela comprend notamment :",
    files: {
      title: "Fichiers et dossiers",
      description:
        "Lire, créer, modifier, téléverser ou supprimer des fichiers partout sur cet ordinateur",
    },
    terminal: {
      title: "Commandes du terminal",
      description:
        "Exécuter des commandes, installer des logiciels et modifier les réglages système",
    },
    internet: {
      title: "Internet et applications connectées",
      description:
        "Accéder aux sites web, envoyer des données et utiliser les plugins activés",
    },
    risk:
      "Cela comporte des risques : perte ou exposition de données sensibles et injection de prompt. Vous pouvez le désactiver à tout moment.",
    confirm: "Confirmer",
    confirming: "Confirmation…",
    failed: "Impossible d’activer l’accès complet : {{reason}}",
  },
};

export const permissionEs: PermissionCatalog = {
  trigger: "Permiso de acción actual: {{mode}}",
  heading: "¿Cómo se deben aprobar las acciones de {{backend}}?",
  learnMore: "Más información",
  selected: "Seleccionado",
  mode: {
    "ask-for-approval": {
      label: "Pedir aprobación",
      description: "Preguntar antes de las acciones que requieran tu aprobación",
    },
    "approve-for-me": {
      label: "Aprobar por mí",
      description:
        "Aprobar las acciones seguras; las solicitudes sensibles siguen preguntando",
    },
    "full-access": {
      label: "Acceso total",
      description:
        "Acceso sin restricciones a internet y a cualquier archivo de este equipo",
    },
  },
  fullAccess: {
    title: "¿Activar el acceso total?",
    description:
      "El Agent podrá ejecutar comandos, usar internet y crear o editar archivos fuera de este chat sin tu permiso. Los datos de control de AI Chat siguen protegidos, pero tus demás archivos no. Esto incluye, entre otros:",
    files: {
      title: "Archivos y carpetas",
      description:
        "Leer, crear, modificar, subir o eliminar archivos en cualquier lugar de este equipo",
    },
    terminal: {
      title: "Comandos de terminal",
      description:
        "Ejecutar comandos, instalar software y cambiar la configuración del sistema",
    },
    internet: {
      title: "Internet y apps conectadas",
      description: "Acceder a sitios web, enviar datos y usar los plugins activados",
    },
    risk:
      "Esto conlleva riesgos como la pérdida o exposición de datos sensibles y la inyección de prompts. Puedes desactivarlo cuando quieras.",
    confirm: "Confirmar",
    confirming: "Confirmando…",
    failed: "No se pudo activar el acceso total: {{reason}}",
  },
};
