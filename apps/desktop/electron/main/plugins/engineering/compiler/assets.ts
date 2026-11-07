/**
 * [INPUT]: Declared runtime features, frozen source modules and esbuild.
 * [OUTPUT]: Bounded package-local module Workers and WASM assets without remote script loading.
 * [POS]: Controlled compiler asset extension; worker code cannot create nested workers.
 */
import {build,type Plugin,type OutputFile} from 'esbuild';
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises';
import {join,dirname,resolve,sep} from 'node:path';
import {pluginBytesHash} from '../snapshot';
export function pluginAssetLoader(input:{sourceRoot:string;outputRoot:string;features:readonly string[];worker?:boolean}):Plugin{
  const workers=new Map<string,{name:string;code:string}>();
  const write=async(file:OutputFile)=>{await mkdir(dirname(file.path),{recursive:true,mode:0o700});await writeFile(file.path,file.contents,{mode:0o600});};
  return{name:'bottega-package-assets',setup(builder){
    builder.onResolve({filter:/\?worker$/},async args=>{
      if(!input.features.includes('worker'))throw new Error('PLUGIN_WORKER_NOT_DECLARED');
      if(input.worker)throw new Error('PLUGIN_NESTED_WORKER_UNSUPPORTED');
      const path=await realpath(resolve(args.resolveDir,args.path.slice(0,-7)));
      if(!path.startsWith(input.sourceRoot+sep))throw new Error('PLUGIN_WORKER_OUTSIDE_PACKAGE');
      return{path,namespace:'bottega-worker'};
    });
    builder.onLoad({filter:/.*/,namespace:'bottega-worker'},async args=>{
      let asset=workers.get(args.path);
      if(!asset){
        if(workers.size>=16)throw new Error('PLUGIN_WORKER_ENTRY_BUDGET');
        const directory=join(input.outputRoot,'runtime/ui/workers');
        const result=await build({absWorkingDir:input.sourceRoot,entryPoints:[args.path],bundle:true,platform:'browser',target:'chrome140',format:'esm',
          outfile:join(directory,'entry.mjs'),write:false,minify:true,logLevel:'silent',legalComments:'inline',
          define:{'import.meta.url':'__bottegaWorkerAssetUrl'},
          banner:{js:"Object.defineProperty(globalThis,'Worker',{value:class{constructor(){throw new Error('Nested plugin workers are unavailable');}}});"},
          loader:{'.wasm':'file','.png':'file','.svg':'file'},plugins:[pluginAssetLoader({...input,worker:true})]});
        const entry=result.outputFiles.find(file=>file.path.endsWith('entry.mjs'));if(!entry||entry.contents.byteLength>8*1024*1024)throw new Error('PLUGIN_WORKER_BYTES_BUDGET');
        const name=`workers/worker-${pluginBytesHash(entry.contents).slice(7,23)}.mjs`;
        for(const file of result.outputFiles)if(file!==entry)await write(file);
        await write({...entry,path:join(input.outputRoot,'runtime/ui',name)});asset={name,code:entry.text};workers.set(args.path,asset);
      }
      // Opaque iframes cannot import an HTTP top-level Worker. Keep its complete bundle in the verified module graph.
      return{loader:'js',contents:`const url=new URL(${JSON.stringify(asset.name)},import.meta.url).href;
const key=Symbol.for('bottega.plugin.workerAssets');(globalThis[key]??=new Map()).set(url,${JSON.stringify(asset.code)});export default url;`};
    });
    builder.onLoad({filter:/\.wasm$/},async args=>{
      if(!input.features.includes('wasm'))throw new Error('PLUGIN_WASM_NOT_DECLARED');
      const path=await realpath(args.path);if(!path.startsWith(input.sourceRoot+sep))throw new Error('PLUGIN_WASM_OUTSIDE_PACKAGE');
      const bytes=await readFile(path);if(bytes.length>32*1024*1024)throw new Error('PLUGIN_WASM_BYTES_BUDGET');
      const name=`wasm-${pluginBytesHash(bytes).slice(7,23)}.wasm`,directory=join(input.outputRoot,'runtime/ui',...(input.worker?['workers']:[]));
      await mkdir(directory,{recursive:true,mode:0o700});await writeFile(join(directory,name),bytes,{mode:0o600});
      return{contents:`export default new URL(${JSON.stringify('./'+name)},import.meta.url).href;`,loader:'js'};
    });
  }};
}
