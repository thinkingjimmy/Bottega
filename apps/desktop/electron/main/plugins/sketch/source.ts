/**
 * [INPUT]: Installation-isolated source allocation, composer-only operations and bundled component metadata.
 * [OUTPUT]: ensureOfficialSketchSource creates an editable official Sketch source once.
 * [POS]: First-install source seed; record operation authority is never included.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PLUGIN_COMPOSER_OPERATIONS} from '@bottega/contracts/plugins/surface/contract';
import catalog from '../../../../resources/app-gui-components/catalog.json';
import {pluginSourceRoot} from '../authoring/source-root';
const entry = `/**
 * [INPUT]: Audited Sketch renderer and editable palette/shape configuration.
 * [OUTPUT]: Official Sketch plugin UI.
 * [POS]: User-owned plugin entry compiled into an isolated Surface.
 */
import {SketchPlugin} from '@bottega/sketch-react';
export default function Sketch() {
  return <SketchPlugin palette={['#000000','#6B7280','#92400E','#DC2626','#F97316','#F59E0B','#16A34A','#0D9488','#06B6D4','#2563EB','#4F46E5','#9333EA','#DB2777']}
    shapes={['line','arrow','rectangle','circle','triangle','diamond','star','heart']} />;
}
`;
export async function ensureOfficialSketchSource(userData:string):Promise<string>{
 const root=await pluginSourceRoot(userData,'sketch');
 if(await readFile(join(root,'plugin.json'),'utf8').then(()=>true,()=>false))return root;
 const files:Record<string,string>={
  'gui/src/main.tsx':entry,'gui/src/styles.css':'@import "tailwindcss";\n',
  'gui/components.json':JSON.stringify({schemaVersion:1,primitives:'base-ui',iconLibrary:'lucide',aliases:{components:'@/components',lib:'@/lib',ui:'@/components/ui'},components:[]},null,2),
  'gui/component-origins.json':JSON.stringify({schemaVersion:1,componentSnapshotDigest:catalog.snapshotDigest,files:[]},null,2),
  'plugin.json':JSON.stringify({schemaVersion:1,kind:'plugin',id:'sketch',name:'Sketch',summary:'Draw, edit and attach an image to the current draft.',version:'1.0.0',
    gui:{entry:'gui/index.html',capabilities:[],build:{preset:'bottega-react-v1',entry:'src/main.tsx',stylesheet:'src/styles.css',iconLibrary:'lucide'}},
    composer:{id:'sketch',title:'Sketch',icon:'pencil'},sourceFormat:{id:'bottega.sketch',version:1,readableVersions:[1]},operations:PLUGIN_COMPOSER_OPERATIONS},null,2),
 };
 for(const [path,value]of Object.entries(files))await writeFile(join(root,path),value+'\n',{flag:'wx'}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='EEXIST')throw error;});
 return root;
}
