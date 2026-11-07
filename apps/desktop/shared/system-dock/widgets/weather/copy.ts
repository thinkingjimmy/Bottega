/**
 * [INPUT]: Independent Weather locale leaves and the pure error-key mapper.
 * [OUTPUT]: Original five-locale copy, English fallback and localized failure APIs.
 * [POS]: Main aggregate; renderer consumers use loaded Dock catalogs.
 */
import {weatherFailureKey} from './errors';
import {weatherEn} from './locales/en';
import {weatherZhCN} from './locales/zh-cn';
import {weatherJa} from './locales/ja';
import {weatherFr} from './locales/fr';
import {weatherEs} from './locales/es';
export const weatherTranslations={"en":weatherEn,"zh-CN":weatherZhCN,"ja":weatherJa,"fr":weatherFr,"es":weatherEs};
export function weatherCopy(locale:string){return weatherTranslations[locale as keyof typeof weatherTranslations]??weatherTranslations.en;}
export function weatherFailure(locale:string,error:unknown){return weatherCopy(locale)[weatherFailureKey(error)];}
