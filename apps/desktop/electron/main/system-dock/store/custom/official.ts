/**
 * [INPUT]: Depends on current official quota/usage directories and existing built-in Widget schemas.
 * [OUTPUT]: Provides metadata-only choices, defaults and current-directory validation for official instance confirmation.
 * [POS]: Stateless host policy used by the instance journal; no data consumer or plugin source is created.
 */
import type {AgentBackendId} from '../../../../../shared/ipc/agent/agent-ipc';
import type {UsageSourceId} from '../../../../../shared/ipc/settings/usage-ipc';
import type {AgentUsageLimits} from '../../../../../shared/usage-limits/types';
import {defaultLimitsWidget,defaultActivityWidget,defaultTasksWidget} from '../../../../../shared/system-dock/layout';
import type {OfficialWidget} from '../../../../../shared/system-dock/widgets/official';
export type OfficialWidgetDirectory={agents:readonly AgentUsageLimits[];configurable:readonly AgentBackendId[];sources:readonly UsageSourceId[]};
export function officialDefault(id:OfficialWidget['type'],directory:OfficialWidgetDirectory):OfficialWidget{
 return id==='builtin.tasks'?defaultTasksWidget():id==='builtin.ai-activity'?defaultActivityWidget():defaultLimitsWidget(directory.agents.filter(agent=>agent.availability==='available').map(agent=>agent.backend));
}
export function officialChoices(directory:OfficialWidgetDirectory){
 return{configurable:[...directory.configurable],sources:[...directory.sources],agents:directory.agents.map(agent=>({backend:agent.backend,pools:agent.pools.map(pool=>({id:pool.id,label:pool.label,isGeneral:pool.isGeneral,
  windows:pool.windows.map(window=>({id:window.id,windowDurationMins:window.windowDurationMins,...(window.calendarPeriod?{calendarPeriod:window.calendarPeriod}:{})}))}))}))};
}
export function validateOfficial(widget:OfficialWidget,directory:OfficialWidgetDirectory){
 if(widget.type==='builtin.ai-activity'&&widget.source!=='all'&&!directory.sources.includes(widget.source))throw new Error('DOCK_WIDGET_SOURCE_CONFIGURATION_REQUIRED');
 if(widget.type!=='builtin.ai-limits')return;
 if(widget.selectedBackends.some(backend=>!directory.configurable.includes(backend))||Object.keys(widget.selectionByBackend).some(backend=>!widget.selectedBackends.includes(backend as AgentBackendId)))throw new Error('DOCK_WIDGET_SOURCE_CONFIGURATION_REQUIRED');
 for(const backend of widget.selectedBackends){
  const selection=widget.selectionByBackend[backend];if(!selection||selection.poolId===null&&selection.windowId===null)continue;
  const pools=directory.agents.find(agent=>agent.backend===backend)?.pools??[];
  if(!pools.some(pool=>(selection.poolId===null||pool.id===selection.poolId)&&(selection.windowId===null||pool.windows.some(window=>window.id===selection.windowId))))throw new Error('DOCK_WIDGET_SOURCE_CONFIGURATION_REQUIRED');
 }
}
