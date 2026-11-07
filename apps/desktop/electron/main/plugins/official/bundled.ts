/**
 * [INPUT]: The unpacked immutable official distribution, Electron package identity and unified platform.
 * [OUTPUT]: Idempotent offline weather registration and revision activation.
 * [POS]: Official seed loader; preserves user enablement and instance configuration.
 */
import {join} from 'node:path';
import {app} from 'electron';
import {WEATHER_PLUGIN_ID} from '../../../../shared/system-dock/widgets/weather';
import type {UnifiedPluginPlatform} from '../platform/service';
import {verifyUnifiedPluginDistribution} from '../distribution/verify';
import {importPluginDistribution} from '../integration/distribution';
export async function installBundledWeather(platform:UnifiedPluginPlatform,userData:string){
 if(process.platform!=='darwin')return;
 const directory=app.isPackaged?join(process.resourcesPath,'app.asar.unpacked/out/main/official-plugins/weather'):join(__dirname,'official-plugins/weather');
 const checked=await verifyUnifiedPluginDistribution(directory);
 const existing=platform.get(WEATHER_PLUGIN_ID);
 if(existing&&existing.installation.origin!=='official')throw new Error('Official weather identity is already owned by another source');
 await platform.register({manifest:checked.distribution.manifest,packageDirectory:directory,replace:true});
 if(existing?.activeRevision===checked.distribution.revisionId||!platform.get(WEATHER_PLUGIN_ID)?.installation.enabled)return;
 const sourceVersion=await platform.sourceChanged(WEATHER_PLUGIN_ID);
 const revision=await importPluginDistribution({directory,buildsRoot:join(userData,'plugin-builds'),sourceVersion});
 await platform.activateCandidate(revision);
}
