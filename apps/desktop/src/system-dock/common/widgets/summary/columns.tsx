/**
 * [INPUT]: Depends on bounded reading records, localized value formatting and the shared icon guard.
 * [OUTPUT]: Provides the record-columns node renderer used for forecast strips and repeated readings.
 * [POS]: Column leaf of the summary renderer; column icons never count toward the one-icon rule.
 */
import type {DockSummaryNode} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockEdge} from '../../../../../shared/system-dock/local-state';
import {readingIsUsable,readingValueText} from '../readings';
import {SummaryIcon,summaryIconName} from './icons';
type ColumnsNode=Extract<DockSummaryNode,{type:'columns'}>;
export function SummaryColumns({node,readings,locale,edge}:{node:ColumnsNode;readings:Readonly<Record<string,DockReading>>;locale:string;edge:DockEdge}){
 const reading=readings[node.source];
 if(!readingIsUsable(reading))return <span data-summary-node="columns" className="summary-columns"/>;
 const records=(reading?.records??[]).slice(0,node.max);
 return <span data-summary-node="columns" className="summary-columns" style={{flexDirection:edge==='bottom'?'row':'column'}}>
  {records.map(record=>{
   const icon=summaryIconName(record.values[node.icon]),secondary=node.secondary?record.values[node.secondary]:undefined;
   return <span key={record.id} data-summary-node="column" className="summary-column">
    <span data-summary-node="column-title" className="summary-column-title">{readingValueText(record.values[node.title],locale)}</span>
    {icon&&<SummaryIcon name={icon}/>}
    <span className="summary-column-range"><span data-summary-node="column-value">{readingValueText(record.values[node.value],locale,node.format)}</span>
     {secondary!==undefined&&secondary!==null&&<span data-summary-node="column-secondary" className="summary-column-secondary">{readingValueText(secondary,locale,node.format)}</span>}</span>
   </span>;
  })}
 </span>;
}
