/**
 * [INPUT]: esbuild, the official package assembler and the desktop dependency resolver.
 * [OUTPUT]: Official plugin assets emitted into development and production main bundles.
 * [POS]: Vite adapter; bundles workspace TypeScript contracts before loading the assembler.
 */
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Plugin} from 'vite';
import type {buildOfficialWeather} from './official-package';
export function officialPlugins(desktop:string):Plugin{
 return{name:'bundled-official-plugins',async buildStart(){
  if(process.platform!=='darwin')return;
  const result=buildSync({entryPoints:[resolve(desktop,'config/native/official-package.ts')],bundle:true,write:false,
   platform:'node',format:'cjs',target:'node24',metafile:true,external:['esbuild','@tailwindcss/node','@tailwindcss/oxide'],
   define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve(desktop,'electron.vite.config.ts')).href)}});
  for(const path of Object.keys(result.metafile!.inputs))this.addWatchFile(resolve(path));
  const module={exports:{} as {buildOfficialWeather:typeof buildOfficialWeather}};
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(resolve(desktop,'package.json')),module,module.exports);
  await module.exports.buildOfficialWeather(desktop,path=>this.addWatchFile(path),(fileName,source)=>this.emitFile({type:'asset',fileName,source}));
 }};
}
