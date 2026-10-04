/**
 * [INPUT]: Depends on the shared locale resolver, workbench-copy's catalog-free formatCopy (Latin/CJK spacing) and the ProductFailure shape.
 * [OUTPUT]: Provides remoteFailureCopy: an Agent failure on a Chat another computer runs, as the title and resolution a Web or phone viewer
 *           reads (five languages, approved 09-29), keyed on the failure code only; a code or domain it does not know gets the fallback
 *           line and a console warning, never raw text, and a failure's safe details are never part of it.
 * [POS]: packages/chat-ui/src/i18n/messages; chat-ui's remote counterpart of the desktop agent-failure catalog: titles follow the desktop's approved lines (a desktop test pins
 *        the shared ones), resolutions name the computer where the desktop names a local action.
 */
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import type { ProductFailure } from "@ai-chat/cloud-protocol/chats/content/failure";

type Line = { title: string; resolution: string };
type Table = Record<(typeof REMOTE_FAILURE_CODES)[number] | "fallback", Line>;
/** The codes with their own remote line; the two recovery codes read as one line (no resolution). */
export const REMOTE_FAILURE_CODES = ["auth-required", "rate-limited", "quota-exhausted", "context-exhausted", "connection-lost", "request-rejected",
  "service-unavailable", "runtime-unavailable", "unknown", "startup-recovery-pending", "earlier-process-holding"] as const;

const en: Table = {
  "auth-required": { title: "{backend} needs you to sign in again", resolution: "Sign in to {backend} on {computer}, then send again." },
  "rate-limited": { title: "{backend} is receiving too many requests", resolution: "Wait a moment and send again." },
  "quota-exhausted": { title: "{backend} has no available usage right now", resolution: "Check {backend}’s plan and usage, or wait for its reset, then send again." },
  "context-exhausted": { title: "This conversation is too large to continue", resolution: "Start a new Chat and send a shorter request." },
  "connection-lost": { title: "The connection to {backend} on {computer} was interrupted", resolution: "Check {computer}’s network, then send again." },
  "request-rejected": { title: "{backend} could not use this request", resolution: "Choose an available model, or send a shorter, simpler request." },
  "service-unavailable": { title: "{backend} is temporarily unavailable", resolution: "Try again later." },
  "runtime-unavailable": { title: "{backend} could not start on {computer}", resolution: "Install or update {backend} in Bottega on {computer}, then send again." },
  unknown: { title: "{backend} could not finish this request", resolution: "Send again. If it keeps happening, check Bottega on {computer}." },
  "startup-recovery-pending": { title: "Bottega is still finishing its startup checks. Try again in a moment.", resolution: "" },
  "earlier-process-holding": { title: "An earlier Agent process is still finishing. Try again in a moment.", resolution: "" },
  fallback: { title: "This reply couldn’t be completed on {computer}.", resolution: "Send again. If it keeps happening, check Bottega on {computer}." },
};
const zhCN: Table = {
  "auth-required": { title: "{backend} 需要重新登录", resolution: "请在{computer}上重新登录 {backend}，然后再次发送。" },
  "rate-limited": { title: "{backend} 当前请求过多", resolution: "请稍等片刻再发送。" },
  "quota-exhausted": { title: "{backend} 当前没有可用额度", resolution: "请检查 {backend} 的套餐和用量，或等额度恢复后再发送。" },
  "context-exhausted": { title: "当前对话内容过多，无法继续", resolution: "请新建 Chat，发送更短的请求。" },
  "connection-lost": { title: "{computer}上与 {backend} 的连接已中断", resolution: "请检查{computer}的网络后再次发送。" },
  "request-rejected": { title: "{backend} 无法处理这个请求", resolution: "请选择可用模型，或发送更短、更简单的请求。" },
  "service-unavailable": { title: "{backend} 暂时不可用", resolution: "请稍后再试。" },
  "runtime-unavailable": { title: "{backend} 无法在{computer}上启动", resolution: "请在{computer}的 Bottega 里安装或更新 {backend}，然后再次发送。" },
  unknown: { title: "{backend} 未能完成这个请求", resolution: "请再发送一次；如果仍然出现，请在{computer}上查看 Bottega。" },
  "startup-recovery-pending": { title: "Bottega 仍在完成启动检查，请稍后再试。", resolution: "" },
  "earlier-process-holding": { title: "之前的 Agent 进程还在收尾，请稍后再试。", resolution: "" },
  fallback: { title: "这条回复没能在{computer}上完成。", resolution: "请再发送一次；如果仍然出现，请在{computer}上查看 Bottega。" },
};
const ja: Table = {
  "auth-required": { title: "{backend} に再ログインしてください", resolution: "{computer}で {backend} に再ログインしてから、もう一度送信してください。" },
  "rate-limited": { title: "{backend} へのリクエストが多すぎます", resolution: "しばらく待ってから、もう一度送信してください。" },
  "quota-exhausted": { title: "{backend} の利用可能枠がありません", resolution: "{backend} のプランと利用状況を確認するか、リセットを待ってから、もう一度送信してください。" },
  "context-exhausted": { title: "この会話は長すぎて続行できません", resolution: "新しい Chat を始めて、短いリクエストを送信してください。" },
  "connection-lost": { title: "{computer}の {backend} との接続が中断されました", resolution: "{computer}のネットワークを確認してから、もう一度送信してください。" },
  "request-rejected": { title: "{backend} はこのリクエストを処理できません", resolution: "利用できるモデルを選ぶか、短くシンプルなリクエストを送信してください。" },
  "service-unavailable": { title: "{backend} は一時的に利用できません", resolution: "しばらくしてからもう一度お試しください。" },
  "runtime-unavailable": { title: "{computer}で {backend} を起動できません", resolution: "{computer}の Bottega で {backend} をインストールまたは更新してから、もう一度送信してください。" },
  unknown: { title: "{backend} はリクエストを完了できませんでした", resolution: "もう一度送信してください。繰り返し起きる場合は、{computer}の Bottega を確認してください。" },
  "startup-recovery-pending": { title: "Bottega は起動時のチェックをまだ実行中です。しばらくしてからもう一度お試しください。", resolution: "" },
  "earlier-process-holding": { title: "以前の Agent プロセスがまだ終了処理中です。しばらくしてからもう一度お試しください。", resolution: "" },
  fallback: { title: "この返信は{computer}で完了できませんでした。", resolution: "もう一度送信してください。繰り返し起きる場合は、{computer}の Bottega を確認してください。" },
};
const es: Table = {
  "auth-required": { title: "Vuelve a iniciar sesión en {backend}", resolution: "Inicia sesión en {backend} en {computer} y vuelve a enviarlo." },
  "rate-limited": { title: "{backend} está recibiendo demasiadas solicitudes", resolution: "Espera un momento y vuelve a enviarlo." },
  "quota-exhausted": { title: "{backend} no tiene uso disponible ahora", resolution: "Revisa el plan y el uso de {backend}, o espera a que se restablezca, y vuelve a enviarlo." },
  "context-exhausted": { title: "Esta conversación es demasiado larga para continuar", resolution: "Empieza un Chat nuevo y envía una solicitud más corta." },
  "connection-lost": { title: "Se interrumpió la conexión con {backend} en {computer}", resolution: "Revisa la red de {computer} y vuelve a enviarlo." },
  "request-rejected": { title: "{backend} no puede usar esta solicitud", resolution: "Elige un modelo disponible o envía una solicitud más corta y sencilla." },
  "service-unavailable": { title: "{backend} no está disponible temporalmente", resolution: "Vuelve a intentarlo más tarde." },
  "runtime-unavailable": { title: "No se pudo iniciar {backend} en {computer}", resolution: "Instala o actualiza {backend} en Bottega en {computer} y vuelve a enviarlo." },
  unknown: { title: "{backend} no pudo completar la solicitud", resolution: "Vuelve a enviarlo. Si sigue ocurriendo, revisa Bottega en {computer}." },
  "startup-recovery-pending": { title: "Bottega aún está terminando sus comprobaciones de inicio. Vuelve a intentarlo en un momento.", resolution: "" },
  "earlier-process-holding": { title: "Un proceso anterior del Agent aún está terminando. Vuelve a intentarlo en un momento.", resolution: "" },
  fallback: { title: "Esta respuesta no se pudo completar en {computer}.", resolution: "Vuelve a enviarlo. Si sigue ocurriendo, revisa Bottega en {computer}." },
};
const fr: Table = {
  "auth-required": { title: "Reconnectez-vous à {backend}", resolution: "Reconnectez-vous à {backend} sur {computer}, puis renvoyez le message." },
  "rate-limited": { title: "{backend} reçoit trop de requêtes", resolution: "Patientez un instant, puis renvoyez le message." },
  "quota-exhausted": { title: "{backend} n’a plus d’utilisation disponible", resolution: "Vérifiez l’offre et l’utilisation de {backend}, ou attendez sa réinitialisation, puis renvoyez le message." },
  "context-exhausted": { title: "Cette conversation est trop longue pour continuer", resolution: "Commencez un nouveau Chat et envoyez une demande plus courte." },
  "connection-lost": { title: "La connexion à {backend} sur {computer} a été interrompue", resolution: "Vérifiez le réseau de {computer}, puis renvoyez le message." },
  "request-rejected": { title: "{backend} ne peut pas traiter cette demande", resolution: "Choisissez un modèle disponible ou envoyez une demande plus courte et plus simple." },
  "service-unavailable": { title: "{backend} est temporairement indisponible", resolution: "Réessayez plus tard." },
  "runtime-unavailable": { title: "Impossible de démarrer {backend} sur {computer}", resolution: "Installez ou mettez à jour {backend} dans Bottega sur {computer}, puis renvoyez le message." },
  unknown: { title: "{backend} n’a pas pu terminer la demande", resolution: "Renvoyez le message. Si cela se reproduit, vérifiez Bottega sur {computer}." },
  "startup-recovery-pending": { title: "Bottega termine encore ses vérifications de démarrage. Réessayez dans un instant.", resolution: "" },
  "earlier-process-holding": { title: "Un processus précédent de l’Agent est en train de se terminer. Réessayez dans un instant.", resolution: "" },
  fallback: { title: "Cette réponse n’a pas pu être terminée sur {computer}.", resolution: "Renvoyez le message. Si cela se reproduit, vérifiez Bottega sur {computer}." },
};
/** Exported for the parity and table tests only. */
export const REMOTE_FAILURE_TABLES = { en, "zh-CN": zhCN, ja, es, fr } as const;

/**
 * The failure's lines for a remote viewer. `backend` is the failed message's own Agent (never the Chat's current one: the Chat may have
 * switched since), `computer` the computer that runs the Chat. Mapped on the code only; safe details are never read.
 */
export function remoteFailureCopy(failure: Pick<ProductFailure, "domain" | "code">, locale: string, values: { backend: string; computer: string }) {
  const table = REMOTE_FAILURE_TABLES[resolveAppLocale(locale)];
  // Only Agent failures have lines of their own: another domain's code (chat storage, Skills) is never read as an Agent's.
  const line = failure.domain === "agent-runtime" && (REMOTE_FAILURE_CODES as readonly string[]).includes(failure.code) ? table[failure.code as keyof Table] : undefined;
  if (!line) console.warn(`[remote-failure] no line for ${failure.domain}/${failure.code}; showing the fallback`);
  const chosen = line ?? table.fallback;
  // The notice's shape: no explanation line remotely (the title says what happened, the resolution what to do).
  return { title: formatCopy(chosen.title, values), explanation: "", resolution: chosen.resolution ? formatCopy(chosen.resolution, values) : "" };
}
