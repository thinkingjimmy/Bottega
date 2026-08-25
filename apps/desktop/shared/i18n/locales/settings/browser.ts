/**
 * [INPUT]: dependence when not in operation; The first is the installation of five local directories
 * [OUTPUT]: Provides five languages for Settings › Browser text
 * [POS]: Browser feature catalog of shared/i18n/locales/settings; Chrome profile, domain name and underlying diagnostic source remain untranslated
 */

export const settingsBrowserEn = {
  sectionTitle: "Import sign-in state from Chrome",
  loginState: "Chrome sign-in state",
  detecting: "Detecting Chrome…",
  detectingAria: "Detecting Chrome",
  readyDescription:
    "Choose a profile and domains before importing. Chrome data is read-only and will not be modified.",
  noProfiles: "Google Chrome or a usable profile was not found.",
  detectFailed: "Could not detect Chrome profiles.",
  startImport: "Start import",
  startImportAria: "Start importing Chrome sign-in state",
  learnMore: "Learn more",
  capability: {
    persistentTitle: "Sign in once and keep the session",
    persistentDetail:
      "You can sign in directly in the embedded Browser even if you skip import. Cookies persist across tabs and app restarts, and the Agent inherits the same session.",
    limitedTitle: "Passwords, extensions, and bookmarks are not imported",
    limitedDetail:
      "Electron does not expose Chrome's password manager or full extension APIs, and bookmarks are not used for Agent browsing. This avoids moving sensitive data without a practical benefit.",
  },
  result: "Imported {{imported}} / skipped {{skipped}} / failed {{failed}}",
  resultFallback:
    "Some sites could not be imported. Sign in once in Browser to keep the session and share it with the Agent.",
  dialogTitle: "Import sign-in state from Chrome",
  dialogDescription:
    "Choose a profile and the domains to import. All domains are selected by default and can be cleared individually. Chrome data is read-only and will not be modified.",
  profile: "Chrome profile",
  cookieDomains: "Cookie domains",
  selectedDomains:
    "{{domains}} domains selected, about {{cookies}} persistent cookies",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  loadingDomains: "Reading domains…",
  previewUnknown: "Unknown error",
  previewFailed: "Could not read Cookie domains from this profile.",
  previewFailureTruth:
    "This profile's Cookies could not be read—it does not mean the profile has no sign-in state.",
  noCookies: "This profile has no persistent Cookies available to import.",
  keychainNotice:
    "After you continue, macOS will request access to “Chrome Safe Storage”. Decryption and import happen only on this Mac; Cookies are never uploaded. Denying access does not affect Chrome.",
  importAction: "Import sign-in state",
  importFailed:
    "Sign-in state import failed. You can still sign in once in Browser and keep the session.",
};

type SettingsBrowserCatalog = typeof settingsBrowserEn;

export const settingsBrowserZhCN: SettingsBrowserCatalog = {
  sectionTitle: "从 Chrome 导入登录态",
  loginState: "Chrome 登录态",
  detecting: "正在检测 Chrome…",
  detectingAria: "正在检测 Chrome",
  readyDescription: "选择 profile 与域名后再导入。Chrome 数据只读，不会被修改。",
  noProfiles: "未发现 Google Chrome 或可用 profile。",
  detectFailed: "无法检测 Chrome profiles。",
  startImport: "开始导入",
  startImportAria: "开始导入 Chrome 登录态",
  learnMore: "了解更多",
  capability: {
    persistentTitle: "登录一次，长期继承",
    persistentDetail:
      "即使跳过导入，也可直接在内嵌 Browser 登录；Cookie 会跨 tab 与应用重启保存，Agent 后续访问自动继承。",
    limitedTitle: "不导入密码、扩展与书签",
    limitedDetail:
      "Electron 没有 Chrome 密码管理器与完整扩展 API；书签不参与 Agent 浏览。避免搬运敏感数据却得不到实际功能。",
  },
  result: "已导入 {{imported}} / 跳过 {{skipped}} / 失败 {{failed}}",
  resultFallback:
    "部分站点未能导入。直接在 Browser 中登录一次即可长期保留，Agent 也会继承同一会话。",
  dialogTitle: "从 Chrome 导入登录态",
  dialogDescription:
    "选择一个 profile 和需要导入的域名。域名默认全选，可逐项取消。Chrome 数据只读，不会被修改。",
  profile: "Chrome profile",
  cookieDomains: "Cookie 域名",
  selectedDomains: "已选 {{domains}} 个域名，约 {{cookies}} 条持久 Cookie",
  selectAll: "全选",
  deselectAll: "取消全选",
  loadingDomains: "正在读取域名…",
  previewUnknown: "未知错误",
  previewFailed: "无法读取这个 profile 的 Cookie 域名。",
  previewFailureTruth: "读不到这个 profile 的 Cookie——不代表它没有登录态。",
  noCookies: "这个 profile 没有可导入的持久 Cookie。",
  keychainNotice:
    "点击后 macOS 会请求访问“Chrome Safe Storage”。解密和写入只在这台 Mac 上进行，Cookie 不会上传。取消授权不会影响 Chrome。",
  importAction: "导入登录态",
  importFailed:
    "登录态导入失败。你仍可直接在 Browser 中登录一次，登录态会长期保留。",
};

export const settingsBrowserJa: SettingsBrowserCatalog = {
  sectionTitle: "Chrome からログイン状態をインポート",
  loginState: "Chrome のログイン状態",
  detecting: "Chrome を検出中…",
  detectingAria: "Chrome を検出中",
  readyDescription:
    "profile とドメインを選んでからインポートします。Chrome のデータは読み取り専用で、変更されません。",
  noProfiles: "Google Chrome または利用可能な profile が見つかりません。",
  detectFailed: "Chrome profile を検出できませんでした。",
  startImport: "インポートを開始",
  startImportAria: "Chrome のログイン状態のインポートを開始",
  learnMore: "詳細",
  capability: {
    persistentTitle: "一度ログインすればセッションを維持",
    persistentDetail:
      "インポートを省略しても内蔵 Browser で直接ログインできます。Cookie はタブとアプリ再起動をまたいで保持され、Agent も同じセッションを利用します。",
    limitedTitle: "パスワード、拡張機能、ブックマークは対象外",
    limitedDetail:
      "Electron は Chrome のパスワードマネージャーや完全な拡張 API を提供せず、ブックマークも Agent の閲覧には使いません。不要な機密データの移動を避けます。",
  },
  result: "インポート {{imported}} / スキップ {{skipped}} / 失敗 {{failed}}",
  resultFallback:
    "一部のサイトをインポートできませんでした。Browser で一度ログインすれば、セッションが保持され Agent にも引き継がれます。",
  dialogTitle: "Chrome からログイン状態をインポート",
  dialogDescription:
    "profile と対象ドメインを選択します。ドメインは初期状態ですべて選択され、個別に解除できます。Chrome のデータは変更されません。",
  profile: "Chrome profile",
  cookieDomains: "Cookie ドメイン",
  selectedDomains: "{{domains}} ドメインを選択、約 {{cookies}} 件の永続 Cookie",
  selectAll: "すべて選択",
  deselectAll: "すべて解除",
  loadingDomains: "ドメインを読み込み中…",
  previewUnknown: "不明なエラー",
  previewFailed: "この profile の Cookie ドメインを読み込めませんでした。",
  previewFailureTruth:
    "この profile の Cookie を読めませんでしたが、ログイン状態がないとは限りません。",
  noCookies: "この profile にはインポート可能な永続 Cookie がありません。",
  keychainNotice:
    "続行すると macOS が「Chrome Safe Storage」へのアクセスを求めます。復号と書き込みはこの Mac 上だけで行われ、Cookie はアップロードされません。拒否しても Chrome には影響しません。",
  importAction: "ログイン状態をインポート",
  importFailed:
    "ログイン状態をインポートできませんでした。Browser で一度ログインすればセッションを保持できます。",
};

export const settingsBrowserFr: SettingsBrowserCatalog = {
  sectionTitle: "Importer la session depuis Chrome",
  loginState: "Session Chrome",
  detecting: "Détection de Chrome…",
  detectingAria: "Détection de Chrome",
  readyDescription:
    "Choisissez un profil et des domaines avant l’importation. Les données Chrome sont en lecture seule et ne seront pas modifiées.",
  noProfiles: "Google Chrome ou un profil utilisable est introuvable.",
  detectFailed: "Impossible de détecter les profils Chrome.",
  startImport: "Commencer l’importation",
  startImportAria: "Commencer à importer la session Chrome",
  learnMore: "En savoir plus",
  capability: {
    persistentTitle: "Se connecter une fois et conserver la session",
    persistentDetail:
      "Même sans importation, vous pouvez vous connecter dans le Browser intégré. Les Cookies persistent entre les onglets et les redémarrages, et l’Agent utilise la même session.",
    limitedTitle: "Mots de passe, extensions et favoris non importés",
    limitedDetail:
      "Electron n’expose ni le gestionnaire de mots de passe Chrome ni toutes ses API d’extension, et les favoris ne servent pas à l’Agent. Les données sensibles inutiles ne sont donc pas déplacées.",
  },
  result: "Importés {{imported}} / ignorés {{skipped}} / échecs {{failed}}",
  resultFallback:
    "Certains sites n’ont pas pu être importés. Connectez-vous une fois dans Browser pour conserver la session et la partager avec l’Agent.",
  dialogTitle: "Importer la session depuis Chrome",
  dialogDescription:
    "Choisissez un profil et les domaines à importer. Tous les domaines sont sélectionnés par défaut et peuvent être décochés. Les données Chrome ne sont pas modifiées.",
  profile: "Profil Chrome",
  cookieDomains: "Domaines des Cookies",
  selectedDomains: "{{domains}} domaines sélectionnés, environ {{cookies}} Cookies persistants",
  selectAll: "Tout sélectionner",
  deselectAll: "Tout désélectionner",
  loadingDomains: "Lecture des domaines…",
  previewUnknown: "Erreur inconnue",
  previewFailed: "Impossible de lire les domaines Cookie de ce profil.",
  previewFailureTruth:
    "Les Cookies de ce profil sont illisibles, ce qui ne signifie pas qu’il n’est pas connecté.",
  noCookies: "Ce profil ne contient aucun Cookie persistant à importer.",
  keychainNotice:
    "Après validation, macOS demandera l’accès à « Chrome Safe Storage ». Le déchiffrement et l’importation restent sur ce Mac ; aucun Cookie n’est envoyé. Un refus n’affecte pas Chrome.",
  importAction: "Importer la session",
  importFailed:
    "L’importation de la session a échoué. Vous pouvez toujours vous connecter une fois dans Browser et conserver la session.",
};

export const settingsBrowserEs: SettingsBrowserCatalog = {
  sectionTitle: "Importar la sesión desde Chrome",
  loginState: "Sesión de Chrome",
  detecting: "Detectando Chrome…",
  detectingAria: "Detectando Chrome",
  readyDescription:
    "Elige un perfil y los dominios antes de importar. Los datos de Chrome son de solo lectura y no se modificarán.",
  noProfiles: "No se encontró Google Chrome ni un perfil utilizable.",
  detectFailed: "No se pudieron detectar los perfiles de Chrome.",
  startImport: "Iniciar importación",
  startImportAria: "Iniciar la importación de la sesión de Chrome",
  learnMore: "Más información",
  capability: {
    persistentTitle: "Inicia sesión una vez y consérvala",
    persistentDetail:
      "Aunque omitas la importación, puedes iniciar sesión en el Browser integrado. Las Cookies persisten entre pestañas y reinicios, y el Agent usa la misma sesión.",
    limitedTitle: "No se importan contraseñas, extensiones ni marcadores",
    limitedDetail:
      "Electron no ofrece el gestor de contraseñas ni todas las API de extensiones de Chrome, y los marcadores no intervienen en la navegación del Agent. Así se evita mover datos sensibles sin utilidad.",
  },
  result: "Importadas {{imported}} / omitidas {{skipped}} / fallidas {{failed}}",
  resultFallback:
    "Algunos sitios no se pudieron importar. Inicia sesión una vez en Browser para conservarla y compartirla con el Agent.",
  dialogTitle: "Importar la sesión desde Chrome",
  dialogDescription:
    "Elige un perfil y los dominios que quieres importar. Todos están seleccionados de forma predeterminada y puedes desmarcarlos. Los datos de Chrome no se modificarán.",
  profile: "Perfil de Chrome",
  cookieDomains: "Dominios de Cookies",
  selectedDomains: "{{domains}} dominios seleccionados, unas {{cookies}} Cookies persistentes",
  selectAll: "Seleccionar todo",
  deselectAll: "Deseleccionar todo",
  loadingDomains: "Leyendo dominios…",
  previewUnknown: "Error desconocido",
  previewFailed: "No se pudieron leer los dominios Cookie de este perfil.",
  previewFailureTruth:
    "No se pudieron leer las Cookies de este perfil; eso no significa que no tenga una sesión iniciada.",
  noCookies: "Este perfil no tiene Cookies persistentes disponibles para importar.",
  keychainNotice:
    "Al continuar, macOS pedirá acceso a «Chrome Safe Storage». El descifrado y la importación ocurren solo en este Mac; las Cookies no se suben. Denegar el acceso no afecta a Chrome.",
  importAction: "Importar sesión",
  importFailed:
    "No se pudo importar la sesión. Aún puedes iniciar sesión una vez en Browser y conservarla.",
};
