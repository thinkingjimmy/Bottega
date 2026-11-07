/**
 * [INPUT]: Frozen plugin source, its dependency graph, esbuild and the pinned Tailwind compiler.
 * [OUTPUT]: Bundled UI, dynamic chunks, local assets and standalone Node service/tool entries.
 * [POS]: Offline plugin transform kernel; a supervised Seatbelt child invokes this module in production.
 */
import {build,type Plugin} from 'esbuild';
import {compile as compileTailwind} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {dirname,join,resolve,relative,sep,extname} from 'node:path';
import {unifiedPluginManifestSchema,type PluginContribution} from '@bottega/contracts/plugins/platform';
import type {PluginCompileInput,PluginCompileResult} from '../build';
import {pluginHash} from '../snapshot';
import {pluginContextBootstrap,PLUGIN_THEME_CSS} from './surface';
import {pluginAssetLoader} from './assets';
const require=createRequire(import.meta.url);
const loaders={'.png':'file','.jpg':'file','.jpeg':'file','.gif':'file','.webp':'file','.svg':'file','.woff':'file','.woff2':'file','.wasm':'file'} as const;

export async function compileUnifiedPlugin(input:PluginCompileInput):Promise<PluginCompileResult>{
  const manifest=unifiedPluginManifestSchema.parse(input.manifest),contributions:PluginContribution[]=[];
  const backend=new Map<string,string>(),ui=manifest.contributions.filter(value=>['page','widget','composer'].includes(value.kind)&&'entry'in value);
  await mkdir(join(input.outputRoot,'runtime','ui'),{recursive:true,mode:0o700});
  const bootstrap:Plugin={name:'bottega-plugin-ui',setup(builder){
    builder.onResolve({filter:/^bottega:ui:/},args=>({path:args.path.slice('bottega:ui:'.length),namespace:'bottega-plugin-ui'}));
    builder.onLoad({filter:/.*/,namespace:'bottega-plugin-ui'},async args=>{
      const contribution=ui.find(value=>value.id===args.path)!;
      const entry=await sourceEntry(input.sourceRoot,(contribution as {entry:string}).entry);
      const react=['.tsx','.jsx'].includes(extname(entry));
      return{loader:'js',resolveDir:input.sourceRoot,contents:pluginContextBootstrap(manifest.id,contribution.id,manifest.requirements.features)+
        `\nimport Component from ${JSON.stringify(entry)};\n`+(react?`import {createElement} from 'react';import {createRoot} from 'react-dom/client';createRoot(document.getElementById('root')).render(createElement(Component));`:
          `const value=Component();if(value instanceof Node)document.getElementById('root').append(value);`) };
    });
  }};
  if(ui.length){
    const output=await build({absWorkingDir:input.sourceRoot,entryPoints:Object.fromEntries(ui.map(value=>[value.id,`bottega:ui:${value.id}`])),
      bundle:true,splitting:true,format:'esm',platform:'browser',target:'chrome140',jsx:'automatic',minify:true,write:false,
      outdir:join(input.outputRoot,'runtime','ui'),entryNames:'[name]-[hash]',chunkNames:'chunk-[hash]',assetNames:'asset-[hash]',
      loader:loaders,plugins:[bootstrap,pluginAssetLoader({sourceRoot:input.sourceRoot,outputRoot:input.outputRoot,features:manifest.requirements.features})],metafile:true,logLevel:'silent',legalComments:'inline',
      tsconfigRaw:{compilerOptions:{baseUrl:input.sourceRoot,paths:{'@/*':['src/*']}}}});
    for(const file of output.outputFiles){await mkdir(dirname(file.path),{recursive:true,mode:0o700});await writeFile(file.path,file.contents,{mode:0o600});}
    const styles=await compileStyles(input.sourceRoot);
    await writeFile(join(input.outputRoot,'runtime/ui/host.css'),PLUGIN_THEME_CSS+styles,{mode:0o600});
    for(const contribution of ui){
      const entry=Object.entries(output.metafile.outputs).find(([,metadata])=>metadata.entryPoint===`bottega-plugin-ui:${contribution.id}`||metadata.entryPoint===`bottega:ui:${contribution.id}`);
      if(!entry)throw new Error(`PLUGIN_UI_ENTRY_MISSING: ${contribution.id}`);
      const js=relative(join(input.outputRoot,'runtime/ui'),resolve(input.sourceRoot,entry[0])).split(sep).join('/');
      const css=entry[1].cssBundle?relative(join(input.outputRoot,'runtime/ui'),resolve(input.sourceRoot,entry[1].cssBundle)).split(sep).join('/'):null;
      const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="host.css">${css?`<link rel="stylesheet" href="${css}">`:''}</head><body><div id="root"></div><script type="module" src="${js}"></script></body></html>`;
      await writeFile(join(input.outputRoot,'runtime/ui',`${contribution.id}.html`),html,{mode:0o600});
    }
  }
  for(const contribution of manifest.contributions){
    if(contribution.kind==='page'||contribution.kind==='widget'||contribution.kind==='composer'){
      contributions.push({...contribution,entry:`runtime/ui/${contribution.id}.html`});continue;
    }
    const original=contribution.kind==='service'?contribution.entry:contribution.kind==='tool'&&contribution.executor.kind==='process'?contribution.executor.entry:null;
    if(original){
      let bundled=backend.get(original);
      if(!bundled){
        const entry=await sourceEntry(input.sourceRoot,original);bundled=`runtime/backend/${pluginHash({entry:original}).slice(7,23)}.mjs`;
        await build({absWorkingDir:input.sourceRoot,entryPoints:[entry],outfile:join(input.outputRoot,bundled),bundle:true,platform:'node',
          target:'node24',format:'esm',minify:true,logLevel:'silent',legalComments:'inline',packages:'bundle',
          banner:{js:"import {createRequire as __bottegaCreateRequire} from 'node:module';const require=__bottegaCreateRequire(import.meta.url);"},
          tsconfigRaw:{compilerOptions:{baseUrl:input.sourceRoot,paths:{'@/*':['src/*']}}}});
        backend.set(original,bundled);
      }
      if(contribution.kind==='service')contributions.push({...contribution,entry:bundled});
      else if(contribution.kind==='tool')contributions.push({...contribution,executor:{...contribution.executor,entry:bundled}});
    }else contributions.push(contribution);
  }
  return{manifest:unifiedPluginManifestSchema.parse({...manifest,contributions})};
}

async function sourceEntry(root:string,path:string){
  const entry=await realpath(resolve(root,path));
  if(!entry.startsWith(root+sep))throw new Error('PLUGIN_ENTRY_OUTSIDE_SOURCE');return entry;
}
async function compileStyles(root:string){
  const path=join(root,'src/styles.css');
  const source=await readFile(path,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});if(!source)return '';
  const tailwind=dirname(require.resolve('tailwindcss/index.css'));
  const compiler=await compileTailwind(source,{base:join(root,'src'),from:path,onDependency:()=>{},customCssResolver:async(specifier,base)=>{
    const candidate=specifier==='tailwindcss'?join(tailwind,'index.css'):specifier.startsWith('tailwindcss/')?join(tailwind,specifier.slice(12)):resolve(base,specifier);
    return candidate.startsWith(root+sep)||candidate.startsWith(tailwind+sep)?candidate:false;
  }});
  const scanner=new Scanner({sources:[{base:join(root,'src'),pattern:'**/*.{ts,tsx,js,jsx,html}',negated:false}]});
  return compiler.build(scanner.scan().sort());
}
