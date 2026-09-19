/**
 * [INPUT]: The five matching encrypted-sync locale catalogs.
 * [OUTPUT]: Provides getCloudEncryptionCopy and the shared closed copy type.
 * [POS]: Public copy subpath for desktop setup and browser unlock flows.
 */
import { pickCloudLocale } from "../locale";
import { en } from "./en";
import { zhCN } from "./zh-cn";
import { ja } from "./ja";
import { fr } from "./fr";
import { es } from "./es";
export type { CloudEncryptionCopy } from "./en";
export const getCloudEncryptionCopy = (locale: string) => pickCloudLocale(locale, { en, zhCN, ja, fr, es });
