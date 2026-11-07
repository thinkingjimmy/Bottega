/**
 * [INPUT]: English Dock base and the English-only Weather data leaf.
 * [OUTPUT]: The unchanged complete systemDockLazyEn fallback catalog.
 * [POS]: Renderer section wrapper; native Main imports the base without Weather UI.
 */
import {systemDockBaseEn} from './base';
import {weatherEn} from '../../../../system-dock/widgets/weather/locales/en';
export const systemDockLazyEn={weather:weatherEn,...systemDockBaseEn};
