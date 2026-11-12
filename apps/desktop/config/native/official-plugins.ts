/**
 * [INPUT]: esbuild, the official package assembler and the desktop dependency resolver.
 * [OUTPUT]: Official plugin assets and opt-in local recovery archives emitted beside Main.
 * [POS]: Vite adapter; bundles workspace TypeScript contracts before loading the assembler.
 */
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readdir,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import type {Plugin} from 'vite';
import type {buildBundledWidgets} from './official-package';
export function officialPlugins(desktop:string):Plugin{
 return{name:'bundled-official-plugins',async buildStart(){
  if(process.platform!=='darwin')return;
  const result=buildSync({entryPoints:[resolve(desktop,'config/native/official-package.ts')],bundle:true,write:false,
   platform:'node',format:'cjs',target:'node24',metafile:true,external:['esbuild','@tailwindcss/node','@tailwindcss/oxide'],
   define:{'import.meta.url':JSON.stringify(pathToFileURL(resolve(desktop,'electron.vite.config.ts')).href)}});
  for(const path of Object.keys(result.metafile!.inputs))this.addWatchFile(resolve(path));
  const module={exports:{} as {buildBundledWidgets:typeof buildBundledWidgets}};
  new Function('require','module','exports',result.outputFiles[0]!.text)(createRequire(resolve(desktop,'package.json')),module,module.exports);
  await module.exports.buildBundledWidgets(desktop,path=>this.addWatchFile(path),(fileName,source)=>this.emitFile({type:'asset',fileName,source}));
  const recovery=process.env.BOTTEGA_WIDGET_DEV_RECOVERY;
  if(recovery){
    const catalog=resolve(recovery,'catalog.json');
    this.addWatchFile(catalog);
    this.emitFile({type:'asset',fileName:'official-widget-recovery/catalog.json',source:await readFile(catalog)});
    for(const asset of await readdir(resolve(recovery,'assets'),{withFileTypes:true})){
      if(!asset.isFile()||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,191}\.bwp$/.test(asset.name))continue;
      const path=resolve(recovery,'assets',asset.name);
      this.addWatchFile(path);
      this.emitFile({type:'asset',fileName:'official-widget-recovery/assets/'+asset.name,source:await readFile(path)});
    }
  }
 }};
}
