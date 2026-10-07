/**
 * [INPUT]: Host locale and the built-in Agent menu vocabulary.
 * [OUTPUT]: Shared compact update notices for native and remote Agent pickers.
 * [POS]: Agent picker copy; remote recovery instructions remain in the remote catalog.
 */
export const agentPickerEn = { updateAvailable: "Update available", updateForUsage: "Update to view usage" };
export const agentPickerZhCN = { updateAvailable: "有可用更新", updateForUsage: "更新后获取用量" };
export const agentPickerJa = { updateAvailable: "更新があります", updateForUsage: "更新して使用量を取得" };
export const agentPickerFr = { updateAvailable: "Mise à jour disponible", updateForUsage: "Mettez à jour pour consulter l’utilisation" };
export const agentPickerEs = { updateAvailable: "Actualización disponible", updateForUsage: "Actualiza para consultar el uso" };
const catalogs: Record<string, typeof agentPickerEn> = { en: agentPickerEn, zh: agentPickerZhCN, ja: agentPickerJa, fr: agentPickerFr, es: agentPickerEs };
export const agentPickerCopy = (locale: string) => catalogs[locale.toLowerCase().split("-")[0]!] ?? agentPickerEn;
