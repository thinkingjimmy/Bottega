/**
 * [INPUT]: Depends on the Memory plugin metadata, settings and pause impact contracts.
 * [OUTPUT]: Provides ja copy for the official Memory plugin.
 * [POS]: Localized Memory feature copy within the workbench catalog.
 */
export const memoryPluginCopy = {
  "name": "Memory",
  "summary": "選択した共有範囲でチャットの役立つ情報を呼び出します。",
  "description": "Memory はチャットの役立つ情報を覚えておき、必要なときに呼び出します。先週の決定やレポートの好みなどです。\n\n共有範囲はチャットごと、Project ごと、すべてのチャットから選べます。抽出には選んだモデルを使い、料金が発生する場合があるため、オンにする前に確認します。既存の履歴は処理しません。",
  "settings": {
    "backend": {
      "label": "Memory バックエンド"
    },
    "sharingMode": {
      "label": "共有範囲"
    },
    "phoneFacade": {
      "label": "スマートフォンと Web で Memory の状態を確認・操作"
    },
    "workflowRoles": {
      "label": "ワークフローの役割に Memory の読み取りを許可"
    }
  },
  "sharing": {
    "chat": "このチャット",
    "group": "このプロジェクト",
    "personal": "すべてのチャット"
  },
  "capability": {
    "recall": "共有範囲内の情報を呼び出す",
    "capture": "同意した対象情報を保存する",
    "backfill": "許可した履歴のみを処理する"
  },
  "confirmation": {
    "title": "Memory の変更を確認",
    "cutover": "選択したバックエンドを使います。抽出には {{hostname}} の {{model}} を使用し、モデル料金が発生する場合があります。既存の履歴は含まれません。",
    "chat": "今後の Memory を各チャット内に限定します。抽出には {{hostname}} の {{model}} を使用し、モデル料金が発生する場合があります。既存の履歴は含まれません。",
    "group": "今後の Memory を各プロジェクト内で共有します。抽出には {{hostname}} の {{model}} を使用し、モデル料金が発生する場合があります。既存の履歴は含まれません。",
    "personal": "今後の Memory をすべてのチャットで共有します。抽出には {{hostname}} の {{model}} を使用し、モデル料金が発生する場合があります。既存の履歴は含まれません。"
  },
  "effects": {
    "recall": "新しいチャットとワークフローのターンでの呼び出しを一時停止します。",
    "capture": "新規保存を一時停止し、保存済みの記憶は保持します。",
    "backfill": "通常の履歴処理を一時停止します。",
    "phone": "スマートフォンと Web のチャットで Memory を一時停止します。",
    "rebuild": "承認済みの再構築は継続し、モデル料金が発生する場合があります。"
  },
  "health": {
    "backend": "バックエンド",
    "version": "インストール済みバージョン",
    "sharing": "共有範囲",
    "service": "状態",
    "directory": "データフォルダー",
    "unknown": "未確認",
    "unsupported": "Memory は macOS で利用できます。",
    "missing": "Memory 設定でバックエンドをインストールしてください。",
    "configuration": "Memory 設定でバックエンドの設定を完了してください。",
    "repair": "Memory 設定でバックエンドを確認または修復してください。",
    "off": "設定を完了して Memory を使い始めましょう。",
    "paused": "一時停止中。保存済みの記憶は保持されます。",
    "ready": "準備完了",
    "checking": "バックエンドを確認中…"
  }
};
