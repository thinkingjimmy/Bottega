/**
 * [INPUT]: The current Settings locale and translator.
 * [OUTPUT]: Provides builtinToolCopy for localized tool labels and hints, including chart palette validation.
 * [POS]: Localized summaries in the official plugin Contributions section.
 */
import type { TFunction } from "i18next";
import { paletteToolCopy } from "./palette-copy";

export function builtinToolCopy(toolId: string, t: TFunction, locale: string) {
  if (toolId === "validate_palette") return paletteToolCopy(locale);
  return {
    label: t(`settings.tools.builtin.items.${toolId}.label`, { defaultValue: toolId }),
    hint: t(`settings.tools.builtin.items.${toolId}.hint`, { defaultValue: "" }),
  };
}
