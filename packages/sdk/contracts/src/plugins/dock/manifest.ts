/**
 * [INPUT]: Depends on bounded summaries, typed settings and declarative data requirements.
 * [OUTPUT]: Provides strict Dock contributions with exact layout coverage and semantic reference validation.
 * [POS]: Public Dock manifest branch; source, frozen snapshot and runtime admission share this validator.
 */
import {z} from 'zod';
import {dockSummaryNodeSchema,dockSizeSchema,summaryComponentErrors,type DockSummaryNode} from './summary';
import {dockSettingSchema,validateDockSettings,defaultDockSettings} from './settings';
import {dockDataRequirementSchema,dockDataFields,DOCK_BASE_BUDGET} from './data';
import {DOCK_API_BUDGET} from './api/index';

const layout=z.object({bottom:dockSummaryNodeSchema,left:dockSummaryNodeSchema,right:dockSummaryNodeSchema}).strict();
export const dockContributionSchema=z.object({
  schemaVersion:z.literal(1),sizes:z.array(dockSizeSchema).min(1).max(3),
  summaries:z.object({small:layout.optional(),medium:layout.optional(),large:layout.optional()}).strict(),
  settings:z.array(dockSettingSchema).max(32),data:z.array(dockDataRequirementSchema).max(32),
  detail:z.discriminatedUnion('kind',[z.object({kind:z.literal('standard')}).strict(),z.object({kind:z.literal('surface')}).strict()]),
  refresh:z.object({mode:z.enum(['visible','manual'])}).strict(),
}).strict().superRefine((value,context)=>{
  const add=(path:(string|number)[],message:string)=>context.addIssue({code:'custom',path,message});
  for(const key of ['sizes','settings','data']as const){const ids=value[key].map(item=>typeof item==='string'?item:item.id);if(new Set(ids).size!==ids.length)add([key],'Duplicate declaration identity');}
  for(const key of validateDockSettings(value.settings,defaultDockSettings(value.settings)))add(['settings',key],'Invalid default value');
  const settings=new Map(value.settings.map(field=>[field.id,field]));
  const sources=new Map(value.data.map(source=>[source.id,source]));
  const bases=value.data.filter(source=>source.kind==='base');
  if(value.data.filter(source=>source.kind==='api').length>DOCK_API_BUDGET.apiDeclarationCount)add(['data'],'API declaration budget exceeded');
  if(new Set(bases.map(source=>source.binding)).size>DOCK_BASE_BUDGET.baseBindingCount)add(['data'],'Base binding budget exceeded');
  if(new Set(bases.flatMap(source=>[source.field,source.timeField].filter(Boolean).map(field=>source.binding+'/'+field))).size>DOCK_BASE_BUDGET.baseFieldCount)add(['data'],'Base field budget exceeded');
  for(const source of value.data){
    for(const key of ['backendSetting','sourceSetting','deadlineSetting','fromSetting','toSetting']as const)if(key in source){
      const ref=(source as unknown as Record<string,string>)[key],field=ref?settings.get(ref):undefined;
      if(ref&&(!field||(['deadlineSetting','fromSetting','toSetting'].includes(key)?field.type!=='date':field.type!=='select')))add(['data',source.id,key],'Data reference must name a compatible setting');
    }
    if(source.kind==='api'){
      const {request,response,authentication}=source;
      if(request.method==='POST'&&request.semantics!=='read-only-query')add(['data',source.id,'request'],'POST requires explicit read-only query semantics');
      if(request.method!=='POST'&&(request.body||request.semantics))add(['data',source.id,'request'],'Only POST accepts a query body');
      if((request.method==='HEAD')!==(response.kind==='head'))add(['data',source.id,'response'],'HEAD uses only selected response metadata');
      const forbidden=/^(?:host|cookie|cookie2|authorization|proxy-authorization|proxy-authenticate|connection|content-length|transfer-encoding|upgrade|te|trailer|expect|accept-encoding|content-type)$/i;
      for(const name of Object.keys(request.headers??{}))if(forbidden.test(name))add(['data',source.id,'request','headers',name],'Transport and authentication headers are host-owned');
      for(const parameter of [...Object.values(request.query),...Object.values(request.pathParameters??{}),...Object.values(request.headers??{}),...Object.values(request.body??{})])if('setting'in parameter&&!settings.has(parameter.setting))add(['data',source.id,'request'],'API parameters must reference declared settings');
      const placeholders=[...request.path.matchAll(/\{([a-z][A-Za-z0-9_-]*)\}/g)].map(match=>match[1]!);
      if(placeholders.some(name=>!Object.hasOwn(request.pathParameters??{},name))||Object.keys(request.pathParameters??{}).some(name=>!placeholders.includes(name)))add(['data',source.id,'request','path'],'Path parameters must match the declared placeholders');
      if(/[{}]/.test(request.path.replace(/\{([a-z][A-Za-z0-9_-]*)\}/g,'')))add(['data',source.id,'request','path'],'Invalid path template');
      if(authentication.kind==='api-key'){
        if(/[\r\n]/.test(authentication.prefix??''))add(['data',source.id,'authentication'],'Invalid credential prefix');
        const fields=authentication.location==='query'?request.query:request.headers??{};
        if(Object.keys(fields).some(name=>name.toLowerCase()===authentication.name.toLowerCase()))add(['data',source.id,'authentication'],'Credential placement conflicts with a non-secret parameter');
        if(authentication.location==='header'&&/^(?:host|cookie|cookie2|proxy-authorization|connection|content-length|transfer-encoding|upgrade)$/i.test(authentication.name))add(['data',source.id,'authentication'],'Invalid credential header');
      }
      if(response.kind==='json'){
        const ids=[...response.fields.map(field=>field.id),...(response.series?[response.series.id]:[])];
        if(!ids.length&&!response.records)add(['data',source.id,'response'],'Declare at least one output');
        if(new Set(ids).size!==ids.length)add(['data',source.id,'response'],'Duplicate API output field');
        if(response.records&&new Set(response.records.columns.map(field=>field.id)).size!==response.records.columns.length)add(['data',source.id,'response'],'Duplicate API record column');
        for(const field of [...response.fields,...(response.records?.columns??[])])if(field.lookup&&field.type!=='text'||field.timeFormat&&field.type!=='date')add(['data',source.id,'response',field.id],'Mapping conversion does not match the output type');
        if(response.series){try{new Intl.DateTimeFormat('en',{timeZone:response.series.timeZone});}catch{add(['data',source.id,'response','series'],'Unknown time zone');}}
      }else if(new Set(response.fields).size!==response.fields.length)add(['data',source.id,'response'],'Duplicate HEAD field');
    }
    if(source.kind==='base'){
      if(['sum','group'].includes(source.operation)&&!source.field)add(['data',source.id,'field'],'This operation requires a field');
      if(source.operation==='history'){
        if(!source.timeField||!source.timeZone||!source.bucket||!source.missingBuckets||!source.fromSetting||!source.toSetting||!source.reduction)add(['data',source.id],'History requires a field, zone, bucket, declared range and reduction');
        if(source.missingBuckets==='zero-count'&&source.field)add(['data',source.id,'missingBuckets'],'Only count history can fill confirmed empty buckets with zero');
        if(!source.field&&source.reduction==='mean')add(['data',source.id,'reduction'],'Count history uses sum reduction');
      }
      if(source.operation!=='history'&&(source.timeField||source.bucket||source.missingBuckets||source.fromSetting||source.toSetting||source.reduction))add(['data',source.id],'Only history accepts time-series declarations');
    }
  }
  for(const size of ['small','medium','large']as const){
    const layouts=value.summaries[size];
    if(value.sizes.includes(size)!==Boolean(layouts)){add(['summaries',size],'Declare layouts for exactly the supported sizes');continue;}
    if(!layouts)continue;
    for(const edge of ['bottom','left','right']as const){
      const path=['summaries',size,edge];
      for(const error of summaryComponentErrors(layouts[edge],size))add(path,error);
      const pending:Array<{node:DockSummaryNode;path:(string|number)[]}>= [{node:layouts[edge],path}];
      while(pending.length){
        const {node,path:nodePath}=pending.shift()!;
        if('children'in node){node.children.forEach((child,index)=>pending.push({node:child,path:[...nodePath,'children',index]}));continue;}
        const binding='text' in node&&node.text.kind==='binding'?node.text:'source' in node?node:null;
        if(!binding)continue;
        const source=sources.get(binding.source);
        const bindingPath='text'in node?[...nodePath,'text']:nodePath;
        if(!source){add([...bindingPath,'source'],'Summary references an undeclared data source');continue;}
        const fields=dockDataFields(source),type=Object.hasOwn(fields,binding.field)?fields[binding.field]:undefined;
        if(!type){add([...bindingPath,'field'],'This source does not declare the reading field');continue;}
        if(node.type==='sparkline'){if(type!=='series')add([...nodePath,'field'],'This field does not provide an authorized history series');continue;}
        if(node.type==='progress'){
          if(type!=='number'||!Object.hasOwn(fields,node.maximumField)||fields[node.maximumField]!=='number')add(nodePath,'Progress requires two declared numeric fields');continue;
        }
        if(type==='series')add([...bindingPath,'field'],'A history series requires a sparkline');
        if('format'in binding&&binding.format&&binding.format!=='text'&&((type==='text'||type==='boolean')||(binding.format==='date'?type!=='date':type!=='number')))add([...bindingPath,'format'],'The format is incompatible with this reading field');
      }
    }
  }
});
export type DockContribution=z.infer<typeof dockContributionSchema>;
