/**
 * [INPUT]: Depends on public Dock names/settings/sizes, measured Base budgets and portable Base owner-key grammar.
 * [OUTPUT]: Provides strict immutable definition references, non-secret custom instance settings and declarative semantic Base bindings.
 * [POS]: Portable Dock instance branch; local acceptance, pause, credentials and grants must never enter this schema.
 */
import {z} from 'zod';
import {BASE_OWNER_KEY_PATTERN} from '@bottega/contracts/core/owner-key';
import {dockIdentifierSchema} from '@bottega/contracts/plugins/dock/settings';
import {dockSizeSchema} from '@bottega/contracts/plugins/dock/summary';
import {DOCK_BASE_BUDGET,dockTimeZoneSchema} from '@bottega/contracts/plugins/dock/data';
const entity=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),definition=z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scalar=z.union([z.string().max(500),z.number().finite(),z.boolean()]);
export const dockInstanceSettingsSchema=z.record(dockIdentifierSchema,scalar).refine(value=>Object.keys(value).length<=32,'Setting budget exceeded');
export const dockBaseFilterSchema=z.object({field:dockIdentifierSchema,op:z.enum(['equals','not-equals','less-than','greater-than','on-day']),value:scalar.nullable(),timeZone:dockTimeZoneSchema.optional()}).strict();
export const dockBaseBindingSchema=z.object({slot:dockIdentifierSchema,ownerKey:z.string().regex(BASE_OWNER_KEY_PATTERN),ownerInstanceId:entity,
 fields:z.record(dockIdentifierSchema,entity).refine(value=>Object.keys(value).length<=DOCK_BASE_BUDGET.baseFieldCount,'Base field budget exceeded'),filter:z.array(dockBaseFilterSchema).max(8)}).strict().superRefine((value,context)=>{
 for(const [index,filter]of value.filter.entries()){
  if(!Object.hasOwn(value.fields,filter.field))context.addIssue({code:'custom',path:['filter',index,'field'],message:'Filter field must be selected'});
  if(filter.op==='on-day'&&(!filter.timeZone||typeof filter.value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(filter.value)))context.addIssue({code:'custom',path:['filter',index],message:'Day filters require a calendar date and time zone'});
 }
});
export const widgetDefinitionReferenceSchema=z.object({sourceInstallationId:entity,definitionId:definition,generationId:z.string().regex(/^plugin-[a-f0-9-]{36}$/),packageRef:digest,contractDigest:digest}).strict();
export const customDockWidgetSchema=z.object({type:z.literal('custom'),configVersion:z.literal(1),definition:widgetDefinitionReferenceSchema,size:dockSizeSchema,
 settings:dockInstanceSettingsSchema,bindings:z.array(dockBaseBindingSchema).max(DOCK_BASE_BUDGET.baseBindingCount)}).strict().superRefine((value,context)=>{
 if(new Set(value.bindings.map(binding=>binding.slot)).size!==value.bindings.length)context.addIssue({code:'custom',path:['bindings'],message:'Duplicate Base binding'});
 if(value.bindings.reduce((count,binding)=>count+Object.keys(binding.fields).length,0)>DOCK_BASE_BUDGET.baseFieldCount)context.addIssue({code:'custom',path:['bindings'],message:'Base field budget exceeded'});
});
export type CustomDockWidget=z.infer<typeof customDockWidgetSchema>;
export type DockBaseBinding=z.infer<typeof dockBaseBindingSchema>;
