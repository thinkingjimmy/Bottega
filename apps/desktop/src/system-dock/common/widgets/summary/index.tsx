/**
 * [INPUT]: Depends on validated summary declarations, bounded host readings and the scoped shared Dock palette.
 * [OUTPUT]: Provides the non-interactive host summary renderer with identical semantic colors for the Dock and exact-size theme previews.
 * [POS]: Dock presentation interpreter; no author script, HTML, CSS, navigation or action enters this component.
 */
import type {DockSummaryNode,DockSummarySize} from '@bottega/contracts/plugins/dock/summary';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockEdge} from '../../../../../shared/system-dock/local-state';
import {SummaryNode} from './nodes';
import './summary.css';
export function DockSummary({node,readings,locale,size='small',edge='bottom'}:{node:DockSummaryNode;readings:Readonly<Record<string,DockReading>>;locale:string;size?:DockSummarySize;edge?:DockEdge}){
 return <span className="dock-summary-theme" data-size={size} data-edge={edge}><SummaryNode node={node} readings={readings} locale={locale} edge={edge}/></span>;
}
export default DockSummary;
