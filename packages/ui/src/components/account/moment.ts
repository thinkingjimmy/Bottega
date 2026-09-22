/**
 * [INPUT]: Depends on Intl.RelativeTimeFormat and the caller's locale.
 * [OUTPUT]: Provides relativeMoment — the coarse "3 hours ago" every account presence surface reads.
 * [POS]: A leaf of components/account, split out of device-list so the sidebar's computer strip can read a
 *   moment without the account settings rows, their list primitives and their buttons entering first paint.
 */
/* Coarse on purpose: a presence surface needs "3 hours ago", not a timestamp. The browser clock is the only one it has. */
export function relativeMoment(at: number, locale: string) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  return formatter.format(-Math.floor(hours / 24), "day");
}
