/**
 * [INPUT]: Native Chat controller, lightweight context labels, canonical selected-mode readiness and shared UI primitives.
 * [OUTPUT]: Persistent draft triggers with matching built-in mode icons, a Project-only lazy branch selector, top-preferring viewport-bounded lazy mode/object menus and immutable first-send footer mode.
 * [POS]: Composer context shell; RichInput remains mounted in its existing parent through every selection and menu load.
 */
import {lazy,Suspense,useState} from 'react';
import {Link} from 'react-router';
import {ChevronDown,Folder,GitBranch,LockKeyhole,MessageSquare,Puzzle,Settings,SlidersHorizontal,Sparkles} from 'lucide-react';
import type {PluginModeSelection} from '@bottega/contracts/plugins/platform';
import {Button} from '@ai-chat/ui/components/ui/button';
import {Popover,PopoverContent,PopoverTrigger} from '@ai-chat/ui/components/ui/popover';
import {DropdownMenu,DropdownMenuContent,DropdownMenuTrigger} from '@ai-chat/ui/components/ui/dropdown-menu';
import {Tooltip,TooltipContent,TooltipTrigger} from '@ai-chat/ui/components/ui/tooltip';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {usePluginModes} from '@/lib/plugin-platform/projection/modes';
import {pluginContextCopy} from '@/lib/plugin-platform/context-copy';
import {useComposerState} from '@/lib/chat/state/composer/chat-composer-store';
import {projectSettingsRoute} from '@/lib/chat/drafts/draft-route';
import type {ChatSessionController} from '../../../runtime/use-chat-session';
import {composerContextButtonClass} from '../chat-project-selector';
const ChatBranchSelector=lazy(()=>import('../../agents/chat-branch-selector').then(module=>({default:module.ChatBranchSelector})));
const loadModeMenu=()=>import('./mode-menu'),loadObjectMenu=()=>import('./object-menu');
const ModeMenuContent=lazy(()=>loadModeMenu().then(module=>({default:module.ModeMenuContent}))),WorkObjectMenuContent=lazy(()=>loadObjectMenu().then(module=>({default:module.WorkObjectMenuContent})));
const modeKey=(mode:PluginModeSelection)=>`${mode.pluginId??''}/${mode.id}`;
export function useSelectedModeIssue(mode:PluginModeSelection|undefined,remote:boolean){
  const {i18n}=useAppTranslation(),copy=pluginContextCopy(i18n.language),{modes,error}=usePluginModes();
  if(!mode?.pluginId)return null;if(remote)return copy.localOnly;
  const current=modes.find(item=>modeKey(item)===modeKey(mode));return current?.ready?null:current?.unavailableReason??(error?copy.loadFailed:copy.unavailable);
}
export function LockedChatMode({controller}:{controller:ChatSessionController['composer']}){
  const {i18n}=useAppTranslation(),copy=pluginContextCopy(i18n.language),mode=controller.turnOptions.mode;
  if(!controller.persisted)return null;const name=mode?.pluginId?mode.name:mode?.id==='create'?copy.create:copy.standard;
  return <Tooltip><TooltipTrigger asChild><span data-mode-locked="" tabIndex={0} className="inline-flex min-w-0 max-w-36 items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"><LockKeyhole className="size-3 shrink-0"/><span className="truncate">{name}</span></span></TooltipTrigger><TooltipContent>{copy.locked}</TooltipContent></Tooltip>;
}
export function DraftContextControls({controller,remote,ownerLabel,onBranchBusy,disabled}:{controller:ChatSessionController['composer'];remote:boolean;ownerLabel:string|null;onBranchBusy:(busy:boolean)=>void;disabled:boolean}){
  const {i18n,t}=useAppTranslation(),copy=pluginContextCopy(i18n.language),state=useComposerState(controller.chatId),[open,setOpen]=useState(false);
  const selected=controller.turnOptions.mode,name=selected?.pluginId?selected.name:selected?.id==='create'?copy.create:copy.standard,selectedProject=controller.projects.find(item=>item.id===controller.selectedProjectId);
  const ModeIcon=selected?.id==='create'&&!selected.pluginId?Sparkles:SlidersHorizontal;
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button data-mode-selector="" aria-label={copy.mode} className={`${composerContextButtonClass} max-w-48 gap-2 text-primary`} disabled={disabled} size="lg" variant="ghost" onPointerEnter={()=>void loadModeMenu()} onFocus={()=>void loadModeMenu()}><ModeIcon className="size-4 shrink-0"/><span className="truncate">{name}</span><ChevronDown className="size-3 shrink-0"/></Button></DropdownMenuTrigger>
      <DropdownMenuContent data-mode-menu="" className="w-96 max-w-[calc(100vw-2rem)] rounded-xl p-1.5" side="top" sideOffset={8} align="start" collisionPadding={16}><Suspense fallback={<div role="status" aria-label={copy.mode} aria-busy className="h-16"/>}><ModeMenuContent controller={controller}/></Suspense></DropdownMenuContent>
    </DropdownMenu>
    <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button data-work-object-selector="" aria-label={copy.object} className={`${composerContextButtonClass} max-w-56 gap-2`} disabled={disabled} size="lg" variant="ghost" onPointerEnter={()=>void loadObjectMenu()} onFocus={()=>void loadObjectMenu()}>{state.pluginAuthoring?<Puzzle className="size-4 shrink-0"/>:selectedProject?<Folder className="size-4 shrink-0"/>:<MessageSquare className="size-4 shrink-0"/>}<span className="truncate">{state.pluginAuthoring?.displayName??selectedProject?.name??copy.chat}</span><ChevronDown className="size-3 shrink-0"/></Button></PopoverTrigger>
      <PopoverContent className="w-80 p-2" side="top" align="start" collisionPadding={16}><Suspense fallback={<div role="status" aria-label={copy.object} aria-busy className="h-16"/>}><WorkObjectMenuContent controller={controller} remote={remote} onClose={()=>setOpen(false)}/></Suspense></PopoverContent>
    </Popover>
    {controller.selectedProjectId&&<>{remote?<Button className={`${composerContextButtonClass} max-w-56 gap-2`} disabled size="lg" variant="ghost"><GitBranch className="size-4"/><span className="truncate">{ownerLabel}</span></Button>:<Suspense fallback={<Button className={`${composerContextButtonClass} max-w-56 gap-2`} disabled aria-busy size="lg" variant="ghost"><GitBranch className="size-4"/><span className="truncate">{t('common.loading')}</span></Button>}><ChatBranchSelector key={controller.selectedProjectId} projectId={controller.selectedProjectId} disabled={disabled} listBranches={controller.listBranches} checkoutBranch={controller.checkoutBranch} createBranch={controller.createBranch} onBusyChange={onBranchBusy}/></Suspense>}
      <Button aria-label={t('projectSettings.open')} asChild className="relative ml-auto rounded-full touch-target-44 hover:bg-muted-foreground/10" size="icon-lg" variant="ghost"><Link to={projectSettingsRoute(controller.selectedProjectId)}><Settings/></Link></Button></>}
    {remote&&state.pluginAuthoring&&<p role="status" className="w-full px-2 text-xs text-muted-foreground">{copy.localOnly}</p>}
  </>;
}
