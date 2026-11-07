/**
 * [INPUT]: Canonical plugin mode catalog and declared Provider capabilities.
 * [OUTPUT]: Trusted mode resolution, immutable first-send identity checks and canonical Bottega tool selection.
 * [POS]: Main-owned mode admission; renderer prompts and tool lists never grant execution authority.
 */
import type { PluginModeSelection, UnifiedPluginMode } from '@bottega/contracts/plugins/platform';
import { builtinProviderDescriptor } from '../../../../../shared/providers/builtin';
let modeCatalog:()=>readonly UnifiedPluginMode[]=()=>[];
export const setPluginModeResolver=(resolve:()=>readonly UnifiedPluginMode[])=>{modeCatalog=resolve;};
export { assertChatModeLocked } from "../../../../../shared/chat-agent/options";
export function resolveChatMode(options:{backend:string;mode?:PluginModeSelection}):PluginModeSelection{
  const selection=options.mode;
  if(!selection?.pluginId){
    if(selection?.id&&selection.id!=='standard'&&selection.id!=='create')throw new Error('Unknown Chat mode');
    return selection?.id==='create'?{id:'create',name:'Create mode',prompt:'Create and improve the selected work object. For plugin source work, use the registered plugin source project and validate the complete package. A normal Project remains a normal Project; create a separate plugin only through the New plugin action.'}:{id:'standard',name:'Standard mode'};
  }
  const mode=modeCatalog().find(item=>item.pluginId===selection.pluginId&&item.id===selection.id);
  if(!mode?.ready)throw new Error(mode?.unavailableReason??'The selected plugin mode is unavailable. Turn on its plugin and dependencies, or start a new Chat.');
  const capabilities=builtinProviderDescriptor(options.backend)?.capabilities;
  // Ordinary Chat has no measured strict-role sandbox. A prompt cannot establish read-only authority.
  if(mode.nativeRequirements?.readOnly)throw new Error('This mode requires enforced read-only access, which is unavailable for ordinary Chat.');
  if(mode.nativeRequirements?.toolSelection)throw new Error('This mode requires native CLI tool filtering, which is not verified for ordinary Chat.');
  if(mode.nativeRequirements?.persistentSessions&&capabilities?.resume!=='declared')throw new Error('This Agent cannot continue member sessions.');
  const {ready:_ready,unavailableReason:_reason,...canonical}=mode;
  return canonical;
}
export function modeToolSelection(options:{backend:string;mode?:PluginModeSelection}){
  const mode=resolveChatMode(options);
  return mode.tools?{selectedPlugins:mode.tools.plugins,selectedTools:mode.tools.tools}:{};
}
