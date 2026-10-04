/**
 * [INPUT]: The App GUI entry states of TASK-22 (approved copy, 2026-09-27) with {{app}} and {{computer}} placeholders.
 * [OUTPUT]: Japanese App GUI entry copy.
 * [POS]: Cloud copy catalog for the App GUI entry (TASK-21 artboard 11); the state keys match Cloud Web's SurfaceStatus.
 */
import type { CloudSurfaceCopy } from "./en";
export const ja: CloudSurfaceCopy = {
  "open": "App を開く",
  "appsDescription": "同期した App を開いたり、レコードを表示・編集したりできます。",
  "yourComputer": "お使いのコンピューター",
  "loading": "{{app}} を開いています…",
  "updated": "{{app}} を最新バージョンに更新しました。",
  "expiredTitle": "表示がタイムアウトしました",
  "expiredBody": "{{app}} がしばらく操作されていませんでした。再読み込みして続けてください。",
  "reload": "再読み込み",
  "staleTitle": "新しいバージョンがあります",
  "staleBody": "{{app}} は {{computer}} で更新されました。再読み込みして使ってください。",
  "missingTitle": "{{app}} の同期が完了していません",
  "missingBody": "{{computer}} からの一部のファイルがまだ届いていません。しばらくしてからもう一度お試しください。",
  "tryAgain": "再試行",
  "unsupportedTitle": "{{app}} はコンピューターで開いてください",
  "unsupportedBody": "この App は古い形式のため、Web では実行できません。",
  "offlineTitle": "{{computer}} はオフラインです",
  "offlineBody": "{{computer}} がオンラインになって同期すると、ここで {{app}} を使えるようになります。",
  "revokedTitle": "{{app}} は利用できなくなりました",
  "revokedBody": "削除されたか、このアカウントにアクセス権がありません。",
  "failedTitle": "{{app}} を開けませんでした",
  "failedBody": "読み込み中に問題が発生しました。"
};
