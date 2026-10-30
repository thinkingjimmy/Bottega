/**
 * [INPUT]: Depends on canonical source allocation, compiler component metadata and the Dock manifest schema.
 * [OUTPUT]: Provides resumable host-owned countdown source creation without credentials, App identity or composer operations.
 * [POS]: Dock authoring seed; the compiler and runtime remain responsible for candidates and activation.
 */
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import catalog from '../../../../../resources/app-gui-components/catalog.json';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import {pluginSourceRoot} from '../source-root';
import {inspectPluginSource} from '../../../apps/gui-build/source/inspection';
export async function createDockSource(userData:string,id:string,name:string,dock?:DockContribution){
  const node={type:'column',gap:2,children:[{type:'label',text:{kind:'literal',value:'Release'}},{type:'primary',text:{kind:'binding',source:'time',field:'remainingDays',format:'number'}}]};
  const manifest=dockPluginManifestSchema.parse({schemaVersion:1,kind:'plugin',id,name,summary:dock?name:'A countdown to your date.',version:'1.0.0',
    gui:{entry:'gui/index.html',capabilities:[],build:{preset:'bottega-react-v1',entry:'src/main.tsx',stylesheet:'src/styles.css',iconLibrary:'lucide'}},
    dock:dock??{schemaVersion:1,sizes:['small'],summaries:{small:{bottom:node,left:node,right:node}},settings:[{id:'deadline',type:'date',label:'Target date',default:'2026-12-01T00:00:00Z'}],
      data:[{id:'time',kind:'clock',timeZone:'UTC',precision:'minute',deadlineSetting:'deadline'}],detail:{kind:'standard'},refresh:{mode:'visible'}},operations:['dock.open','dock.heartbeat']});
  const files:Record<string,string>={
    'plugin.json':JSON.stringify(manifest,null,2)+'\n',
    'gui/src/main.tsx':'export default function WidgetDetail(){return <main>Widget details are provided by the host.</main>;}\n',
    'gui/src/styles.css':'@import "tailwindcss";\nbody {font-family:system-ui;}\n',
    'gui/components.json':JSON.stringify({schemaVersion:1,primitives:'base-ui',iconLibrary:'lucide',aliases:{components:'@/components',lib:'@/lib',ui:'@/components/ui'},components:[]})+'\n',
    'gui/component-origins.json':JSON.stringify({schemaVersion:1,componentSnapshotDigest:catalog.snapshotDigest,files:[]})+'\n',
  };
  return writeDockSource(userData,id,files);
}
export async function writeDockSource(userData:string,id:string,files:Readonly<Record<string,string|Buffer>>){
  const root=await pluginSourceRoot(userData,id);
  for(const [path,bytes]of Object.entries(files)){
    const target=resolve(root,path);if(!target.startsWith(root+sep)||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('DOCK_SOURCE_PATH_INVALID');
    await mkdir(dirname(target),{recursive:true,mode:0o700});if(await realpath(dirname(target))!==dirname(target))throw new Error('DOCK_SOURCE_PATH_INVALID');
    try{await writeFile(join(root,path),bytes,{flag:'wx',mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  }
  await inspectPluginSource(root);
  const existing=dockPluginManifestSchema.parse(JSON.parse(await readFile(join(root,'plugin.json'),'utf8')));
  if(existing.id!==id)throw new Error('DOCK_SOURCE_IDENTITY_CHANGED');return root;
}
