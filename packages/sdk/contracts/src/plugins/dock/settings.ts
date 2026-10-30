/**
 * [INPUT]: Depends on zod for strict non-secret settings and Unicode text validation.
 * [OUTPUT]: Provides Dock setting schemas, Widget names and deterministic duplicate-name allocation.
 * [POS]: Public Dock declaration leaf; credentials and authorization never enter portable settings.
 */
import {z} from 'zod';

export const dockIdentifierSchema=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const widgetNameSchema=z.string().refine(value=>!/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value),'Names cannot contain line breaks or control characters')
  .transform(value=>value.normalize('NFC').trim())
  .refine(value=>[...value].length>=1&&[...value].length<=80,'Names must contain 1–80 Unicode code points');
const label=z.string().min(1).max(80);
const date=z.string().max(64).refine(value=>/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value)),'Use an explicit date, time and offset');
export const dockSettingSchema=z.discriminatedUnion('type',[
  z.object({id:dockIdentifierSchema,type:z.literal('text'),label,default:z.string().max(500),required:z.boolean().optional()}).strict(),
  z.object({id:dockIdentifierSchema,type:z.literal('number'),label,default:z.number().finite(),minimum:z.number().finite(),maximum:z.number().finite()}).strict(),
  z.object({id:dockIdentifierSchema,type:z.literal('toggle'),label,default:z.boolean()}).strict(),
  z.object({id:dockIdentifierSchema,type:z.literal('date'),label,default:date}).strict(),
  z.object({id:dockIdentifierSchema,type:z.literal('select'),label,default:z.string().max(120),options:z.array(z.object({value:z.string().min(1).max(120),label}).strict()).min(1).max(32)}).strict(),
]);
export type DockSetting=z.infer<typeof dockSettingSchema>;
export type DockSettings=Readonly<Record<string,string|number|boolean>>;
export function validateDockSettings(fields:readonly DockSetting[],settings:DockSettings):string[]{
  const errors:string[]=[],ids=new Set(fields.map(field=>field.id));
  for(const key of Object.keys(settings))if(!ids.has(key))errors.push(key);
  for(const field of fields){
    const value=settings[field.id];
    if(field.type==='number'){
      if(typeof value!=='number'||!Number.isFinite(value)||value<field.minimum||value>field.maximum)errors.push(field.id);
    }else if(field.type==='toggle'){if(typeof value!=='boolean')errors.push(field.id);}
    else if(typeof value!=='string'||(field.type==='date'?!date.safeParse(value).success:field.type==='select'?!field.options.some(option=>option.value===value):value.length>500||field.required&&value.trim()===''))errors.push(field.id);
  }
  return [...new Set(errors)];
}
export const defaultDockSettings=(fields:readonly DockSetting[]):DockSettings=>Object.fromEntries(fields.map(field=>[field.id,field.default]));
export const normalizedWidgetText=(value:string)=>value.normalize('NFC').trim().toLocaleLowerCase();
export function allocateWidgetName(name:string,existing:readonly string[],locale:string):string{
  const base=widgetNameSchema.parse(name),used=new Set(existing.map(normalizedWidgetText));
  if(!used.has(normalizedWidgetText(base)))return base;
  for(let index=2;index<=existing.length+2;index++){
    const suffix=/^zh(?:-|$)/i.test(locale)?`（${index}）`:` (${index})`;
    const candidate=[...base].slice(0,80-[...suffix].length).join('')+suffix;
    if(!used.has(normalizedWidgetText(candidate)))return candidate;
  }
  throw new Error('Widget name capacity exceeded');
}
