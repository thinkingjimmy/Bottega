/**
 * [INPUT]: Node build utilities, shared audited Sketch source, signed UI dependencies, shared system-font styles, esbuild and the fixed Tailwind toolchain.
 * [OUTPUT]: Reproducible bundle.json containing the iframe renderer and isolated styles without their internal source header.
 * [POS]: Build-time product module generation; no plugin-authored code runs in this process.
 */
import {createRequire} from 'node:module';
import {Buffer} from 'node:buffer';
import process from 'node:process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'../../../../../../../..');
const require=createRequire(join(root,'apps/desktop/package.json'));
const {build}=require('esbuild'),{compile}=require('@tailwindcss/node'),{Scanner}=require('@tailwindcss/oxide');
const entry=join(root,'packages/chat-ui/src/plugins/sketch/entry.tsx');
const output=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',target:'chrome140',minify:true,
  banner:{js:`import * as __sketchReact from 'react';
import * as __sketchReactDom from 'react-dom';
import * as __sketchReactClient from 'react-dom/client';
import * as __sketchReactJsx from 'react/jsx-runtime';
const require = name => { if(name==='react')return __sketchReact; if(name==='react-dom')return __sketchReactDom; if(name==='react-dom/client')return __sketchReactClient; if(name==='react/jsx-runtime')return __sketchReactJsx; throw Error('SKETCH_DEPENDENCY_DENIED'); };`},
  jsx:'automatic',legalComments:'none',charset:'utf8',outdir:'/unused',external:['react','react-dom','react-dom/client','react/jsx-runtime','@bottega/plugin-react'],
  loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'}});
const js=output.outputFiles.find(file=>file.path.endsWith('.js')).text;
const cssPath=join(root,'packages/ui/src/styles/globals.css');
const css=(await readFile(cssPath,'utf8')).replace(/^@source .*;\n/gm,'');
const uiRequire=createRequire(join(root,'packages/ui/package.json'));
const compiler=await compile(css,{base:dirname(cssPath),from:cssPath,onDependency:()=>{},customCssResolver:async (specifier,base)=>{
  if(specifier==='tailwindcss')return require.resolve('tailwindcss/index.css');
  if(specifier==='tw-animate-css')return join(root,'packages/ui/node_modules/tw-animate-css/dist/tw-animate.css');
  if(specifier==='shadcn/tailwind.css')return uiRequire.resolve(specifier);
  return resolve(base,specifier);
}});
const scanner=new Scanner({sources:[{base:join(root,'packages/chat-ui/src/sketch'),pattern:'**/*.{ts,tsx}',negated:false},
  {base:join(root,'packages/ui/src/components/ui'),pattern:'**/*.tsx',negated:false}]});
// The source contract belongs to development; embedding it in JSON would invalidate a public export.
const customStyles=(await readFile(join(root,'packages/chat-ui/src/sketch/sketch.css'),'utf8')).replace(/^\/\*\*[\s\S]*?\*\//,'');
const styles=compiler.build(scanner.scan().sort())+'\n'+customStyles;
const index=await readFile(join(here,'index.ts'),'utf8');
const types=index.match(/PLUGIN_SKETCH_TYPES_SOURCE\s*=\s*`([\s\S]*?)`;/)?.[1];
if(!types||types.includes('\\')||types.includes('${'))throw Error('PLUGIN_SKETCH_TYPES_LITERAL_REQUIRED');
const identity=JSON.stringify({sourceDigest:'sha256:'+createHash('sha256').update(js+types+styles).digest('hex')})+'\n';
const value=JSON.stringify({runtime:js,styles});
const destination=join(here,'bundle.json');
if(process.argv.includes('--check')){if(await readFile(destination,'utf8')!==value+'\n'||await readFile(join(here,'identity.json'),'utf8')!==identity)throw Error('PLUGIN_SKETCH_BUNDLE_STALE');}
else {await writeFile(destination,value+'\n');await writeFile(join(here,'identity.json'),identity);}
process.stdout.write(JSON.stringify({runtimeBytes:Buffer.byteLength(js),styleBytes:Buffer.byteLength(styles)})+'\n');
