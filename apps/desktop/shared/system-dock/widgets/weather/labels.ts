/**
 * [INPUT]: Only five small definition leaves, without complete locale data.
 * [OUTPUT]: Weather definition labels and original English fallback.
 * [POS]: Main discovery copy; full status/condition text remains deferred.
 */
import {weatherEnDefinition} from './definitions/en';
import {weatherZhCNDefinition} from './definitions/zh-cn';
import {weatherJaDefinition} from './definitions/ja';
import {weatherFrDefinition} from './definitions/fr';
import {weatherEsDefinition} from './definitions/es';
export const weatherDefinitionTranslations={"en":weatherEnDefinition,"zh-CN":weatherZhCNDefinition,"ja":weatherJaDefinition,"fr":weatherFrDefinition,"es":weatherEsDefinition};
export function weatherDefinitionCopy(locale:string){return weatherDefinitionTranslations[locale as keyof typeof weatherDefinitionTranslations]??weatherDefinitionTranslations.en;}
