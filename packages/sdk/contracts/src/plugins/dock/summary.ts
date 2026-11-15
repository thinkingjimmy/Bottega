/**
 * [INPUT]: Depends on zod and Dock identifier validation for host-rendered declarations.
 * [OUTPUT]: Provides bounded summary nodes, component diagnostics, fixed three-edge dimensions, typed plugin readings, the versioned detail document and the summary-method envelope.
 * [POS]: Public Dock presentation contract; never contains author code, HTML, CSS or child actions.
 */
import {z} from 'zod';
import {dockIdentifierSchema} from './settings';
import {DOCK_SUMMARY_SIZES,type DockSummarySize} from './geometry';
import {dockReadingStateSchema} from './data';
export {summaryDimensions,type DockSummarySize} from './geometry';

export const DOCK_SUMMARY_LIMITS=Object.freeze({nodes:64,depth:4,points:64,bytes:8*1024});
export const dockSizeSchema=z.enum(DOCK_SUMMARY_SIZES);
const field=z.string().regex(/^[a-z][A-Za-z0-9-]{0,63}$/);
export const dockTextFormatSchema=z.enum(['text','number','currency','percent','duration','date','degrees']);
export type DockTextFormat=z.infer<typeof dockTextFormatSchema>;
export const dockTextSchema=z.union([
  z.object({kind:z.literal('literal'),value:z.string().max(80)}).strict(),
  z.object({kind:z.literal('binding'),source:dockIdentifierSchema,field,
    format:dockTextFormatSchema.optional()}).strict(),
]);
export type DockSummaryText=z.infer<typeof dockTextSchema>;
export const dockSemanticColorSchema=z.enum(['default','muted','accent','success','warning','danger']);
type Color=z.infer<typeof dockSemanticColorSchema>;
export const dockIconNameSchema=z.enum(['clock','calendar','activity','gauge','tasks','database','chart','globe','flag','check','alert','sparkles',
  'sun','cloud-sun','cloud','fog','drizzle','rain','snow','showers','thunder']);
export type DockIconName=z.infer<typeof dockIconNameSchema>;
export type DockSummaryNode=
  | {type:'row'|'column';children:DockSummaryNode[];gap:0|2|4|6|8|10;align?:'start'|'center'|'end'}
  | {type:'label'|'secondary'|'status';text:DockSummaryText;color?:Color}
  | {type:'primary';text:DockSummaryText;color?:Color;emphasis?:'display'}
  | {type:'icon';name:DockIconName;color?:Color}
  | {type:'icon';source:string;field:string;label?:DockSummaryText}
  | {type:'columns';source:string;max:1|2|3|4;title:string;icon:string;value:string;secondary?:string;format?:DockTextFormat}
  | {type:'progress';source:string;field:string;maximumField:string;color?:Color}
  | {type:'sparkline';source:string;field:string;color?:Color};
const scalarNode=z.object({type:z.enum(['label','secondary','status']),text:dockTextSchema,color:dockSemanticColorSchema.optional()}).strict();
const gap=z.union([z.literal(0),z.literal(2),z.literal(4),z.literal(6),z.literal(8),z.literal(10)]);
const tree:z.ZodType<DockSummaryNode>=z.lazy(()=>z.union([
  z.object({type:z.literal('row'),children:z.array(tree).min(1).max(2),gap,align:z.enum(['start','center','end']).optional()}).strict(),
  z.object({type:z.literal('column'),children:z.array(tree).min(1).max(4),gap,align:z.enum(['start','center','end']).optional()}).strict(),
  scalarNode,
  z.object({type:z.literal('primary'),text:dockTextSchema,color:dockSemanticColorSchema.optional(),emphasis:z.literal('display').optional()}).strict(),
  z.object({type:z.literal('icon'),name:dockIconNameSchema,color:dockSemanticColorSchema.optional()}).strict(),
  z.object({type:z.literal('icon'),source:dockIdentifierSchema,field,label:dockTextSchema.optional()}).strict(),
  z.object({type:z.literal('columns'),source:dockIdentifierSchema,max:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]),
    title:field,icon:field,value:field,secondary:field.optional(),format:dockTextFormatSchema.optional()}).strict(),
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
  const counts=new Map<string,number>();for(const node of summaryNodes(root))counts.set(node.type==='primary'&&node.emphasis==='display'?'display':node.type,(counts.get(node.type==='primary'&&node.emphasis==='display'?'display':node.type)??0)+1);
  const errors:string[]=[];
  for(const type of ['icon','label','status'])if((counts.get(type)??0)>1)errors.push(`Only one ${type} is allowed`);
  for(const type of ['primary','secondary'])if((counts.get(type)??0)+(type==='primary'?counts.get('display')??0:0)>(size==='small'?1:2))errors.push(`Too many ${type} readings for ${size}`);
  if((counts.get('display')??0)>1)errors.push('Only one display reading is allowed');
  if((counts.get('columns')??0)>1)errors.push('Only one columns block is allowed');
  if((counts.get('progress')??0)+(counts.get('sparkline')??0)>1)errors.push('Use one progress or sparkline');
  return errors;
}
const readingScalar=z.union([z.string().max(160),z.number().finite(),z.boolean(),z.null()]);
const readingValues=(limit:number)=>z.record(field,readingScalar).refine(value=>Object.keys(value).length<=limit,`Reading values exceed ${limit} fields`);
export const dockSummaryReadingsSchema=z.record(dockIdentifierSchema,z.object({
  state:dockReadingStateSchema,updatedAt:z.number().finite().nullable(),values:readingValues(32),
  records:z.array(z.object({id:z.string().min(1).max(64),values:readingValues(12)}).strict()).max(10).optional(),
}).strict()).refine(value=>Object.keys(value).length<=8,'Readings exceed eight sources');
export type DockSummaryReadings=z.infer<typeof dockSummaryReadingsSchema>;
const documentBackdrop=z.enum(['default','clear','cloudy','rain','snow','storm','fog']);
export type DockDocumentBackdrop=z.infer<typeof documentBackdrop>;
export const dockDetailDocumentSchema=z.object({
  version:z.literal(2),
  backdrop:z.union([documentBackdrop,z.object({source:dockIdentifierSchema,field}).strict()]).optional(),
  hero:z.object({title:dockTextSchema,value:dockTextSchema,caption:dockTextSchema.optional(),high:dockTextSchema.optional(),low:dockTextSchema.optional()}).strict(),
  rows:z.object({source:dockIdentifierSchema,max:z.number().int().min(1).max(10),title:field,icon:field,low:field,high:field,format:dockTextFormatSchema.optional()}).strict().optional(),
  tiles:z.array(z.object({label:dockTextSchema,value:dockTextSchema}).strict()).min(1).max(4).optional(),
  attribution:z.object({label:z.string().max(160),url:z.string().url().refine(value=>value.startsWith('https://'),'Attribution requires an https URL')}).strict().optional(),
}).strict();
export type DockDetailDocument=z.infer<typeof dockDetailDocumentSchema>;
const summaryLayouts=z.object({small:dockSummaryNodeSchema.optional(),medium:dockSummaryNodeSchema.optional(),large:dockSummaryNodeSchema.optional()}).strict();
export type DockSummaryLayouts=z.infer<typeof summaryLayouts>;
export const dockSummaryEnvelopeSchema=z.union([
  dockSummaryNodeSchema,
  z.object({summary:z.union([dockSummaryNodeSchema,summaryLayouts]),readings:dockSummaryReadingsSchema.optional(),document:dockDetailDocumentSchema.optional(),detail:z.unknown().optional()}).strict(),
]);
export type DockSummaryEnvelope=z.infer<typeof dockSummaryEnvelopeSchema>;
