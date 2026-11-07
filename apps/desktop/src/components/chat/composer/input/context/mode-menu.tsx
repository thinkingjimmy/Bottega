/**
 * [INPUT]: Canonical mode catalog, declared Provider facts and the existing durable Chat draft owner.
 * [OUTPUT]: ModeMenuContent with truthful native requirement explanations and pre-send mode selection.
 * [POS]: On-demand mode menu; the trigger, footer and RichInput remain owned by controls/composer.
 */
import {useSyncExternalStore} from 'react';
import type {PluginModeSelection,UnifiedPluginMode} from '@bottega/contracts/plugins/platform';
import {DropdownMenuLabel,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator} from '@ai-chat/ui/components/ui/dropdown-menu';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {usePluginModes} from '@/lib/plugin-platform/projection/modes';
import {pluginPickerCopy} from '@/lib/plugin-platform/picker-copy';
import {providerCatalogStore} from '@/lib/provider-catalog/store';
import {updateAgentDraft} from '@/lib/chat-agent-draft/state';
import {updateComposer} from '@/lib/chat/state/composer/chat-composer-store';
import type {ChatSessionController} from '../../../runtime/use-chat-session';
const modeKey=(mode:PluginModeSelection)=>`${mode.pluginId??''}/${mode.id}`;
function modeReason(mode:UnifiedPluginMode,capabilities:Record<string,string>|undefined,copy:ReturnType<typeof pluginPickerCopy>){
  if(!mode.ready)return mode.unavailableReason??copy.unavailable;
  if(mode.nativeRequirements?.readOnly)return copy.readonlyUnsupported;
  if(mode.nativeRequirements?.toolSelection)return copy.toolsUnsupported;
  if(mode.nativeRequirements?.persistentSessions&&capabilities?.resume!=='declared')return copy.sessionsUnsupported;
  return null;
}
export function ModeMenuContent({controller}:{controller:ChatSessionController['composer']}){
  const {i18n}=useAppTranslation(),copy=pluginPickerCopy(i18n.language),{modes,error}=usePluginModes();
  const catalog=useSyncExternalStore(providerCatalogStore.subscribe,providerCatalogStore.getSnapshot),capabilities=catalog.entries.find(item=>item.id===controller.turnOptions.backend)?.capabilities;
  const selected=controller.turnOptions.mode??{id:'standard',name:copy.standard};
  const chooseMode=(key:string)=>{const mode=key==='/standard'?{id:'standard',name:copy.standard}:key==='/create'?{id:'create',name:copy.create}:modes.find(item=>modeKey(item)===key);
    if(!mode)return;const {ready:_ready,unavailableReason:_reason,...snapshot}=mode as UnifiedPluginMode;
    updateAgentDraft(controller.chatId,current=>current.canonical?current:({...current,options:{...current.options,mode:snapshot}}));updateComposer(controller.chatId,current=>({...current}));};
  return <><DropdownMenuRadioGroup value={modeKey(selected)} onValueChange={chooseMode}>
    <DropdownMenuRadioItem value="/standard">{copy.standard}</DropdownMenuRadioItem><DropdownMenuRadioItem value="/create">{copy.create}</DropdownMenuRadioItem>
    {modes.length>0&&<DropdownMenuSeparator/>}{modes.map(mode=>{const reason=modeReason(mode,capabilities,copy);return <DropdownMenuRadioItem key={modeKey(mode)} value={modeKey(mode)} disabled={!!reason} textValue={mode.name}><div className="min-w-0"><div>{mode.name}</div><div className="text-[11px] text-muted-foreground">{mode.pluginId}</div>{reason&&<p className="whitespace-normal text-[11px] text-muted-foreground">{reason}</p>}</div></DropdownMenuRadioItem>;})}
  </DropdownMenuRadioGroup>{error&&<p role="alert" className="px-2 py-1 text-xs text-destructive">{copy.loadFailed}</p>}<DropdownMenuSeparator/><DropdownMenuLabel className="whitespace-normal text-[11px] font-normal text-muted-foreground">{copy.nativeNote}</DropdownMenuLabel></>;
}
