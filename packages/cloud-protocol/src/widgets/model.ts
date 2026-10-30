/**
 * [INPUT]: Depends on frozen Widget package limits, strict file descriptors and canonical full-source hashing.
 * [OUTPUT]: Provides Widget package subjects, immutable encrypted transfer plans, authenticated ready deliveries and terminal revocation receipts.
 * [POS]: Private account delivery contract; transfer identity grants no local execution, writable source or data authority.
 */
import {z} from 'zod';
import {hashCanonical,canonicalJson} from '@bottega/contracts/core/canonical-json';
import {WIDGET_PACKAGE_BUDGET,widgetPackageSourceSchema} from '@bottega/contracts/plugins/dock/packages';
import {cloudIdSchema} from '../auth';
import {MAX_BLOB_BYTES} from '../config';
import {sha256Schema} from '../blobs';
import {ciphertextFileDescriptorSchema,encryptedFileDescriptorSchema} from '../blobs/encrypted/model';

export const widgetPackageSubjectSchema=z.object({definitionId:widgetPackageSourceSchema.shape.definitionId,sourceInstallationId:cloudIdSchema}).strict();
export type WidgetPackageSubject=z.infer<typeof widgetPackageSubjectSchema>;
export const widgetPackageRefSchema=z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const widgetPackageOwnerId=(input:WidgetPackageSubject)=>hashCanonical(['dock-widget',widgetPackageSubjectSchema.parse(input)]);
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity={subject:widgetPackageSubjectSchema,reference:widgetPackageRefSchema};
const file=ciphertextFileDescriptorSchema.refine(value=>value.bytes<=MAX_BLOB_BYTES,'Widget ciphertext exceeds the private-file limit');
const packageFields={...identity,generationId:widgetPackageSourceSchema.shape.generationId,contractDigest:widgetPackageRefSchema,
 archiveBytes:integer.positive().max(WIDGET_PACKAGE_BUDGET.packageBytes),reviewBytes:integer.positive().max(WIDGET_PACKAGE_BUDGET.runtimeFileBytes),
 archiveSha256:sha256Schema,reviewSha256:sha256Schema};
type FileIdentity={blobId:string;encryption:{domain?:string;owner:{kind:string;id:string};ownerGeneration:string|null;encryptedSpace:unknown}};
function checkFiles(value:{subject:WidgetPackageSubject;reference:string;archive:FileIdentity;review:FileIdentity},context:z.RefinementCtx){
 const ownerId=widgetPackageOwnerId(value.subject);
 for(const key of ['archive','review']as const){const encrypted=value[key].encryption;
  if(encrypted.domain!==undefined||encrypted.owner.kind!=='widget'||encrypted.owner.id!==ownerId||encrypted.ownerGeneration!==value.reference)context.addIssue({code:'custom',path:[key],message:'Widget file source/reference mismatch'});
 }
 if(value.archive.blobId===value.review.blobId||canonicalJson(value.archive.encryption.encryptedSpace)!==canonicalJson(value.review.encryption.encryptedSpace))context.addIssue({code:'custom',message:'Widget files require separate identities in one encrypted space'});
}
export const widgetPackagePlanSchema=z.object({...packageFields,archive:file,review:file}).strict().superRefine(checkFiles);
export type WidgetPackagePlan=z.infer<typeof widgetPackagePlanSchema>;
export const widgetPackageDeliverySchema=z.object({...packageFields,state:z.literal('published'),accountId:z.string().min(1).max(256),revision:integer.positive(),updatedAt:integer,
 archive:encryptedFileDescriptorSchema,review:encryptedFileDescriptorSchema}).strict().superRefine((value,context)=>{
 checkFiles(value,context);
 for(const key of ['archive','review']as const)if(value[key].bytes!==value[`${key}Bytes`]||value[key].sha256!==value[`${key}Sha256`]||value[key].mime!=='application/json'||value[key].encryption.bytes>MAX_BLOB_BYTES)context.addIssue({code:'custom',path:[key],message:'Widget plaintext/ciphertext descriptor mismatch'});
});
export type WidgetPackageDelivery=z.infer<typeof widgetPackageDeliverySchema>;
export const widgetDefinitionReceiptSchema=z.object({state:z.literal('revoked'),accountId:z.string().min(1).max(256),subject:widgetPackageSubjectSchema,revision:integer.positive(),updatedAt:integer}).strict();
export const widgetPackagePendingSchema=z.object({...identity,state:z.literal('pending'),accountId:z.string().min(1).max(256),revision:integer,updatedAt:integer}).strict();
export const widgetPackageResultSchema=z.union([widgetPackageDeliverySchema,widgetDefinitionReceiptSchema,widgetPackagePendingSchema]).nullable();
export function assertWidgetPackageDelivery(value:unknown,expected:{accountId:string;subject:WidgetPackageSubject;reference:string}):WidgetPackageDelivery{
 const delivery=widgetPackageDeliverySchema.parse(value);
 if(delivery.accountId!==expected.accountId||delivery.reference!==expected.reference||canonicalJson(delivery.subject)!==canonicalJson(widgetPackageSubjectSchema.parse(expected.subject)))throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
 return delivery;
}
