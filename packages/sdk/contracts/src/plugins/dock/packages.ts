/**
 * [INPUT]: Depends on strict schemas and the shared canonical JSON digest rule.
 * [OUTPUT]: Provides the precompiled Widget package descriptor, measured local budgets, canonical reference and exact file-role admission including fixed root document mirrors.
 * [POS]: Public immutable package identity; source authentication, installation confirmation and data grants belong to the host.
 */
import {z} from 'zod';
import {hashCanonical} from '../../core/canonical-json';
export const WIDGET_PACKAGE_BUDGET=Object.freeze({packageBytes:32*1024*1024,runtimeFileBytes:4*1024*1024,sourceFileBytes:512*1024,files:256,pathDepth:6,sourceBytes:4*1024*1024,concurrentInstalls:1,archiveMs:15000,downloadMs:60000,verifyMs:5000,registerMs:2000,retries:2,retainedBytes:256*1024*1024,retainedPackages:32});
const digest=z.string().regex(/^sha256:[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,127}$/);
export const widgetPackageSourceSchema=z.object({accountId:z.string().min(1).max(256).regex(/^[^\p{Cc}]+$/u),installationId:id,definitionId:id,generationId:id}).strict();
export const widgetPackageDigestsSchema=z.object({manifestDigest:digest,sourcePackageDigest:digest,contentDigest:digest,buildReceiptDigest:digest}).strict();
export const widgetPackageFileSchema=z.object({role:z.enum(['runtime','source','metadata']),path:z.string().min(1).max(512),type:z.literal('file'),bytes:z.number().int().nonnegative(),sha256:digest}).strict();
export const widgetPackageDescriptorSchema=z.object({format:z.literal('precompiled-widget/v1'),schemaVersion:z.literal(1),sdkVersion:z.literal(1),source:widgetPackageSourceSchema,digests:widgetPackageDigestsSchema,contractDigest:digest,files:z.array(widgetPackageFileSchema).min(1).max(WIDGET_PACKAGE_BUDGET.files)}).strict();
export type WidgetPackageSource=z.infer<typeof widgetPackageSourceSchema>;
export type WidgetPackageDescriptor=z.infer<typeof widgetPackageDescriptorSchema>;
export type WidgetPackageFile=z.infer<typeof widgetPackageFileSchema>;
export function widgetPackagePathAllowed(path:string,role:WidgetPackageFile['role']){
 if(path!==path.normalize('NFC')||path.split('/').length>WIDGET_PACKAGE_BUDGET.pathDepth||!/^[A-Za-z0-9_./-]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))return false;
 if(role==='metadata')return path==='metadata/gui-build-receipt.json';
 if(role==='runtime')return path==='runtime/plugin.json'||path==='runtime/README.md'||path==='runtime/SKILL.md'||/^runtime\/gui\/(?:index\.html|assets\/[A-Za-z0-9_./-]+)$/.test(path);
 return path==='source/plugin.json'||path==='source/README.md'||path==='source/SKILL.md'||/^source\/gui\/[A-Za-z0-9_./-]+$/.test(path);
}
export function validateWidgetPackageDescriptor(input:unknown):WidgetPackageDescriptor{
 const descriptor=widgetPackageDescriptorSchema.parse(input),paths=new Set<string>();let sourceBytes=0,totalBytes=0;
 for(const file of descriptor.files){
  if(!widgetPackagePathAllowed(file.path,file.role)||paths.has(file.path.toLowerCase()))throw new Error('WIDGET_PACKAGE_PATH_INVALID');paths.add(file.path.toLowerCase());
  if(file.bytes>(file.role==='source'?WIDGET_PACKAGE_BUDGET.sourceFileBytes:WIDGET_PACKAGE_BUDGET.runtimeFileBytes))throw new Error('WIDGET_PACKAGE_FILE_BUDGET');
  if(file.role==='source')sourceBytes+=file.bytes;totalBytes+=file.bytes;
 }
 if(sourceBytes>WIDGET_PACKAGE_BUDGET.sourceBytes||totalBytes>WIDGET_PACKAGE_BUDGET.packageBytes)throw new Error('WIDGET_PACKAGE_CONTENT_BUDGET');
 return{...descriptor,files:descriptor.files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
}
export const widgetPackageReference=(descriptor:unknown)=>`sha256:${hashCanonical(validateWidgetPackageDescriptor(descriptor))}` as const;
