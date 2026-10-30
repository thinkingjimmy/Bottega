/**
 * [INPUT]: Depends on zod and the Dock capability declaration vocabulary.
 * [OUTPUT]: Provides strict Dock-only RPCs, bounded client sessions/readings/actions, scope identities and liveness timing.
 * [POS]: Public isolated Dock RPC boundary; composer operations never enter this scope.
 */
import {z} from 'zod';
import {dockIdentifierSchema} from './settings';
import {dockReadingStateSchema,dockTimeZoneSchema,DOCK_BASE_BUDGET,type DockReading} from './data';
import {DOCK_OPERATIONS,DOCK_RPC_BUDGET} from './session/protocol';
export {DOCK_OPERATIONS,DOCK_RPC_BUDGET,DOCK_SESSION_TIMING,type DockOperation} from './session/protocol';
export const dockOperationSchema=z.enum(DOCK_OPERATIONS);
const identity=z.string().min(1).max(160);
export const dockSessionScopeSchema=z.object({kind:z.enum(['authoring-preview','dock-detail']),definitionId:identity,generationId:identity,
  ownerKind:z.enum(['instance','authoring-draft']),ownerId:identity,accountEpoch:z.number().int().nonnegative(),revision:z.number().int().nonnegative()}).strict();
export type DockSessionScope=z.infer<typeof dockSessionScopeSchema>;
const empty=z.object({}).strict(),reference=z.string().regex(/^[a-f0-9]{32}$/);
export const dockRpcRequestSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('dock.open'),payload:empty}).strict(),
 z.object({operation:z.literal('dock.heartbeat'),payload:z.object({ready:z.boolean().optional()}).strict()}).strict(),
 z.object({operation:z.literal('dock.data.read'),payload:z.object({sources:z.array(dockIdentifierSchema).max(32).optional()}).strict()}).strict(),
 z.object({operation:z.literal('dock.action'),payload:z.object({ref:reference}).strict()}).strict(),
 z.object({operation:z.literal('dock.close'),payload:empty}).strict(),
]);
export type DockRpcRequest=z.infer<typeof dockRpcRequestSchema>;
export function parseDockRpcRequest(serialized:string):DockRpcRequest{
 if(typeof serialized!=='string'||serialized.length>DOCK_RPC_BUDGET.inputBytes||new TextEncoder().encode(serialized).byteLength>DOCK_RPC_BUDGET.inputBytes)throw new Error('DOCK_RPC_BUDGET');
 return dockRpcRequestSchema.parse(JSON.parse(serialized));
}
const settings=z.record(dockIdentifierSchema,z.union([z.string().max(500),z.number().finite(),z.boolean()])).refine(value=>Object.keys(value).length<=32);
export const dockClientSessionSchema=z.object({sessionId:reference,scope:dockSessionScopeSchema,name:z.string().min(1).max(160),settings,
 locale:z.string().min(1).max(32),theme:z.enum(['light','dark']),operations:z.array(dockOperationSchema).min(2).max(5)}).strict();
export type DockClientSession=z.infer<typeof dockClientSessionSchema>;
const scalar=z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()]);
const series=z.object({from:z.number().finite(),to:z.number().finite(),timeZone:dockTimeZoneSchema,points:z.array(z.object({at:z.number().finite(),value:z.number().finite().nullable()}).strict()).max(64)}).strict().refine(value=>value.from<value.to&&value.points.every((point,index)=>point.at>=value.from&&point.at<value.to&&(index===0||point.at>value.points[index-1]!.at)),'History points must be ordered within their half-open range');
const records=z.array(z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),values:z.record(dockIdentifierSchema,scalar).refine(value=>Object.keys(value).length<=DOCK_BASE_BUDGET.baseFieldCount)}).strict()).max(DOCK_BASE_BUDGET.baseDetailRows).refine(value=>new Set(value.map(row=>row.id)).size===value.length);
const groups=z.array(z.object({key:scalar,count:z.number().int().nonnegative()}).strict()).max(DOCK_BASE_BUDGET.baseGroupCount).refine(value=>new Set(value.map(group=>JSON.stringify(group.key))).size===value.length);
const columns=z.array(z.object({id:dockIdentifierSchema,label:z.string().min(1).max(200),type:z.enum(['text','number','date','select','checkbox','url'])}).strict()).max(DOCK_BASE_BUDGET.baseFieldCount).refine(value=>new Set(value.map(column=>column.id)).size===value.length);
const reading=z.object({state:dockReadingStateSchema,updatedAt:z.number().finite().nullable(),values:z.record(z.string().regex(/^[a-z][A-Za-z0-9-]{0,63}$/),z.union([scalar,series])),records:records.optional(),columns:columns.optional(),groups:groups.optional(),failure:z.object({code:z.enum(['network','timeout','proxy-required','http','mapping','budget','authorization','unknown-result']),status:z.number().int().min(100).max(599).optional(),retryAt:z.number().finite().optional(),sent:z.boolean().optional()}).strict().optional()}).strict();
export const dockActionSchema=z.object({ref:reference,kind:z.enum(['refresh','open-base','open-task','open-usage']),label:z.string().min(1).max(160)}).strict();
export type DockAction=z.infer<typeof dockActionSchema>;
export const dockDataSnapshotSchema=z.object({readings:z.record(dockIdentifierSchema,reading).refine(value=>Object.keys(value).length<=32),actions:z.array(dockActionSchema).max(64)}).strict();
export type DockDataSnapshot=Readonly<{readings:Readonly<Record<string,DockReading>>;actions:readonly DockAction[]}>;
export function validateDockDataSnapshot(value:unknown):DockDataSnapshot{
 const result=dockDataSnapshotSchema.parse(value);if(new TextEncoder().encode(JSON.stringify(result)).byteLength>DOCK_RPC_BUDGET.outputBytes)throw new Error('DOCK_RPC_OUTPUT_BUDGET');return result;
}
