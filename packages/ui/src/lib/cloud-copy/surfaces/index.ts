/**
 * [INPUT]: Five matching App GUI entry catalogs.
 * [OUTPUT]: getCloudSurfaceCopy and the closed CloudSurfaceCopy type.
 * [POS]: Public App GUI entry copy subpath (TASK-22 / TASK-21 artboard 11), independent of product runtime.
 */
import { pickCloudLocale } from "../locale";
import { en } from "./en";
import { zhCN } from "./zh-cn";
import { ja } from "./ja";
import { fr } from "./fr";
import { es } from "./es";
export type { CloudSurfaceCopy } from "./en";
export const getCloudSurfaceCopy = (locale: string) => pickCloudLocale(locale, { en, zhCN, ja, fr, es });
