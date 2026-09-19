/**
 * [INPUT]: Depends on locale and completed-turn duration/part metadata.
 * [OUTPUT]: Formats native conversation durations and localized completed-work headings.
 * [POS]: Pure shared presentation; absent source timing never becomes an invented duration.
 */
const labels: Record<string, readonly [string, string]> = {
  en: ["Worked", "Worked for {duration}"],
  zh: ["已处理", "处理了 {duration}"],
  ja: ["処理済み", "処理時間 {duration}"],
  fr: ["A travaillé", "A travaillé pendant {duration}"],
  es: ["Trabajó", "Trabajó durante {duration}"],
};
export function formatConversationDuration(ms: number, locale: string) {
  const seconds = Math.max(0, Math.round(ms / 1000)), minutes = Math.floor(seconds / 60);
  const format = (value: number, unit: "minute" | "second") => new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" }).format(value);
  return minutes > 0 ? `${format(minutes, "minute")} ${format(seconds % 60, "second")}` : format(seconds, "second");
}
export function conversationWorkedFor(message: { durationMs?: number | null; isError?: boolean; hasParts: boolean; imported?: boolean }, locale: string) {
  if (message.isError && !message.hasParts) return null;
  const [worked, workedFor] = labels[locale.toLowerCase().split("-")[0]!] ?? labels.en!;
  if (message.durationMs == null) return message.imported && message.hasParts ? worked! : null;
  return workedFor!.replace("{duration}", formatConversationDuration(message.durationMs, locale));
}
