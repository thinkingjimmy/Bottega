/**
 * [INPUT]: Depends on official Widget settings, public Dock declarations, Provider labels and localized product copy.
 * [OUTPUT]: Provides independent declarative official fork snapshots preserving selected sources and quota windows.
 * [POS]: First-party authoring templates; they contain no native product module, credential or inherited grant.
 */
import {dockContributionSchema,type DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {DockSummaryNode} from '@bottega/contracts/plugins/dock/summary';
import type {DockWidget} from '../../../../../shared/system-dock/layout';
import {builtinProviderCatalog} from '../../../../../shared/providers/catalog';
import {USAGE_QUERY_TARGETS} from '../../../../../shared/ipc/settings/usage-ipc';
type Copy=(key:string,values?:Record<string,unknown>)=>string;
const literal=(value:string)=>({kind:'literal' as const,value});
const reading=(source:string,field:string,format:'number'|'percent'|'currency'='number'):DockSummaryNode=>({type:'primary',text:{kind:'binding',source,field,format}});
const providerName=(id:string)=>{const lookup=builtinProviderCatalog.get(id);return lookup.known?lookup.entry.descriptor.displayName:id;};
export function officialDockContribution(widget:Exclude<DockWidget,{type:'custom'}>,t:Copy):DockContribution{
 let title=t(widget.type==='builtin.tasks'?'systemDock.entry.tasks':widget.type==='builtin.ai-activity'?'systemDock.entry.activity':'systemDock.entry.limits');
 let settings:DockContribution['settings']=[],data:DockContribution['data']=[],values:DockSummaryNode[]=[];
 if(widget.type==='builtin.tasks'){
  data=[{id:'tasks',kind:'tasks'}];values=[reading('tasks','running'),{type:'secondary',text:{kind:'binding',source:'tasks',field:'waiting',format:'number'}}];
 }else if(widget.type==='builtin.ai-activity'){
  settings=[{id:'source',type:'select',label:t('systemDock.widgets.usageSource'),default:widget.source,options:USAGE_QUERY_TARGETS.map(value=>({value,label:value==='all'?t('systemDock.widgets.allAgents'):providerName(value)}))}];
  data=[{id:'activity',kind:'activity',sourceSetting:'source',period:'today'}];values=[reading('activity','tokens'),{type:'secondary',text:{kind:'binding',source:'activity',field:'costUsd',format:'currency'}}];
 }else{
  for(const [index,backend]of widget.selectedBackends.entries()){
   const lookup=builtinProviderCatalog.get(backend),name=lookup.known?lookup.entry.descriptor.displayName:backend,setting='agent-'+index,source='quota-'+index;
   settings.push({id:setting,type:'select',label:name,default:backend,options:[{value:backend,label:name}]});data.push({id:source,kind:'limits',backendSetting:setting,...(widget.selectionByBackend[backend]?{selection:widget.selectionByBackend[backend]}:{})});
   if(index===0){title=name;values=[reading(source,'remaining','percent')];}
  }
  if(widget.selectedBackends.length>1)values.push({type:'secondary',text:literal(t('systemDock.widgets.otherSources',{count:widget.selectedBackends.length-1}))});
  if(!values.length)values=[{type:'status',text:literal(t('systemDock.widgets.states.needs-setup'))}];
 }
 const node:DockSummaryNode={type:'column',gap:2,children:[{type:'label',text:literal(title)},...values]};
 return dockContributionSchema.parse({schemaVersion:1,sizes:['small'],summaries:{small:{bottom:node,left:node,right:node}},settings,data,detail:{kind:'standard'},refresh:{mode:'visible'}});
}
