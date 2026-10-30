/**
 * [INPUT]: Depends on Main Base data ports, current source identity and deferred bounded reader loading.
 * [OUTPUT]: Provides lazy Base metadata/validation/demand without loading Base computation or starting reads for builtin/summary-only Widgets.
 * [POS]: Composition seam; delayed loading cannot revive hidden, removed or closed consumers.
 */
import type {DockBaseDataPort,DockBaseDataPorts} from './model';
import type {DockSurface} from '../usage';
import type {WidgetDetailSource} from '../detail/ports';
export function createDockBaseData(ports:DockBaseDataPorts):DockBaseDataPort{
 let host:DockBaseDataPort|null=null,pending:Promise<DockBaseDataPort>|null=null,closed=false,failed=false;
 const surfaces=new Map<DockSurface,readonly WidgetDetailSource[]>();
 const load=()=>{
  if(closed)return Promise.reject(new Error('DOCK_BASE_UNAVAILABLE'));if(host)return Promise.resolve(host);if(pending)return pending;
  const promise=import('./runtime').then(({DockBaseData})=>{
   if(closed)throw new Error('DOCK_BASE_UNAVAILABLE');host=new DockBaseData(ports);for(const [surface,sources]of surfaces)host.setVisible(surface,sources);failed=false;return host;
  }).catch(error=>{failed=true;throw error;}).finally(()=>{if(pending===promise)pending=null;if(!closed)ports.changed();});pending=promise;return promise;
 };
 return{
  setVisible(surface,sources){if(closed)return;const selected=sources.filter(source=>source.manifest.dock.data.some(value=>value.kind==='base'));surfaces.set(surface,selected);if(host)host.setVisible(surface,selected);else if(selected.length&&!failed)void load().catch(()=>{});},
  reading(itemId,sourceId){return host?.reading(itemId,sourceId)??{state:failed?'failed':'loading',updatedAt:null,values:{}};},
  identity(source){return host?.identity(source)??(source.accepted.widget.bindings.length?'pending':'[]');},
  async validate(dock,widget){if(dock.data.some(value=>value.kind==='base')||widget.bindings.length)await(await load()).validate(dock,widget);},
  async directory(input){return(await load()).directory(input);},
  async refresh(itemId){return(await load()).refresh(itemId);},
  health(){return host?.health()??{consumers:[...surfaces.values()].reduce((count,sources)=>count+sources.length,0),flights:Number(pending!==null),timers:0};},
  async close(){if(closed)return;closed=true;surfaces.clear();await pending?.catch(()=>{});await host?.close();},
 };
}
