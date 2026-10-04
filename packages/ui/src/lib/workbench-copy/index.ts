/**
 * [INPUT]: Depends on ../locale for five-language negotiation and on the five workbench catalogs.
 * [OUTPUT]: Provides getWorkbenchCopy, loadWorkbenchCopy, useWorkbenchCopy, useOptionalWorkbenchCopy (null without the workbench flag), formatWorkbench and formatCopy (re-exported from the catalog-free ./format), pluralWorkbench and the WorkbenchCopy type.
 * Exports workflowRecipeName for stable-id localization without changing persisted data (plugin names travel as copy keys, see plugins.builtin).
 * [POS]: Public workbench-copy subpath shared by desktop, Cloud Web and the phone shell; only English is eager.
 */
import { useEffect, useState } from "react";
import { workbenchUiEnabled } from "../workbench-flag";
import { resolveAppLocale, type AppLocale } from "../locale";
import { en, type WorkbenchCopy } from "./en";

export { formatCopy, formatWorkbench, pluralWorkbench } from "./format";

export type { WorkbenchCopy } from "./en";

const loaded = new Map<AppLocale, WorkbenchCopy>([["en", en]]);
const loaders: Record<Exclude<AppLocale, "en">, () => Promise<WorkbenchCopy>> = {
  "zh-CN": () => import("./zh-cn").then((module) => module.zhCN),
  ja: () => import("./ja").then((module) => module.ja),
  fr: () => import("./fr").then((module) => module.fr),
  es: () => import("./es").then((module) => module.es),
};

/** Synchronous read: a language that has not loaded yet reads English, never an empty string. */
export function getWorkbenchCopy(locale: string): WorkbenchCopy {
  return loaded.get(resolveAppLocale(locale)) ?? en;
}

export async function loadWorkbenchCopy(locale: string): Promise<WorkbenchCopy> {
  const key = resolveAppLocale(locale);
  const cached = loaded.get(key);
  if (cached || key === "en") return cached ?? en;
  const copy = await loaders[key]();
  loaded.set(key, copy);
  return copy;
}

export function useWorkbenchCopy(locale: string): WorkbenchCopy {
  const [loaded, setLoaded] = useState(() => ({ locale, copy: getWorkbenchCopy(locale) }));
  useEffect(() => {
    let live = true;
    void loadWorkbenchCopy(locale).then((next) => { if (live) setLoaded({ locale, copy: next }); }, () => undefined);
    return () => { live = false; };
  }, [locale]);
  return loaded.locale === locale ? loaded.copy : getWorkbenchCopy(locale);
}

/**
 * The catalog for workbench-only surfaces: a constant null with the flag off, so those surfaces read nothing. The catalog itself
 * still ships in a flag-off build (English up front, the other locales lazy), because the read-only workflow columns use it
 * in both builds (E-01, kept on purpose).
 */
export const useOptionalWorkbenchCopy: (locale: string) => WorkbenchCopy | null = workbenchUiEnabled ? useWorkbenchCopy : () => null;

/** Built-in display names follow stable ids; persisted names remain data. */
export const workflowRecipeName = (recipe: { recipeId: string; name: string }, copy: WorkbenchCopy["setup"]) =>
  recipe.recipeId === "bottega.plan-develop-review" ? copy.planDevelopReview : recipe.name;
