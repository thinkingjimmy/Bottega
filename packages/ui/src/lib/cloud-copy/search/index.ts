/**
 * [INPUT]: Five matching client-search catalogs.
 * [OUTPUT]: Shared getCloudSearchCopy and a closed copy type.
 * [POS]: Public search copy subpath, independent of product runtime.
 */
import { pickCloudLocale } from "../locale";
import { en } from "./en";
import { zhCN } from "./zh-cn";
import { ja } from "./ja";
import { fr } from "./fr";
import { es } from "./es";
export type { CloudSearchCopy } from "./en";
export const getCloudSearchCopy = (locale: string) => pickCloudLocale(locale, { en, zhCN, ja, fr, es });
