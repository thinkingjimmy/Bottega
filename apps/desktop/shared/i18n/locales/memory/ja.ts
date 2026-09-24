/**
 * [INPUT]: Depends on memoryEn from ./en for both its structural type and the English leaves this catalog reuses
 * [OUTPUT]: Provides memoryJa, the Japanese Memory catalog
 * [POS]: Japanese leaf of shared/i18n/locales/memory; loaded on demand by the matching top-level locale
 */

import { memoryEn } from "./en";

export const memoryJa: typeof memoryEn = {
  ...memoryEn,
  store: {
    providerListFailed: "Memory プロバイダー一覧を読み込めませんでした",
    statusFailed: "Memory の状態を読み込めませんでした",
    healthFailed: "Memory の健全性を確認できませんでした",
    historyPreviewFailed: "Memory 履歴をプレビューできませんでした",
    attentionFailed: "保留中の Memory 項目を処理できませんでした",
    runtimeStatusFailed: "Memory ランタイムの状態を読み込めませんでした",
    configIssueFailed: "Memory の構成問題を解決できませんでした",
    manualConfigPreviewFailed: "手動構成した送信先をプレビューできませんでした",
    runtimeOperationFailed: "Memory ランタイム操作に失敗しました",
    updateCheckFailed: "Memory の更新を確認できませんでした",
    configPreviewFailed: "Memory の送信先をプレビューできませんでした",
    configAuthorityFailed: "Memory の送信先を承認できませんでした",
    manualConfigAuthorityFailed: "手動構成した送信先を承認できませんでした",
    configSubmitFailed: "Memory ランタイム構成を送信できませんでした",
    destructiveAuthorityFailed: "Memory の破壊的操作を承認できませんでした",
    destructiveFailed: "Memory の破壊的操作に失敗しました",
  },
  common: { unread: "未取得", paused: "一時停止", enabled: "有効" },
  time: { none: "まだありません", now: "たった今" },
  provider: {
    openviking: {
      summary: "削除は workspace 単位——ひとつの範囲を消しても他は残ります。",
      panel: { title: "OpenViking 抽出モデル", description: "キー、Base URL、モデルはローカル secrets と 0600 の管理対象 ov.conf にだけ保存されます。手動管理へ切り替えた後はファイルを直接編集します。" },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "抽出 API キー", description: "会話から長期メモリーを抽出するために必要です。" },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "OpenAI 互換エンドポイント（例：https://api.deepseek.com/v1）。" },
        OPENVIKING_LLM_MODEL: { label: "モデル", description: "抽出モデル名（例：deepseek-chat）。" },
      },
    },
    everos: {
      summary: "削除は runtime 全体をリセット——すべての範囲が一度に消えます。",
      panel: { title: "EverOS 抽出認証情報", description: "起動にはモデルサービスのキーが必要です。認証情報はローカル secrets と LaunchAgent にだけ保存され、CLI の認証情報は読みません。" },
      field: {
        EVEROS_LLM__API_KEY: { label: "抽出 API キー", description: "長期メモリー抽出に使う OpenAI 互換モデルサービスのキーです。" },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "OpenAI 互換エンドポイント（例：https://api.deepseek.com/v1）。" },
        EVEROS_LLM__MODEL: { label: "モデル", description: "抽出モデル名（例：deepseek-chat）。" },
      },
    },
  },
  backend: { ...memoryEn.backend, homepage: "プロジェクトページ", notReady: "サービスがまだ準備できていません。まず下でインストールを修復するか再確認してください。", installed: "インストール済み", installedNeedsConfig: "インストール済み・設定が必要", installedNeedsConfigVersion: "{{version}} をインストール済み・設定が必要", notInstalled: "未インストール", dataLocation: "データの場所を表示", dataLocationFailed: "データの場所はまだ利用できません。修復または再インストールしてください。", interrupted: "インストール中断", identityRepair: "インストール識別を修復" },
  activity: { aria: "メモリーの稼働状況", empty: "まだ想起または配信の記録はありません。", lastCapture: "最新の配信・保存後", lastRecall: "最新の想起", recallUsed: "メモリー送信済み", recallNone: "関連メモリーなし", recallFailed: "想起を利用不可", recallFailedCount: "失敗 {{count}}", recallUsedTurns: "メモリーを送信したターン", recallZeroTurns: "一致なしのターン", rebuilt: "前回の再構築・完了", delivered: "現在の範囲・配信済みターン", pending: "現在の範囲・配信待ち", inflight: "送信中のバッチ", gap: "欠落ターン・承認済み未配信" },
  attention: { kind: { "capture-gap": "抽出配信に欠落があります", "cleanup-failed": "リモート削除に失敗しました", "rebuild-failed": "再構築が中断しました", "capacity-pressure": "台帳の圧縮が必要です" }, action: { acknowledge: "確認済み", "retry-cleanup": "削除を再試行", compact: "今すぐ圧縮", abandon: "放棄して記録", "resume-rebuild": "再構築を続行" } },
  health: {
    offLabel: "オフ", offDetail: "想起と配信を行うにはメモリーを有効にしてください。", unknownLabel: "未確認", unknownDetail: "更新してローカルサービスとハンドシェイクします。", checkingLabel: "確認中", checkingDetail: "ローカルサービスへ接続し、ハンドシェイクを検証しています。", readyLabel: "サービスは利用可能", readyDetail: "想起と配信を利用できます。", compatLabel: "互換モード", compatDetail: "サービスのバージョンが固定版と異なりますが、機能は利用できます。", compatVersionDetail: "サービス {{version}} は固定版と異なります。問題がある場合は固定版を再インストールしてください。", unavailableLabel: "サービスを利用できません", unavailableDetail: "ハンドシェイクに失敗しました。更新して再試行してください。", blockedLabel: "まだ有効にできません",
    blocked: { ownership: "管理対象データの所有権を確認できないため、不明な保存先への書き込みを防いでいます。下の修復インストールで復旧できます。", configuration: "設定が未完了です。先に抽出キーを送信してください。", "not-installed": "管理対象のメモリーサービスは未インストールです。下でインストールすると、準備完了後にメモリーを有効化できます。" },
    issue: {
      unreachable: { label: "ローカルサービスに接続できません", detail: "サービスが停止している可能性があります。下の「インストールを修復」をお試しください。メモリーは停止しますが Chat は影響を受けません。" },
      unhealthy: { label: "サービスの準備ができていません", detail: "起動中の可能性があります。しばらくしてから再試行してください。Chat は影響を受けません。" },
      auth: { label: "サービスで認証が有効です", detail: "製品は CLI 認証情報を読みません。loopback サービスを dev モードで再起動してください。現在の認証モード: {{detail}}。" },
      protocol: { label: "このアドレスは想定したサービスではありません", detail: "認識できないプロトコルが返されました。メモリーは停止しますが Chat は影響を受けません。" },
      identity: { label: "管理外のプロセスがポートを使用しています", detail: "会話を不明なプロセスへ送らないよう配信を停止しました。インストールを修復するかポートを解放してください。" },
      configuration: { label: "設定が未完了です", detail: "下で抽出キーを送信してください。メモリーは停止しますが Chat は影響を受けません。" },
      version: { label: "サービスを利用できません", detail: "検出したバージョン {{detail}} がハンドシェイクに失敗しました。" },
    },
  },
  engines: {
    title: "メモリーエンジン", aria: "メモリーエンジン",
    description: "メモリーを保持するエンジンを選び、ここで管理します。同時に有効なのは 1 つだけです。切り替えには事前のクリーンアップまたは再構築が必要ですが、もう一方の導入は自由です。",
    manage: "{{provider}} を管理", collapse: "{{provider}} を折りたたむ",
    versionRow: "バージョン", modelRow: "抽出モデル", runtimeRow: "ランタイム",
    inUse: "使用中", updateAvailable: "更新があります",
    modelConfigured: "キーとモデルはこの Mac にのみ保存されます。", modelUnset: "未設定 — 抽出キーを送信するとサービスが起動します。",
    runtimeManaged: "管理インストール · {{url}}", runtimeAutostart: "ログイン時に起動 · クラッシュ後は自動再起動。",
    installAction: "{{provider}} をインストール",
  },
  setup: {
    recommended: "推奨", chooseTitle: "メモリーエンジンを選択", chooseDescription: "この Mac 上の専用のバージョン固定 Python 環境にインストールされます。エンジンは後から切り替えられます。",
    installingTitle: "{{provider}} をインストール中", installedTitle: "{{provider}} はインストール済みです", installFailedTitle: "{{provider}} のインストールが完了しませんでした",
    installingDescription: "インストールは初回のみです。以降、サービスはログイン時に起動し、クラッシュしても自動で再起動します。", background: "バックグラウンドで続行", backgroundNote: "インストールはバックグラウンドで続きます。進捗は「設定 › メモリ」で確認でき、完了後はそこからモデルを接続できます。",
    connectTitle: "モデルを接続", connectDescription: "OpenAI 互換のモデルがあなたの書いたメッセージを読み、覚えておく価値のある内容を抽出します。キーはこの Mac に保存されます。", connectSubmit: "サービスを開始",
    draftKept: "閉じても、正常に適用されるまで下書きは保持されます。",
    row: {
      notSetUp: "未設定",
      installing: "インストール中",
      installed: "インストール済み",
      failed: "インストール失敗",
      description: "過去の会話から大切なことを覚えておき、関連するときに呼び戻します。この Mac 上で小さなサービスを実行します。",
      installingDescription: "{{provider}} をインストール中です。バックグラウンドで続行されるので、設定は後から完了できます。",
      connectDescription: "{{provider}} {{version}} はインストール済みです。モデルを接続すると記憶を始めます。",
      failedDescription: "{{provider}} のインストールが完了しませんでした。もう一度設定して再試行してください。",
      setUp: "設定…",
      showProgress: "進捗を表示",
      connect: "接続…",
    },
    notes: {
      title: "始める前に",
      localTerm: "この Mac から出ません",
      localDetail: "メモリー本体がこのコンピューターの外に出ることはありません。ランタイムとデータのフォルダは分かれています。",
      modelTerm: "記憶の抽出にはモデルが必要です",
      modelDetail: "接続した OpenAI 互換モデルに送られるのは、あなたが書いたメッセージだけです。",
      removeTerm: "いつでも削除できます",
      removeDetail: "メモリーをオフにすると呼び出しが止まり、削除するとサービスとデータが消去されます。どちらの場合も Chat はそのまま使えます。",
    },
  },
  page: { ...memoryEn.page, providerMissing: "設定されたメモリーサービス「{{provider}}」は登録されていません。", refreshHealth: "メモリーの状態を更新", title: "長期メモリー", description: "人間のターンだけを処理し、メモリー本体はこの Mac に残ります。オフにすると想起も記録も停止します。Chat、Tools、Apps、Skills は通常どおり動作します。", stateOn: "オン", stateUnavailable: "一時停止中 · サービス利用不可", statePaused: "一時停止中",  applyFailedTitle: "設定は保存されましたがランタイムに反映されていません", applyFailedFallback: "適用に失敗しました", applyRetrying: "バックグラウンドで再試行しています。", resume: "長期メモリーを再開", pause: "長期メモリーを一時停止", enable: "長期メモリーを有効化", observability: "稼働状況", observabilityDescription: "想起なしと想起の失敗は分けて記録します。配信は永続化され、Chat は常に fail-open です。", observabilityEpoch: "{{date}} からのメモリー · スコープ第 {{generation}} 世代", recallWarningTitle: "想起メトリクスを一時的に利用できません", pausedBanner: "長期メモリーは一時停止中です。Chat、Tools、Apps、Skills は通常どおり動作します。", attentionTitle: "対応が必要", attentionDescription: "各項目には明示的な復旧操作があります。", resumeFailed: "メモリーの再開に失敗しました", pauseFailed: "メモリーの一時停止に失敗しました", consentFailed: "メモリーの同意を適用できませんでした", configTitle: "抽出先を変更しますか？", configChange: "抽出先を {{currentHostname}}/{{currentModel}} から {{nextHostname}}/{{nextModel}} に変更します。", configDisclosure: "今後承認されるメッセージはこの送信先に送られ、料金が発生する場合があります。", configConfirm: "確認して適用", pauseTitle: "長期メモリーを一時停止しますか？", pauseDescription: "新しい想起と配信を停止します。送信済み、または送信段階に入った要求は取り消せません。", pauseConfirm: "メモリーを一時停止" },
  disclosure: { enableTitle: "長期メモリーを有効にしますか？", switchTitle: "長期メモリーサービスを切り替えますか？", processing: "抽出サービスへ送るのは人間のメッセージ本文と成功した返信だけです。Tools、Apps、Skills、製品コンテキストは送信せず、Agent の処理はこれまでどおりです。", destination: "抽出先", readingDestination: "送信先を確認中…", thirdParty: "メモリー在庫はローカルに残ります。第三者が要求を記録し、クォータを消費し、料金を請求する場合があります。", includeHistory: "今から開始し、選択した履歴も取り込む", scopeHistory: "{{chats}} Chats、選択済み {{turns}} ターン", scopeNew: "確認後に始まる新しい人間の会話のみ", scopePrefix: "範囲：{{scope}}", historyRange: "{{from}} – {{to}}", gaps: "{{count}} Chats に切り詰められ復元できない欠落があります。", pauseBoundary: "いつでも一時停止できますが、送信段階に入った要求は取り消せず、送信はモデルが採用したことを意味しません。", atLeastOnce: "配信は at-least-once です：サービスが冪等キーに非対応だと、障害復旧で同じターンを重複抽出することがあります。", switchBack: "元のサービスへ戻すには先に削除または再構築が必要で、古いデータが自動再利用されることはありません。", confirmSwitch: "確認して切り替え", confirmEnable: "確認して有効化" },
  sharing: {
    title: "共有範囲", description: "新しいメモリーをどの Chat から想起できるかを選びます。範囲変更で古いデータが自動再利用されることはありません。", disabledMemory: "先に長期メモリーを有効にしてください。", disabledTarget: "現在のメモリー送信先は利用できません。", previewFailed: "共有範囲のプレビューに失敗しました",
    dialogTitle: "メモリーの共有範囲を変更しますか？", oldScopeRetained: "古い範囲のデータは保持されますが、想起は停止し、自動統合されません。", historyPaused: "一時停止中も範囲は変更できますが、履歴の取り込みには再開が必要です。", confirm: "範囲変更を確認", readingScope: "共有範囲を確認中…",
    mode: { chat: "この Chat のみ", group: "Project / 単独 Chat プール", personal: "個人メモリープール" },
    isolation: { chat: "新しいメモリーは現在の Chat incarnation だけが想起できます。", group: "同じ Project の Chat 同士で想起でき、単独 Chat は別の共通プールを使います。", personal: "すべての Project と単独 Chat が同じ個人プールから想起できます。" },
  },
  supply: { title: "メモリー供給元", summary: "{{streams}} 件 · 配信 {{delivered}}", disabled: "メモリーを有効にし、所有者の初期化を完了してください。", loadFailed: "メモリー供給元を読み込めませんでした。閉じて再度開くと再試行できます。", foreign: "外部から取り込んだ履歴", untitled: "無題の Chat", archived: "アーカイブ済み", deleted: "削除済み", counts: "配信 {{delivered}} · 待機 {{pending}} · 欠落 {{gap}}", empty: "この範囲への供給はまだありません。" },
  version: { historyTitle: "最近のインストール", loading: "バージョン一覧を読み込み中…", confirmTitle: "{{provider}} を {{version}} に切り替えますか？", listStale: "読み込み中にランタイムが変化したため、この一覧は古くなっています。もう一度お試しください。", description: "選択した release を厳密に導入し、準備完了後だけ last-known-good に更新します。", current: "現在", locked: "推奨", latest: "最新", yanked: "撤回済み", selected: "選択版", currentYanked: "現在の release は撤回済みです。維持または明示的に切り替えてください。", downgradeWarning: "ダウングレードです。データは残りますが互換性が変わる場合があります。", unverifiedWarning: "この release は製品で検証されていません。ロック版のモデル仕様と既存ファイルを再利用し、上流でモデル名が変わった場合だけ初回起動時に OpenViking が進捗表示なしで取得します。", catalogStaleWarning: "バージョンメタデータを更新できず、キャッシュが古い可能性があります。", catalogValidationWarning: "PyPI の公開バージョンとインストール可能一覧が一致しないため、一覧を基準にしています。", listFailed: "バージョン一覧を読み込めませんでした。もう一度お試しください。", switchFailed: "バージョンを切り替えられませんでした。ランタイムエラーを確認して再試行してください。", runningInBackground: "切り替えはバックグラウンドで続行します。このダイアログを閉じて Memory ページで進捗を確認できます。", confirm: "バージョンを切り替え", action: "バージョンを選択", available: "{{version}} に更新可能", check: "更新を確認" },
  runtime: {
    modelTransferAria: "モデルのダウンロード進捗", modelTransfer: "{{received}} / {{total}} MiB", modelRecovered: "モデル検証に失敗したため、検証済みコピーを再ダウンロードしています。", interruptedInstall: "所有権の確定前にインストールが中断されました。再試行で安全に置換します。", versionIntentRecoveryRequired: "{{version}} への切り替えは候補版の検証前に中断されました。修復すると last-known-good に戻ります。", versionCandidateAwaitingReadiness: "{{version}} はインストール済みですが未検証です。必要な設定を送信すると準備完了を確認して昇格します。", identityRepair: "管理ファイルはありますが manifest がありません。ownership marker から識別情報を復元します。", identityMissing: "製品の所有権 marker がないため、自動では引き継ぎません。",
    installHeading: "ローカルメモリーサービスをインストール", installPackage: "{{provider}} {{version}} を分離・バージョン固定された Python 環境へインストールします。ソースと検証結果はログに表示されます。", installAutostart: "{{url}} でログイン時に自動起動し、クラッシュ後に再起動します。", installStorage: "メモリー在庫はローカルに残ります。抽出には設定したモデルサービスを使う場合があります。ランタイムとデータは別ディレクトリです。", installAction: "インストール", managedNeedsConfig: "{{provider}} {{version}} はインストール済みで抽出認証情報を待っています。送信後に自動起動を登録して開始します。", repairAction: "インストールを修復", repairTitle: "{{provider}} のインストールを修復しますか？", repairDescription: "サービスを一時停止し、現在の管理対象ランタイムを再インストールします。メモリーデータ、抽出設定、インストール識別情報は保持され、完了後にサービスが再起動します。", running: "処理中…", openRunning: "メモリーの実行状況を開く", retryInstall: "インストールを再試行", unsupported: "このプラットフォームはワンクリックインストールに対応していません。", versionMismatch: "{{installed}} がインストールされていますが、このアプリは {{locked}} に固定されています。利用できますが更新を推奨します。", stepFailed: "{{step}} に失敗：", configModified: "{{file}} は手動で変更されています", configModifiedDetail: "再生成すると製品管理へ戻ります。手動管理を採用した場合はファイル内のキーとモデルを直接編集します。", regenerate: "再生成", adoptManual: "手動管理にする", manualDetail: "設定は手動管理です。製品はこのファイルを書き換えません。", steps: "手順 {{current}}/{{total}}", preparing: "準備中", upgradeTo: "{{version}} へ更新", recheck: "再確認", downloadHint: "依存関係のダウンロードに数分かかる場合があります", errorLog: "エラーログ", hideLog: "ログを隠す", showLog: "ログを表示", configureAction: "抽出モデルを設定", configDialogTitle: "{{provider}} を設定", retainBlank: "空欄のままなら現在の値を保持します", draftRetained: "閉じた場合や再起動に失敗した場合も入力はメモリー内に保持され、適用成功後にだけ消去されます。", submitRestart: "送信してサービスを再起動", savingConfig: "保存中…", configSaveFailed: "抽出モデル設定を保存できませんでした", uninstallTitle: "{{provider}} の管理対象ランタイムを削除しますか？", uninstallDescription: "サービスと自動起動を停止し、長期メモリーデータを含む管理対象ランタイムを完全に削除します。使用中ならメモリーを無効にします。", uninstallRetention: "同意記録と Chat は残ります。再インストール後、再構築で保持期間内の承認済み履歴を再抽出できます。", uninstallConfirm: "アンインストールしてデータを削除",
    step: {
      "refresh-version-catalog": "信頼できるバージョン一覧を更新中", "remove-plist": "ログイン時の自動起動を削除中", "remove-venv": "候補環境を削除中", "prepare-toolchain": "固定版 uv ツールチェーンを準備中", "ensure-venv": "Python {{version}} 環境を作成中", "fetch-artifacts": "パッケージをダウンロードして検証中",
      "install-packages": "固定バージョン {{version}} をインストール中（数分かかる場合があります）", "install-packages_selected": "選択したバージョン {{version}} をインストール中（数分かかる場合があります）",
      "register-manifest": "管理対象インストールを登録中", initialize: "データルートを初期化中", "model-assets": "埋め込みモデルをダウンロード中", "config-converge": "管理対象の設定を適用中", "install-plist": "ログイン時の自動起動を登録中",
      bootstrap: "サービスを起動中", bootstrap_deferred: "起動は設定の完了待ちです", "await-ready": "サービスの準備完了を待機中", "await-ready_deferred": "準備確認は設定の完了待ちです",
      "config-write": "ランタイム設定を書き込み中", "config-regenerate": "ランタイム設定を再生成中", "config-adopt-manual": "手動設定を引き継ぎ中", bootout: "サービスを停止中", "wipe-data": "ランタイムデータを消去中", "remove-root": "ランタイムとデータを削除中",
    },
  },
  rebuild: { button: "メモリーを再構築", title: "メモリーを再構築しますか？", confirm: "再構築を開始", unavailable: "再構築中は長期メモリーを利用できませんが、Chat は通常どおり動作します。", progress: "リモートセッション {{purged}}/{{totalScopes}} を削除・ターン {{backfilledTurns}}/{{totalTurns}} を再投入", intentStable: "完了または失敗しても、有効・一時停止の設定は変わりません。", description: "現在の {{provider}} データインスタンスに製品が書いたメモリーをすべて消去し、残存する承認済み内容を再抽出します。現在の Chat だけではありません。", scope: "推定範囲：{{chats}} Chats、{{turns}} ターン。送信先 {{hostname}}/{{model}}。時間、第三者クォータ、料金が発生する場合があります。", pauseIntent: "再構築中は長期メモリーを利用できません。Chat は影響を受けません。完了時も「{{intent}}」設定を保ち、途中の変更を優先します。", trimmed: "切り詰められた履歴は復元できず、欠落として記録されます。", resetManualConfig: "ランタイムのリセットは手動管理の設定を削除し、製品管理へ戻します。", phase: { prepared: "準備中", quiescing: "実行中の要求を停止中", reconciling: "送信中の処理を照合中", purging: "リモートデータを削除中", "watermarks-cleared": "ウォーターマークをリセット中", backfilling: "履歴を再投入中", completed: "完了", failed: "中断" } },
  receipt: { used: "長期メモリー・{{count}} 件を要求とともに送信", usedDetail: "送信はモデルが採用したことを意味しません", none: "長期メモリー・関連内容なし", unavailable: "長期メモリーを利用できず、このターンでは未使用", planMode: "長期メモリー・Plan モードでは未使用", promptNotIssued: "長期メモリー・Agent 要求は送信されませんでした", failure: { initialization: "メモリー状態を初期化できませんでした", "scope-resolution": "このターンのメモリー範囲を解決できませんでした", "policy-store": "メモリーポリシー台帳を利用できません", "runtime-configuration": "メモリーランタイム設定を利用できません", identity: "メモリーサービスの識別確認に失敗しました", provider: "メモリープロバイダーに失敗しました", ownership: "メモリーの所有権確認に失敗しました", deadline: "メモリー想起が期限を超えました", "render-budget": "メモリーコンテキストが表示予算を超えました", "stale-capability": "メモリー権限が失効しました" } },
};
