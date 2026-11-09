/**
 * [INPUT]: Lucide built-in mode icons, canonical mode descriptions/provenance, declared Provider facts and the existing durable Chat draft owner.
 * [OUTPUT]: Icon-labeled descriptive accessible mode choices, truthful availability reasons and execution-only pre-send snapshots.
 * [POS]: On-demand mode menu; the trigger, footer and RichInput remain owned by controls/composer.
 */
import {useId,useSyncExternalStore} from 'react';
import {SlidersHorizontal,Sparkles,type LucideIcon} from 'lucide-react';
import type {PluginModeSelection,UnifiedPluginMode} from '@bottega/contracts/plugins/platform';
import {DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuSeparator} from '@ai-chat/ui/components/ui/dropdown-menu';
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
  return null;
}

function ModeOption({value,name,description,source,reason,icon:Icon}:{value:string;name:string;description:string;source?:string;reason?:string|null;icon?:LucideIcon}){
  const descriptionId=useId();
  return <DropdownMenuRadioItem value={value} disabled={!!reason} textValue={name} aria-label={name} aria-describedby={descriptionId}
    className="min-h-16 rounded-lg py-3 pr-10 pl-3 text-sm [&>[data-slot=dropdown-menu-radio-item-indicator]]:right-3">
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-2 leading-5 [overflow-wrap:anywhere]">
        {Icon&&<Icon aria-hidden="true" className="size-4 shrink-0 self-center"/>}
        <span>{name}</span>{source&&<span className="text-[11px] text-muted-foreground">{source}</span>}
      </div>
      <div id={descriptionId} className="space-y-1 whitespace-normal text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
        <p>{description}</p>{reason&&<p>{reason}</p>}
      </div>
    </div>
  </DropdownMenuRadioItem>;
}

export function ModeMenuContent({controller}:{controller:ChatSessionController['composer']}){
  const {i18n}=useAppTranslation(),copy=pluginPickerCopy(i18n.language),{modes,error}=usePluginModes();
  const catalog=useSyncExternalStore(providerCatalogStore.subscribe,providerCatalogStore.getSnapshot),capabilities=catalog.entries.find(item=>item.id===controller.turnOptions.backend)?.capabilities;
  const selected=controller.turnOptions.mode??{id:'standard',name:copy.standard};
  const chooseMode=(key:string)=>{
    const mode=key==='/standard'?{id:'standard',name:copy.standard}:key==='/create'?{id:'create',name:copy.create}:modes.find(item=>modeKey(item)===key);
    if(!mode)return;
    const {ready:_ready,unavailableReason:_reason,description:_description,pluginName:_pluginName,...snapshot}=mode as UnifiedPluginMode;
    updateAgentDraft(controller.chatId,current=>current.canonical?current:({...current,options:{...current.options,mode:snapshot}}));
    updateComposer(controller.chatId,current=>({...current}));
  };
  return <>
    <DropdownMenuRadioGroup value={modeKey(selected)} onValueChange={chooseMode}>
      <ModeOption value="/standard" name={copy.standard} description={copy.standardDescription} icon={SlidersHorizontal}/>
      <ModeOption value="/create" name={copy.create} description={copy.createDescription} icon={Sparkles}/>
      {modes.length>0&&<DropdownMenuSeparator className="mx-1 my-1"/>}
      {modes.map(mode=><ModeOption key={modeKey(mode)} value={modeKey(mode)} name={mode.name}
        description={mode.description?.trim()||copy.pluginModeDescription}
        source={copy.pluginSource.replace('{{plugin}}',mode.pluginName??mode.pluginId)} reason={modeReason(mode,capabilities,copy)}/>)}
    </DropdownMenuRadioGroup>
    {error&&<p role="alert" className="px-3 py-2 text-xs text-destructive">{copy.loadFailed}</p>}
  </>;
}
