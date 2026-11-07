/**
 * [INPUT]: No-follow filesystem reads, canonical directory identity and the canonical digest leaf.
 * [OUTPUT]: Pinned source/control-file admission, exact control/local-source fingerprints and transaction types.
 * [POS]: Operation-loaded dependency authority shared by staging, publication, cache and frozen-build checks.
 */
import { constants, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { pluginHash } from '../identity/hash';
import type { PluginCommand, PluginCommandResult } from '../dependencies';

export const dependencyFiles=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'] as const;
export type DependencyFile=typeof dependencyFiles[number];
export type FileState={info:BigIntStats;bytes:Buffer}|null;
export type SourceAdmission={root:string;info:BigIntStats;parent:{path:string;info:BigIntStats};files:Record<DependencyFile,FileState>;modules:BigIntStats|null};
export type DependencyInput={sourceRoot:string;privateRoot:string;storeDir:string;node:string;pnpm:string;signal?:AbortSignal;current?():void;
  operation?:{kind:'add'|'remove';packages:readonly string[]};
  confirmBuilds?:(packages:readonly string[])=>Promise<readonly string[]>;
  run(command:PluginCommand):Promise<PluginCommandResult>};
export type DependencyReceipt={ignoredBuilds:string[];approvedBuilds:string[];pnpmVersion:string;dependencyFingerprint:string;localSourceDigest?:string};
export const inside=(root:string,path:string)=>{const child=relative(root,path);return child===''||child!=='..'&&!child.startsWith('../')&&!isAbsolute(child);};
export const sameIdentity=(a:BigIntStats,b:BigIntStats)=>a.dev===b.dev&&a.ino===b.ino;
const unchanged=(a:BigIntStats,b:BigIntStats)=>sameIdentity(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs;
export function optionalInfo(path:string){try{return lstatSync(path,{bigint:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}}
export function readDependencyFile(path:string,allowLinked=false):FileState{
  const info=optionalInfo(path);if(!info)return null;
  if(!info.isFile()||info.isSymbolicLink()||!allowLinked&&info.nlink!==1n||info.size>32n*1024n*1024n)throw new Error('PLUGIN_DEPENDENCY_REGULAR_FILE_REQUIRED');
  if(realpathSync(path)!==resolve(path))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
  const file=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    if(!sameIdentity(info,fstatSync(file,{bigint:true})))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    const buffer=Buffer.alloc(Number(info.size)+1);let offset=0;
    while(offset<buffer.length){const size=readSync(file,buffer,offset,buffer.length-offset,null);if(!size)break;offset+=size;}
    if(offset!==Number(info.size)||!unchanged(info,fstatSync(file,{bigint:true}))||!unchanged(info,lstatSync(path,{bigint:true}))||realpathSync(path)!==resolve(path))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    return{info,bytes:buffer.subarray(0,offset)};
  }finally{closeSync(file);}
}
export function readDependencyFiles(root:string,allowLinked=false){return Object.fromEntries(dependencyFiles.map(name=>[name,readDependencyFile(join(root,name),allowLinked)])) as SourceAdmission['files'];}
export const dependencyStateFingerprint=(files:SourceAdmission['files'])=>pluginHash(dependencyFiles.map(name=>({name,bytes:files[name]?.bytes.toString('utf8')??null})));
export const dependencyLocalSourceDigest=(files:readonly {path:string;bytes:number;sha256:string}[])=>pluginHash(files.filter(file=>!dependencyFiles.some(name=>name===file.path)));
export const dependencyFingerprint=(root:string)=>dependencyStateFingerprint(readDependencyFiles(root));
export function admitDependencySource(directory:string):SourceAdmission{
  const root=resolve(directory),info=lstatSync(root,{bigint:true});
  if(directory!==root||realpathSync(root)!==root||!info.isDirectory()||info.isSymbolicLink())throw new Error('PLUGIN_DEPENDENCY_SOURCE_CANONICAL_DIRECTORY_REQUIRED');
  const files=readDependencyFiles(root),modules=optionalInfo(join(root,'node_modules'));
  if(modules&&(!modules.isDirectory()||modules.isSymbolicLink()))throw new Error('PLUGIN_DEPENDENCY_MODULE_DIRECTORY_REQUIRED');
  const parent={path:dirname(root),info:lstatSync(dirname(root),{bigint:true})};
  return{root,info,parent,files,modules};
}
export function assertSourceIdentity(source:SourceAdmission){
  const parent=optionalInfo(source.parent.path);
  if(!parent||!sameIdentity(parent,source.parent.info)||realpathSync(source.parent.path)!==source.parent.path)throw new Error('PLUGIN_DEPENDENCY_SOURCE_PARENT_IDENTITY_CHANGED');
  const info=optionalInfo(source.root);
  if(!info||!info.isDirectory()||info.isSymbolicLink()||realpathSync(source.root)!==source.root||!sameIdentity(info,source.info))throw new Error('PLUGIN_DEPENDENCY_SOURCE_IDENTITY_CHANGED');
}
export function sameFile(actual:FileState,expected:FileState,owned=false){
  return actual===null||expected===null?actual===expected:unchanged(actual.info,expected.info)&&actual.bytes.equals(expected.bytes)&&(owned||actual.info.nlink===1n);
}
export function assertDependencyFiles(source:SourceAdmission){
  assertSourceIdentity(source);const current=readDependencyFiles(source.root);
  if(dependencyFiles.some(name=>!sameFile(current[name],source.files[name])))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
}
export function assertDependencyCurrent(input:Pick<DependencyInput,'signal'|'current'>){input.signal?.throwIfAborted();input.current?.();}
