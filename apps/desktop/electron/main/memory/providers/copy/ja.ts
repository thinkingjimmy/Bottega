/**
 * [INPUT]: Depends on the shared MemoryBackendCopy contract only.
 * [OUTPUT]: Provides backend-owned ja copy for summaries, configuration and release behavior.
 * [POS]: Main-only Memory backend localization; descriptors carry it to settings over IPC.
 */
import type { MemoryBackendCopy } from "../../../../../shared/ipc/content/memory-ipc";

export const backendCopyJa = {
    openviking: {
      unverifiedVersionWarning: "この release は製品で検証されていません。ロック版のモデル仕様と既存ファイルを再利用し、上流でモデル名が変わった場合だけ初回起動時に OpenViking が進捗表示なしで取得します。",
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
  } satisfies Record<string, MemoryBackendCopy>;
