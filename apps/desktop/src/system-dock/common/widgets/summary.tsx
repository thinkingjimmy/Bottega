/**
 * [INPUT]: Depends on validated summary declarations, bounded host readings, Intl formatting, a fixed icon vocabulary and the scoped shared Dock palette.
 * [OUTPUT]: Provides a non-interactive host summary renderer with identical semantic colors for the Dock and exact-size theme previews.
 * [POS]: Dock presentation interpreter; no author script, HTML, CSS, navigation or action enters this component.
 */
import type {CSSProperties} from 'react';
import {Clock,Calendar,Activity,Gauge,ListTodo,Database,ChartLine,Globe,Flag,Check,TriangleAlert,Sparkles} from 'lucide-react';
import type {DockSummaryNode} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading,DockSeries} from '@bottega/contracts/plugins/dock/data';
import {readingIsUsable,summaryText} from './readings';
import './summary.css';
const ICONS={clock:Clock,calendar:Calendar,activity:Activity,gauge:Gauge,tasks:ListTodo,database:Database,chart:ChartLine,globe:Globe,flag:Flag,check:Check,alert:TriangleAlert,sparkles:Sparkles};
type Readings=Readonly<Record<string,DockReading>>;
const color=(node:DockSummaryNode):CSSProperties=>!('color' in node)||node.color==='default'?{}:node.color==='muted'?{opacity:0.65}:{color:`var(--dock-summary-${node.color})`};
function series(value:unknown):value is DockSeries{return Boolean(value&&typeof value==='object'&&'points' in value&&Array.isArray(value.points)&&value.points.length<=64);}
type SummaryProps={node:DockSummaryNode;readings:Readings;locale:string};
export function DockSummary(props:SummaryProps){return <span className="dock-summary-theme"><SummaryNode {...props}/></span>;}
function SummaryNode({node,readings,locale}:SummaryProps){
  if('children' in node)return <span style={{display:'flex',flexDirection:node.type==='row'?'row':'column',gap:node.gap,alignItems:node.align==='start'?'flex-start':node.align==='end'?'flex-end':'center',justifyContent:'center',minWidth:0,maxWidth:'100%',...color(node)}}>
    {node.children.map((child,index)=><SummaryNode key={index} node={child} readings={readings} locale={locale} />)}</span>;
  if(node.type==='icon'){const Icon=ICONS[node.name];return <Icon aria-hidden="true" width={16} height={16} style={{flexShrink:0,...color(node)}} />;}
  if('text' in node)return <span style={{fontSize:node.type==='primary'?20:11,lineHeight:node.type==='primary'?'24px':'14px',fontWeight:node.type==='primary'?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'100%',...color(node)}}>{summaryText(node.text,readings,locale)}</span>;
  if(node.type==='progress'){
    const reading=readings[node.source];if(!readingIsUsable(reading))return <span>—</span>;
    const value=reading?.values[node.field],maximum=reading?.values[node.maximumField];
    const ratio=typeof value==='number'&&Number.isFinite(value)&&typeof maximum==='number'&&Number.isFinite(maximum)&&maximum>0?Math.max(0,Math.min(1,value/maximum)):null;
    return ratio===null?<span>—</span>:<span style={{display:'block',width:40,height:4,borderRadius:2,background:'color-mix(in srgb, currentColor 15%, transparent)',overflow:'hidden',...color(node)}}><span style={{display:'block',width:`${ratio*100}%`,height:'100%',background:'currentColor'}} /></span>;
  }
  if(!readingIsUsable(readings[node.source]))return <span>—</span>;
  const value=readings[node.source]?.values[node.field];
  if(!series(value)||value.points.some(point=>!Number.isFinite(point.at)||point.value!==null&&!Number.isFinite(point.value)))return <span>—</span>;
  const points=[...value.points].sort((a,b)=>a.at-b.at),numbers=points.flatMap(point=>point.value===null?[]:[point.value]),minimum=Math.min(...numbers),span=Math.max(...numbers)-minimum||1;
  const first=points[0]?.at??0,range=(points.at(-1)?.at??first)-first||1;
  const path=points.map((point,index)=>point.value===null?'':`${index===0||points[index-1]!.value===null?'M':'L'}${(point.at-first)/range*44},${18-(point.value-minimum)/span*16}`).join(' ');
  return <svg width={44} height={20} viewBox="0 0 44 20" aria-hidden="true" style={color(node)}><path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>;
}
