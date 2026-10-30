/**
 * [INPUT]: Depends on Zod and canonical JSON for exact Main-owned API identities.
 * [OUTPUT]: Provides bounded local API owner, grant, encrypted slot and association ledger schemas.
 * [POS]: Private durable API state contract; no owner key, receipt or ciphertext enters portable Widget settings.
 */
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';

const identity=z.string().min(1).max(256);
export const apiOwnerSchema=z.object({accountId:identity,executionInstallationId:identity,definitionId:identity,
 ownerKind:z.enum(['instance','authoring-draft']),ownerId:identity}).strict();
export type ApiOwner=z.infer<typeof apiOwnerSchema>;
export const apiSlotSchema=z.object({owner:apiOwnerSchema,slotId:identity,revision:z.number().int().positive(),cipher:z.string().max(32768).nullable()}).strict();
export type ApiSlot=z.infer<typeof apiSlotSchema>;
export const apiGrantSchema=z.object({owner:apiOwnerSchema,requestId:identity,scopeDigest:identity,packageRef:identity,revision:z.number().int().positive(),
 approvedAt:z.number().finite().nonnegative(),revoked:z.boolean(),slotIds:z.array(identity).max(32),credentialRevision:z.string().max(1024),
 suspension:z.enum(['auth','post']).nullable(),notBefore:z.number().finite().nonnegative()}).strict();
export type ApiGrant=z.infer<typeof apiGrantSchema>;
export const apiAssociationSchema=z.object({operationId:identity,draft:apiOwnerSchema,target:apiOwnerSchema,identity:identity,
 phase:z.enum(['prepared','committed','cancelled']),acknowledged:z.boolean().default(false),draftRevision:z.string().max(256),targetRevision:z.string().max(256),slots:z.array(apiSlotSchema).max(32),grants:z.array(apiGrantSchema).max(32)}).strict();
export const apiStateSchema=z.object({version:z.literal(1),slots:z.array(apiSlotSchema).max(512),grants:z.array(apiGrantSchema).max(1024),
 associations:z.array(apiAssociationSchema).max(128)}).strict().superRefine((value,context)=>{
 for(const [name,keys]of [['slots',value.slots.map(slot=>ownerKey(slot.owner)+'/'+slot.slotId)],['grants',value.grants.map(grant=>ownerKey(grant.owner)+'/'+grant.requestId)],['associations',value.associations.map(item=>item.operationId)]]as const)
  if(new Set(keys).size!==keys.length)context.addIssue({code:'custom',path:[name],message:'Duplicate API state identity'});
});
export type ApiState=z.infer<typeof apiStateSchema>;
export const digest=(value:unknown)=>'sha256:'+createHash('sha256').update(canonicalJson(value)).digest('hex');
export const ownerKey=(owner:ApiOwner)=>digest(apiOwnerSchema.parse(owner));
export const sameOwner=(left:ApiOwner,right:ApiOwner)=>ownerKey(left)===ownerKey(right);
