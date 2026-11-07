/**
 * [INPUT]: Type-only WeatherOwner contract and original instance cleanup.
 * [OUTPUT]: Lightweight installed Weather owner lookup, replacement and removal.
 * [POS]: Shared Main registry for Dock initialization and process RPC; implementation loads during Dock initialization.
 */
import type {WeatherOwner} from './owner';
let installed:WeatherOwner|null=null;
export function installWeatherOwner(owner:WeatherOwner|null){installed?.close();installed=owner;}
export function weatherOwner(){if(!installed)throw new Error('WEATHER_UNAVAILABLE');return installed;}
