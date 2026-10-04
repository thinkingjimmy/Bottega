/**
 * [INPUT]: Component-origin metadata, composer-only operation declarations and isolated source allocation.
 * [OUTPUT]: createPluginSource creates an editable fixed-compiler composer starter.
 * [POS]: Agent authoring seed; Base record operations belong to separately installed record packages.
 */
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PLUGIN_COMPOSER_OPERATIONS} from '@bottega/contracts/plugins/surface/contract';
import catalog from '../../../../resources/app-gui-components/catalog.json';
import {pluginSourceRoot} from './source-root';
export async function createPluginSource(userData:string,id:string){
  if(!/^plugin-[a-f0-9-]{36}$/.test(id))throw new Error('Invalid plugin source identity');
  const root=await pluginSourceRoot(userData,id);
  const files:Record<string,string>={
    'plugin.json':JSON.stringify({schemaVersion:1,kind:'plugin',id,name:'New plugin',summary:'A composer plugin.',version:'1.0.0',
      gui:{entry:'gui/index.html',capabilities:[],build:{preset:'bottega-react-v1',entry:'src/main.tsx',stylesheet:'src/styles.css',iconLibrary:'lucide'}},
      composer:{id,title:'New plugin',icon:'puzzle'},sourceFormat:{id,version:1,readableVersions:[1]},operations:PLUGIN_COMPOSER_OPERATIONS},null,2),
    'gui/src/main.tsx':"import {usePlugin} from '@bottega/plugin-react';\nexport default function Plugin(){const plugin=usePlugin();return <main><h1>New plugin</h1><button onClick={()=>plugin.close({discarded:true})}>Close</button></main>;}\n",
    'gui/src/styles.css':'@import "tailwindcss";\nbody {font-family:system-ui;padding:24px;}\n',
    'gui/components.json':JSON.stringify({schemaVersion:1,primitives:'base-ui',iconLibrary:'lucide',aliases:{components:'@/components',lib:'@/lib',ui:'@/components/ui'},components:[]}),
    'gui/component-origins.json':JSON.stringify({schemaVersion:1,componentSnapshotDigest:catalog.snapshotDigest,files:[]}),
  };
  for(const [path,bytes]of Object.entries(files))await writeFile(join(root,path),bytes+'\n',{flag:'wx'});
  return root;
}
