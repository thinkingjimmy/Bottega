/**
 * [INPUT]: Depends on the English Chat-storage catalog shape
 * [OUTPUT]: Provides Japanese Chat-storage failure copy
 * [POS]: Japanese leaf for user-facing Chat-storage failures
 */

import { chatStorageEn } from "./en";

export const chatStorageJa: typeof chatStorageEn = {
  technicalDetails: "技術的な詳細",
  copyDetails: "技術的な詳細をコピー",
  copiedDetails: "技術的な詳細をコピーしました",
  code: {
    "file-quarantined": {
      title: "一部の Chat を一時的に開けません",
      explanation: "Bottega はこの Chat を読み取れなかったため、元のファイルを保管して読み込みをスキップしました。ほかの Chat には影響しません。",
      resolution: "Bottega を更新して再起動してください。続く場合はバックアップを保持し、技術的な詳細をコピーしてサポートへ共有してください。",
    },
    "backup-failed": {
      title: "Chat を読み取れず、バックアップも作成できませんでした",
      explanation: "データの損失を広げないよう、Bottega はファイルを変更せずに処理を停止しました。",
      resolution: "空き容量とファイル権限を確認し、Bottega を再起動してください。続く場合は技術的な詳細をコピーしてサポートへ共有してください。",
    },
    "recovery-conflict": {
      title: "安全に復元できない Chat のコピーが見つかりました",
      explanation: "正しいコピーを判断できないため、Bottega はどのファイルも上書きまたは削除していません。",
      resolution: "ファイルをそのまま保持し、手動で変更する前に技術的な詳細をコピーしてサポートへ共有してください。",
    },
  },
};
