/**
 * [INPUT]: Canonical team/member snapshots and exact main-owned member Chat navigation.
 * [OUTPUT]: TeamMemberRows nested under a Lead Chat without adding members to root/project lists.
 * [POS]: Sidebar child rows; activity status is independent of task completion.
 */
import { useState } from 'react';
import { useLocation,useNavigate } from 'react-router';
import { UserRound } from 'lucide-react';
import { SidebarMenuSub,SidebarMenuSubButton,SidebarMenuSubItem } from '@ai-chat/ui/components/ui/sidebar';
import { useAppTranslation } from '@/components/providers/preferences/i18n-provider';
import { teamStateLabel } from '@/lib/plugin-platform/status-copy';
import { chatRoute } from '@/lib/chat/drafts/draft-route';
import { pluginTeamBridge,usePluginTeams } from './client';
export function TeamMemberRows({leadChatId}:{leadChatId:string}){
  const {teams}=usePluginTeams(),{i18n}=useAppTranslation(),navigate=useNavigate(),location=useLocation(),[error,setError]=useState('');
  const entries=teams.filter(team=>team.leadChatId===leadChatId).flatMap(team=>team.members.map(member=>({team,member})));
  if(!entries.length)return null;
  return <SidebarMenuSub>{entries.map(({team,member})=><SidebarMenuSubItem key={member.chatId}><SidebarMenuSubButton data-team-member-chat={member.chatId} isActive={location.pathname===chatRoute(member.chatId)} asChild><button type="button" onClick={()=>{setError('');void pluginTeamBridge()!.openMember({teamId:team.id,memberId:member.memberId}).then(target=>navigate(chatRoute(target.chatId))).catch(cause=>setError(String(cause)));}}><UserRound className="size-3.5"/><span className="truncate">{member.name}</span><span className="ml-auto text-[10px] text-muted-foreground">{teamStateLabel(member.status,i18n.language)}</span></button></SidebarMenuSubButton></SidebarMenuSubItem>)}{error&&<li role="alert" className="px-2 text-[11px] text-destructive">{error}</li>}</SidebarMenuSub>;
}
