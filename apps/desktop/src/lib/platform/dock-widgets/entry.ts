/**
 * [INPUT]: Depends on fixed main-owned Widget entry requests and the existing Settings overlay destination.
 * [OUTPUT]: Provides one expiring pending entry, subscription and identity-bound consumption after Settings is ready.
 * [POS]: Main-window shortcut transport; it never writes source, layout, credentials or data grants.
 */
import type {DockWidgetEntry} from '../../../../shared/system-dock/widgets/management';
import {requestSettingsSection} from '../../settings/navigation/settings-navigation';
type PendingEntry=Readonly<{id:number;expiresAt:number;entry:DockWidgetEntry}>;
let pending:PendingEntry|null=null,sequence=0;
const listeners=new Set<()=>void>();
export function queueWidgetEntry(entry:DockWidgetEntry){
 pending={id:++sequence,expiresAt:Date.now()+30_000,entry};requestSettingsSection({section:'dock'});for(const listener of listeners)listener();
}
export function consumeWidgetEntry(id:number){if(pending?.id===id)pending=null;}
export function subscribeWidgetEntry(listener:(entry:PendingEntry)=>void){
 let active=true;const deliver=()=>{if(active&&pending)listener(pending);};listeners.add(deliver);queueMicrotask(deliver);
 return()=>{active=false;listeners.delete(deliver);};
}
