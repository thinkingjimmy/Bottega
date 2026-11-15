/**
 * [INPUT]: Depends on validated summary declarations, bounded host readings and Intl formatting through the shared presentation adapter.
 * [OUTPUT]: Provides the recursive node interpreter for containers, text, static and bound icons, progress and sparkline.
 * [POS]: Node leaf of the summary renderer; no author script, HTML, CSS or action enters this component.
 */
import type {CSSProperties} from 'react';
import type {DockSummaryNode} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading,DockSeries} from '@bottega/contracts/plugins/dock/data';
import type {DockEdge} from '../../../../../shared/system-dock/local-state';
import {readingIsUsable,summaryText} from '../readings';
import {SummaryIcon,summaryIconName} from './icons';
import {SummaryColumns} from './columns';
type Readings=Readonly<Record<string,DockReading>>;
type NodeProps={node:DockSummaryNode;readings:Readings;locale:string;edge:DockEdge};
const color=(node:DockSummaryNode):CSSProperties=>!('color' in node)||!node.color||node.color==='default'?{}:node.color==='muted'?{opacity:0.65}:{color:`var(--dock-summary-${node.color})`};
const align=(value?:'start'|'center'|'end')=>value==='start'?'flex-start':value==='end'?'flex-end':'center';
function series(value:unknown):value is DockSeries{return Boolean(value&&typeof value==='object'&&'points' in value&&Array.isArray(value.points)&&value.points.length<=64);}
export function SummaryNode({node,readings,locale,edge}:NodeProps){
 if('children' in node){
  // On side edges a row holding block children stacks vertically, mirroring the Dock rail axis.
  const vertical=edge!=='bottom'&&node.type==='row'&&node.children.some(child=>child.type==='column'||child.type==='columns');
  return <span data-summary-node={node.type} className={node.type==='row'?'summary-row':'summary-col'} style={{flexDirection:node.type==='row'&&!vertical?'row':'column',gap:node.gap,alignItems:edge==='bottom'?align(node.align):'center',justifyContent:'center',minWidth:0,maxWidth:'100%',...color(node)}}>
   {node.children.map((child,index)=><SummaryNode key={index} node={child} readings={readings} locale={locale} edge={edge}/>)}</span>;
 }
 if(node.type==='columns')return <SummaryColumns node={node} readings={readings} locale={locale} edge={edge}/>;
 if(node.type==='icon'){
  const name='name' in node?node.name:summaryIconName(readings[node.source]?.values[node.field]);
  return name?<SummaryIcon name={name} color={'color' in node?node.color:undefined}/>:null;
 }
 if('text' in node){
  const display=node.type==='primary'&&node.emphasis==='display';
  return <span data-summary-node={display?'display':node.type} className={display?'summary-display':`summary-${node.type}`} style={color(node)}>{summaryText(node.text,readings,locale)}</span>;
 }
 if(node.type==='progress'){
  const reading=readings[node.source];if(!readingIsUsable(reading))return <span data-summary-node="progress">—</span>;
  const value=reading?.values[node.field],maximum=reading?.values[node.maximumField];
  const ratio=typeof value==='number'&&Number.isFinite(value)&&typeof maximum==='number'&&Number.isFinite(maximum)&&maximum>0?Math.max(0,Math.min(1,value/maximum)):null;
  return ratio===null?<span data-summary-node="progress">—</span>:<span data-summary-node="progress" style={{display:'block',width:40,height:4,borderRadius:2,background:'color-mix(in srgb, currentColor 15%, transparent)',overflow:'hidden',...color(node)}}><span style={{display:'block',width:`${ratio*100}%`,height:'100%',background:'currentColor'}} /></span>;
 }
 if(!readingIsUsable(readings[node.source]))return <span data-summary-node="sparkline">—</span>;
 const value=readings[node.source]?.values[node.field];
 if(!series(value)||value.points.some(point=>!Number.isFinite(point.at)||point.value!==null&&!Number.isFinite(point.value)))return <span data-summary-node="sparkline">—</span>;
 const points=[...value.points].sort((a,b)=>a.at-b.at),numbers=points.flatMap(point=>point.value===null?[]:[point.value]),minimum=Math.min(...numbers),span=Math.max(...numbers)-minimum||1;
 const first=points[0]?.at??0,range=(points.at(-1)?.at??first)-first||1;
 const path=points.map((point,index)=>point.value===null?'':`${index===0||points[index-1]!.value===null?'M':'L'}${(point.at-first)/range*44},${18-(point.value-minimum)/span*16}`).join(' ');
 return <svg data-summary-node="sparkline" width={44} height={20} viewBox="0 0 44 20" aria-hidden="true" style={color(node)}><path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} /></svg>;
}
