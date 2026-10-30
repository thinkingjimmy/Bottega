/**
 * [INPUT]: Depends on measured public package contracts, the compiled-v3 verifier and exact plugin source inventory.
 * [OUTPUT]: Provides immutable precompiled Widget freezing and side-effect-free byte/source admission without invoking a compiler.
 * [POS]: Private package codec; expected source identity must come from a main-owned authenticated delivery record.
 */
import {lstat,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {canonicalJson,hashCanonical} from '@bottega/contracts/core/canonical-json';
import {parseStrictJson} from '@bottega/contracts/core/canonical';
import {WIDGET_PACKAGE_BUDGET as BUDGET,widgetPackageSourceSchema as sourceSchema,widgetPackageDescriptorSchema as descriptorSchema,validateWidgetPackageDescriptor as validateDescriptor,widgetPackageReference as packageReference,widgetPackagePathAllowed as pathAllowed,type WidgetPackageSource,type WidgetPackageFile} from '@bottega/contracts/plugins/dock/packages';
import {verifyCompiledV3Artifact,verifyCompiledV3Inventory,type CompiledV3DigestSet} from '../../../apps/gui-build/pipeline/seal';
import {inspectPluginSource} from '../../../apps/gui-build/source/inspection';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import {sha256} from '../../../apps/support';
import type {AppGuiBuildReceipt} from '../../../../../shared/ipc/apps/apps-ipc';
export {BUDGET,validateDescriptor,packageReference};
const compare=(a:{path:string},b:{path:string})=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path));
export async function freezePackage(root:string,rawSource:WidgetPackageSource,digests:CompiledV3DigestSet){
 const source=sourceSchema.parse(rawSource);await verifyCompiledV3Artifact(root,digests);
 const inventory=await inspectPluginSource(join(root,'source')),sourceFiles=new Set(inventory.files.map(file=>'source/'+file.path));
 const manifest=dockPluginManifestSchema.parse(JSON.parse(await readFile(join(root,'runtime/plugin.json'),'utf8')));
 if(manifest.id!==source.definitionId)throw new Error('Package definition identity changed');
 const files:Array<WidgetPackageFile&{content:string}>=[];
 const visit=async(directory:string,prefix:string)=>{
  const entries=await readdir(directory,{withFileTypes:true});
  for(const entry of entries){
   const path=prefix?prefix+'/'+entry.name:entry.name,absolute=join(directory,entry.name),info=await lstat(absolute);
   if(info.isSymbolicLink())throw new Error('Package cannot contain a symbolic link');
   if(info.isDirectory()){if(path.split('/').length>=BUDGET.pathDepth)throw new Error('Package directory depth exceeded');await visit(absolute,path);continue;}
   const role=path.split('/')[0] as 'runtime'|'source'|'metadata';
   if(!info.isFile()||info.nlink!==1||(info.mode&0o111)!==0||!pathAllowed(path,role)||role==='source'&&!sourceFiles.has(path))throw new Error('Package contains an unlisted or invalid file');
   if(files.length>=BUDGET.files||info.size>(role==='source'?BUDGET.sourceFileBytes:BUDGET.runtimeFileBytes))throw new Error('Package file budget exceeded');
   const bytes=await readFile(absolute);if(bytes.length!==info.size)throw new Error('Package file changed');
   files.push({role,path,type:'file',bytes:bytes.length,sha256:sha256(bytes),content:bytes.toString('base64')});
  }
 };
 await visit(root,'');files.sort(compare);
 const descriptor=validateDescriptor({format:'precompiled-widget/v1',schemaVersion:1,sdkVersion:1,source,digests,contractDigest:`sha256:${hashCanonical({dock:manifest.dock,operations:manifest.operations})}`,files:files.map(({content:_content,...file})=>file)});
 const bytes=Buffer.from(canonicalJson({descriptor,files:files.map(({path,content})=>({path,content}))}));
 if(bytes.length>BUDGET.packageBytes)throw new Error('Encoded package exceeds its budget');
 const reference=packageReference(descriptor);verifyPackage(bytes,reference,source);return{descriptor,reference,bytes};
}
export function verifyPackage(bytes:Buffer,reference:string,expectedSource:WidgetPackageSource){
 if(bytes.length>BUDGET.packageBytes)throw new Error('Encoded package exceeds its budget');
 const parsed=parseStrictJson(bytes,{maxBytes:BUDGET.packageBytes,maxDepth:16,maxNodes:100000});
 const envelope=z.object({descriptor:descriptorSchema,files:z.array(z.object({path:z.string(),content:z.string()}).strict()).max(BUDGET.files)}).strict().parse(parsed);
 const descriptor=validateDescriptor(envelope.descriptor);
 if(reference!==packageReference(descriptor)||canonicalJson(descriptor.source)!==canonicalJson(sourceSchema.parse(expectedSource)))throw new Error('Untrusted package source or content identity');
 if(envelope.files.length!==descriptor.files.length)throw new Error('Package file list changed');
 const decoded=new Map<string,Buffer>();
 for(const [index,file]of descriptor.files.entries()){
  const entry=envelope.files[index];if(entry?.path!==file.path)throw new Error('Package file order changed');
  const content=Buffer.from(entry.content,'base64');if(content.toString('base64')!==entry.content||content.length!==file.bytes||sha256(content)!==file.sha256)throw new Error('Package file content changed');
  decoded.set(file.path,content);
 }
 if(canonicalJson(envelope.descriptor)!==canonicalJson(descriptor))throw new Error('Package descriptor order changed');
 const manifest=dockPluginManifestSchema.parse(JSON.parse(decoded.get('runtime/plugin.json')?.toString('utf8')??'null'));
 if(manifest.id!==descriptor.source.definitionId||descriptor.contractDigest!==`sha256:${hashCanonical({dock:manifest.dock,operations:manifest.operations})}`)throw new Error('Package contract identity changed');
 const receipt=JSON.parse(decoded.get('metadata/gui-build-receipt.json')?.toString('utf8')??'null') as AppGuiBuildReceipt;
 if(!receipt||receipt.compatibility?.kind!=='compiled-v3')throw new Error('Package receipt is invalid');
 const facts=(role:'source'|'runtime')=>descriptor.files.filter(file=>file.role===role).map(file=>({path:file.path.slice(role.length+1),bytes:file.bytes,sha256:sha256(decoded.get(file.path)!)}));
 verifyCompiledV3Inventory({manifest,receipt,sourceFiles:facts('source'),runtimeFiles:facts('runtime')},descriptor.digests as CompiledV3DigestSet);
 return{descriptor,files:envelope.files};
}
