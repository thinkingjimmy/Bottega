/**
 * [INPUT]: Depends on zod and Dock identifier validation for host-rendered declarations.
 * [OUTPUT]: Provides bounded summary nodes, component diagnostics and fixed three-edge dimensions.
 * [POS]: Public Dock presentation contract; never contains author code, HTML, CSS or child actions.
 */
import {z} from 'zod';
import {dockIdentifierSchema} from './settings';
import {DOCK_SUMMARY_SIZES,type DockSummarySize} from './geometry';
export {summaryDimensions,type DockSummarySize} from './geometry';

export const DOCK_SUMMARY_LIMITS=Object.freeze({nodes:64,depth:4,points:64,bytes:8*1024});
export const dockSizeSchema=z.enum(DOCK_SUMMARY_SIZES);
const field=z.string().regex(/^[a-z][A-Za-z0-9-]{0,63}$/);
export const dockTextSchema=z.union([
  z.object({kind:z.literal('literal'),value:z.string().max(80)}).strict(),
  z.object({kind:z.literal('binding'),source:dockIdentifierSchema,field,
    format:z.enum(['text','number','currency','percent','duration','date']).optional()}).strict(),
]);
export type DockSummaryText=z.infer<typeof dockTextSchema>;
export const dockSemanticColorSchema=z.enum(['default','muted','accent','success','warning','danger']);
type Color=z.infer<typeof dockSemanticColorSchema>;
export type DockSummaryNode=
  | {type:'row'|'column';children:DockSummaryNode[];gap:0|2|4|6;align?:'start'|'center'|'end'}
  | {type:'label'|'primary'|'secondary'|'status';text:DockSummaryText;color?:Color}
  | {type:'icon';name:'clock'|'calendar'|'activity'|'gauge'|'tasks'|'database'|'chart'|'globe'|'flag'|'check'|'alert'|'sparkles';color?:Color}
  | {type:'progress';source:string;field:string;maximumField:string;color?:Color}
  | {type:'sparkline';source:string;field:string;color?:Color};
const scalarNode=z.object({type:z.enum(['label','primary','secondary','status']),text:dockTextSchema,color:dockSemanticColorSchema.optional()}).strict();
const tree:z.ZodType<DockSummaryNode>=z.lazy(()=>z.union([
  z.object({type:z.literal('row'),children:z.array(tree).min(1).max(2),gap:z.union([z.literal(0),z.literal(2),z.literal(4),z.literal(6)]),align:z.enum(['start','center','end']).optional()}).strict(),
  z.object({type:z.literal('column'),children:z.array(tree).min(1).max(4),gap:z.union([z.literal(0),z.literal(2),z.literal(4),z.literal(6)]),align:z.enum(['start','center','end']).optional()}).strict(),
  scalarNode,
  z.object({type:z.literal('icon'),name:z.enum(['clock','calendar','activity','gauge','tasks','database','chart','globe','flag','check','alert','sparkles']),color:dockSemanticColorSchema.optional()}).strict(),
  z.object({type:z.literal('progress'),source:dockIdentifierSchema,field,maximumField:field,color:dockSemanticColorSchema.optional()}).strict(),
  z.object({type:z.literal('sparkline'),source:dockIdentifierSchema,field,color:dockSemanticColorSchema.optional()}).strict(),
]));
// Inspect the raw shape iteratively before recursive parsing can consume an unbounded stack.
export const dockSummaryNodeSchema=z.unknown().transform((value,context):DockSummaryNode=>{
  const pending=[{value,depth:1}];let count=0;
  while(pending.length){
    const current=pending.pop()!;
    if(++count>DOCK_SUMMARY_LIMITS.nodes||current.depth>DOCK_SUMMARY_LIMITS.depth){context.addIssue({code:'custom',message:'Summary exceeds 64 nodes or depth 4'});return z.NEVER;}
    if(current.value&&typeof current.value==='object'&&'children' in current.value&&Array.isArray(current.value.children)){
      if(current.value.children.length>DOCK_SUMMARY_LIMITS.nodes){context.addIssue({code:'custom',message:'Summary exceeds its node budget'});return z.NEVER;}
      for(const child of current.value.children)pending.push({value:child,depth:current.depth+1});
    }
  }
  const result=tree.safeParse(value);
  if(!result.success){for(const issue of result.error.issues)context.addIssue({code:'custom',path:issue.path,message:issue.message});return z.NEVER;}
  return result.data;
});
export function summaryNodes(root:DockSummaryNode):DockSummaryNode[]{
  const nodes:DockSummaryNode[]=[],pending=[root];
  while(pending.length){const node=pending.shift()!;nodes.push(node);if('children' in node)pending.unshift(...node.children);}
  return nodes;
}
export function summaryComponentErrors(root:DockSummaryNode,size:DockSummarySize):string[]{
  const counts=new Map<string,number>();for(const node of summaryNodes(root))counts.set(node.type,(counts.get(node.type)??0)+1);
  const errors:string[]=[];
  for(const type of ['icon','label','status'])if((counts.get(type)??0)>1)errors.push(`Only one ${type} is allowed`);
  for(const type of ['primary','secondary'])if((counts.get(type)??0)>(size==='small'?1:2))errors.push(`Too many ${type} readings for ${size}`);
  if((counts.get('progress')??0)+(counts.get('sparkline')??0)>1)errors.push('Use one progress or sparkline');
  return errors;
}
