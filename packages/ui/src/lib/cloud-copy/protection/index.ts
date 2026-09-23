/**
 * [INPUT]: The five matching protection locale catalogs.
 * [OUTPUT]: Provides getCloudProtectionCopy and the shared closed copy type.
 * [POS]: Public copy subpath for offline reading, the protected-session mask and native keep-unlocked settings.
 */
import { pickCloudLocale } from "../locale";
import { en } from "./en";
import { zhCN } from "./zh-cn";
import { ja } from "./ja";
import { fr } from "./fr";
import { es } from "./es";
export type { CloudProtectionCopy } from "./en";
export const getCloudProtectionCopy = (locale: string) => pickCloudLocale(locale, { en, zhCN, ja, fr, es });
