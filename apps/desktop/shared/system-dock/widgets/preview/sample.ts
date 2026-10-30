/**
 * [INPUT]: Depends on declared data requirements and the public bounded reading shape.
 * [OUTPUT]: Provides sampleReadings for explicitly marked host and isolated authoring previews.
 * [POS]: Shared deterministic examples; no real data owner, grant or clock is acquired.
 */
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {dockApiFields} from '@bottega/contracts/plugins/dock/api';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
export function sampleReadings(dock:DockContribution):Record<string,DockReading>{
 return Object.fromEntries(dock.data.map(source=>{
  const values:DockReading['values']=source.kind==='api'?Object.fromEntries(dockApiFields(source).map(field=>[field.id,field.type==='number'?23.5:field.type==='date'?Date.UTC(2026,9,29):field.type==='boolean'?true:field.type==='series'?{from:0,to:3,timeZone:'UTC',points:[{at:0,value:1},{at:1,value:2},{at:2,value:3}]}:'Sample'])):source.kind==='clock'?{remainingDays:12,remainingHours:288,remainingSeconds:1036800,time:'10:00',date:'2026-10-28'}
   :source.kind==='tasks'?{running:2,waiting:1,total:3}:source.kind==='limits'?{remaining:25,maximum:100}:source.kind==='activity'?{tokens:12345,costUsd:0.42}
    :source.operation==='history'?{series:{from:0,to:259200000,timeZone:source.timeZone!,points:[{at:0,value:2},{at:86400000,value:null},{at:172800000,value:3}]}}:{count:3,sum:30.5,numericCount:2};
  return[source.id,{state:'ready',updatedAt:null,values}];
 }));
}
