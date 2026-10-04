/**
 * [INPUT]: No catalog: only the Unicode script classes for Latin, Chinese and Japanese text.
 * [OUTPUT]: Provides formatWorkbench (`{{name}}`) and formatCopy (`{name}`): placeholder filling with one space where a Latin value meets
 *           Chinese or Japanese in the template, and none next to punctuation or an existing space.
 * [POS]: The catalog-free half of workbench-copy, so a surface that only formats copy (chat-ui's remote lines) never pulls the workbench
 *        catalog into its bundle; ./index re-exports both for workbench surfaces.
 */
import { resolveAppLocale } from "../locale";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN = /[\p{Script=Latin}0-9]/u;
/* One space where a Latin value meets Chinese / Japanese in the template; punctuation and existing spaces get none. */
function fill(text: string, values: Readonly<Record<string, string | number>>, pattern: RegExp): string {
  return text.replace(pattern, (match, name: string, at: number) => {
    if (!(name in values)) return match;
    const value = String(values[name]), before = text[at - 1] ?? "", after = text[at + match.length] ?? "";
    const lead = LATIN.test(value[0] ?? "") && CJK.test(before) ? " " : "", trail = LATIN.test(value.at(-1) ?? "") && CJK.test(after) ? " " : "";
    return lead + value + trail;
  });
}
/**
 * Fills `{{name}}` placeholders. Where a value starts or ends with a Latin letter or digit and the template character on that
 * side is Chinese or Japanese, one space goes between them ("在 Studio Mac 上"); a CJK value, punctuation or a space already
 * in the template gets none, so English, French and Spanish are untouched and nothing is doubled.
 */
export function formatWorkbench(text: string, values: Readonly<Record<string, string | number>>): string {
  return fill(text, values, /{{\s*(\w+)\s*}}/g);
}
/** The same for copy written with single-brace `{name}` placeholders (chat-ui's remote copy). */
export function formatCopy(text: string, values: Readonly<Record<string, string | number>>): string {
  return fill(text, values, /{(\w+)}/g);
}

/** Reads `${key}_one` / `${key}_other` by the locale's plural rule and fills `{{count}}`. */
export function pluralWorkbench(
  group: Readonly<Record<string, unknown>>,
  key: string,
  locale: string,
  count: number,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const form = new Intl.PluralRules(resolveAppLocale(locale)).select(count) === "one" ? "one" : "other";
  const text = group[`${key}_${form}`] ?? group[`${key}_other`];
  return formatWorkbench(typeof text === "string" ? text : key, { ...values, count });
}
