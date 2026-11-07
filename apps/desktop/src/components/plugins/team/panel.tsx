/**
 * [INPUT]: Canonical team snapshots, exact member navigation and task/stop intents.
 * [OUTPUT]: TeamChatPanel with shared-workspace warning and separate member, task and message states; unconfirmed cleanup errors retain a busy-fenced Retry stop action.
 * [POS]: Lead/member Chat notice Slot; team execution stays alive when its panel is closed.
 */
import { useRef,useState } from 'react';
import { useNavigate } from 'react-router';
import { Users } from 'lucide-react';
import { Input } from '@ai-chat/ui/components/ui/input';
import { Button } from '@ai-chat/ui/components/ui/button';
import type { PluginTeamSnapshot } from '@bottega/contracts/plugins/team';
import { pluginPlatformCopy,teamStateLabel } from '@/lib/plugin-platform/copy';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { chatRoute } from '@/lib/chat/drafts/draft-route';
import { pluginTeamBridge,refreshPluginTeams,usePluginTeams } from './client';
const labels=(locale:string)=>{const copy=pluginPlatformCopy(locale);return{team:copy.team,members:copy.members,tasks:copy.tasks,messages:copy.messages,warning:copy.concurrentWrites,isolated:copy.isolatedWrites,title:copy.taskTitle,create:copy.createTask,stop:copy.stop,retryStop:copy.retryStop,open:copy.openChat,lead:copy.backToLead,unassigned:copy.unassigned,dependencies:copy.dependencies,owner:copy.owner,empty:copy.noTasks};};
const stateLabel=teamStateLabel;
function TeamPanel({team,chatId}:{team:PluginTeamSnapshot;chatId:string}){
  const {i18n}=useAppTranslation(),copy=labels(i18n.language),navigate=useNavigate(),[title,setTitle]=useState(''),[owner,setOwner]=useState(''),[dependency,setDependency]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false);
  const run=async(action:()=>Promise<unknown>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await action();await refreshPluginTeams();}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{lock.current=false;setBusy(false);}};
  const openMember=(memberId:string)=>void run(async()=>{const target=await pluginTeamBridge()!.openMember({teamId:team.id,memberId});void navigate(chatRoute(target.chatId));});
  return <details data-plugin-team={team.id} className="shrink-0 border-b bg-background px-4 py-2"><summary className="flex cursor-pointer items-center gap-2 text-xs font-medium"><Users className="size-3.5"/>{copy.team}<span className="font-normal text-muted-foreground">{team.members.length} · {stateLabel(team.status,i18n.language)}</span></summary>
    <div className="max-h-96 space-y-4 overflow-auto py-3"><p className="text-xs text-amber-700 dark:text-amber-400">{team.concurrentWrites==='isolated'?copy.isolated:copy.warning}</p>{chatId!==team.leadChatId&&<Button variant="ghost" size="sm" onClick={()=>void navigate(chatRoute(team.leadChatId))}>{copy.lead}</Button>}
      {(error||team.error)&&<p role="alert" className="text-xs text-destructive">{error||team.error}</p>}
      <section aria-label={copy.members}><h3 className="mb-2 text-xs font-semibold">{copy.members}</h3><div className="grid gap-2 @xl:grid-cols-2">{team.members.map(member=><div key={member.memberId} data-team-member={member.memberId} className="flex min-w-0 items-center gap-2 rounded-lg border p-2"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.name} <span className="font-normal text-muted-foreground">{member.providerId}</span></p><p className="truncate text-[11px] text-muted-foreground">{stateLabel(member.status,i18n.language)} · {member.task}</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={()=>openMember(member.memberId)}>{copy.open}</Button>{(!['stopped','stopping'].includes(member.status)||member.status==='stopping'&&!!team.error)&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void run(()=>pluginTeamBridge()!.stopMember({teamId:team.id,memberId:member.memberId}))}>{member.status==='stopping'?copy.retryStop:copy.stop}</Button>}</div>)}</div></section>
      <section aria-label={copy.tasks}><h3 className="mb-2 text-xs font-semibold">{copy.tasks}</h3><div className="space-y-2">{team.tasks.map(task=><div key={task.id} data-team-task={task.id} className="rounded-lg border p-2"><p className="text-xs font-medium">{task.title}<span className="ml-2 font-normal text-muted-foreground">{stateLabel(task.status,i18n.language)} · v{task.version}</span></p>{task.description&&<p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{task.description}</p>}<p className="mt-1 text-[11px] text-muted-foreground">{copy.owner}: {team.members.find(member=>member.memberId===task.ownerMemberId)?.name??copy.unassigned}{task.dependencies.length?` · ${copy.dependencies}: ${task.dependencies.map(id=>team.tasks.find(value=>value.id===id)?.title??id).join(', ')}`:''}</p></div>)}{!team.tasks.length&&<p className="text-xs text-muted-foreground">{copy.empty}</p>}</div>
        <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={event=>{event.preventDefault();if(!title.trim())return;void run(async()=>{await pluginTeamBridge()!.createTask({teamId:team.id,title:title.trim(),...(owner?{ownerMemberId:owner}:{}),...(dependency?{dependencies:[dependency]}:{})});setTitle('');});}}><Input aria-label={copy.title} placeholder={copy.title} value={title} onChange={event=>setTitle(event.target.value)} disabled={busy} className="h-8 min-w-40 flex-1 text-xs"/><select aria-label={copy.owner} className="h-8 rounded-md border bg-background px-2 text-xs" value={owner} onChange={event=>setOwner(event.target.value)} disabled={busy}><option value="">{copy.unassigned}</option>{team.members.filter(member=>member.status!=='stopped').map(member=><option key={member.memberId} value={member.memberId}>{member.name}</option>)}</select><select aria-label={copy.dependencies} className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs" value={dependency} onChange={event=>setDependency(event.target.value)} disabled={busy}><option value="">{copy.dependencies}</option>{team.tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}</select><Button size="sm" type="submit" disabled={busy||!title.trim()||team.status!=='active'}>{copy.create}</Button></form>
      </section>
      {team.messages.length>0&&<section aria-label={copy.messages}><h3 className="mb-2 text-xs font-semibold">{copy.messages}</h3><div className="space-y-1">{team.messages.slice(-12).map(message=><p key={message.id} className="text-[11px] text-muted-foreground"><span className="font-medium">{stateLabel(message.status,i18n.language)}</span> · {message.body}</p>)}</div></section>}
    </div>
  </details>;
}
export function TeamChatPanel({chatId}:{chatId:string}){
  const {teams}=usePluginTeams();
  return <>{teams.filter(team=>team.leadChatId===chatId||team.members.some(member=>member.chatId===chatId)).map(team=><TeamPanel key={team.id} team={team} chatId={chatId}/>)}</>;
}
