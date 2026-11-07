/**
 * [INPUT]: Pinned source/control files, bounded staged outputs and same-volume exclusive filesystem operations.
 * [OUTPUT]: Publishes dependency metadata/modules without replacing competing source writers; retains conflicted recovery bytes.
 * [POS]: Dependency transaction commit/rollback boundary; runner and publication scratch never enter SourceRoot inventory.
 */
import { linkSync, unlinkSync, renameSync, lstatSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { durableReplaceBytes, syncDirectory } from '../../../persistence/durable-json';
import { inventoryPluginTree, pluginHash } from '../snapshot';
import { assertDependencyCurrent, assertDependencyFiles, assertSourceIdentity, dependencyFiles, dependencyStateFingerprint,
  optionalInfo, readDependencyFile, readDependencyFiles, sameFile, sameIdentity, type DependencyInput, type FileState, type SourceAdmission, type DependencyFile } from './model';
import { copyDependencyTree, dependencyTree } from './tree';

type Entry={name:DependencyFile;backup:string;captured:boolean;owned?:FileState};
export async function publishDependencyTransaction(input:{source:SourceAdmission;stage:string;sourceDigest:string;execution:DependencyInput}){
  const {source,stage,execution}=input;
  assertDependencyCurrent(execution);assertDependencyFiles(source);
  const scratch=await mkdtemp(join(dirname(source.root),'.bottega-dependencies-'));
  const scratchInfo=lstatSync(scratch,{bigint:true});
  const entries:Entry[]=[],modulePath=join(source.root,'node_modules'),moduleBackup=join(scratch,'previous-node_modules');
  let keepScratch=false,moduleCaptured=false,moduleOwned:ReturnType<typeof optionalInfo>=null;
  let moduleRows:Awaited<ReturnType<typeof dependencyTree>>|undefined;
  const expected={...source.files};
  const scratchIdentity=()=>{
    assertSourceIdentity(source);const current=optionalInfo(scratch);
    if(!current||!current.isDirectory()||current.isSymbolicLink()||!sameIdentity(current,scratchInfo))throw new Error('PLUGIN_DEPENDENCY_PUBLICATION_IDENTITY_CHANGED');
  };
  const guard=()=>{
    assertDependencyCurrent(execution);scratchIdentity();
    for(const name of dependencyFiles){
      const owned=entries.some(entry=>entry.name===name&&entry.owned);
      if(!sameFile(readDependencyFile(join(source.root,name),owned),expected[name],owned))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    }
    for(const entry of entries)if(entry.captured&&!sameFile(readDependencyFile(entry.backup),source.files[entry.name]))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED_DURING_PUBLICATION');
  };
  try{
    if(lstatSync(scratch,{bigint:true}).dev!==source.info.dev)throw new Error('PLUGIN_DEPENDENCY_PUBLICATION_VOLUME_CHANGED');
    const next=readDependencyFiles(stage);
    for(const name of dependencyFiles)if(next[name])await durableReplaceBytes(join(scratch,'next-'+name),next[name]!.bytes,0o600,guard);
    const stagedModules=optionalInfo(join(stage,'node_modules'));
    if(stagedModules)moduleRows=await copyDependencyTree(join(stage,'node_modules'),join(scratch,'node_modules'),stage,execution.signal);
    guard();
    if(pluginHash(await inventoryPluginTree(source.root,{signal:execution.signal}))!==input.sourceDigest)throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED');
    guard();
    for(const name of dependencyFiles){
      if(source.files[name]?.bytes.equals(next[name]?.bytes??Buffer.alloc(0))&&Boolean(source.files[name])===Boolean(next[name]))continue;
      guard();const path=join(source.root,name),backup=join(scratch,'previous-'+name),entry:Entry={name,backup,captured:false};entries.push(entry);
      if(source.files[name]){
        renameSync(path,backup);entry.captured=true;
        // Compare the actual displaced inode, not a stale snapshot; exclusive rollback preserves newer bytes.
        if(!sameFile(readDependencyFile(backup),source.files[name]))throw new Error('PLUGIN_DEPENDENCY_SOURCE_CHANGED_DURING_PUBLICATION');
      }
      assertDependencyCurrent(execution);assertSourceIdentity(source);
      if(next[name]){
        scratchIdentity();const candidate=readDependencyFile(join(scratch,'next-'+name));
        if(!candidate||!candidate.bytes.equals(next[name]!.bytes))throw new Error('PLUGIN_DEPENDENCY_PUBLICATION_CHANGED');
        linkSync(join(scratch,'next-'+name),path);entry.owned=readDependencyFile(path,true);expected[name]=entry.owned!;
        if(!sameFile(entry.owned,candidate,true))throw new Error('PLUGIN_DEPENDENCY_PUBLICATION_CHANGED');
      }else expected[name]=null;
    }
    guard();
    if(moduleRows){
      const current=optionalInfo(modulePath);
      if(current===null?source.modules!==null:source.modules===null||!sameIdentity(current,source.modules)||!current.isDirectory()||current.isSymbolicLink())throw new Error('PLUGIN_DEPENDENCY_MODULES_CHANGED');
      if(current){renameSync(modulePath,moduleBackup);moduleCaptured=true;
        const captured=optionalInfo(moduleBackup);if(!captured||!sameIdentity(captured,current))throw new Error('PLUGIN_DEPENDENCY_MODULES_CHANGED');}
      assertDependencyCurrent(execution);assertSourceIdentity(source);
      if(optionalInfo(modulePath))throw new Error('PLUGIN_DEPENDENCY_MODULES_CHANGED');
      renameSync(join(scratch,'node_modules'),modulePath);moduleOwned=lstatSync(modulePath,{bigint:true});
    }
    guard();await syncDirectory(source.root);await syncDirectory(dirname(source.root));guard();
    return dependencyStateFingerprint(next);
  }catch(error){
    const conflicts:unknown[]=[];
    try{
      assertSourceIdentity(source);
      if(moduleOwned){
        scratchIdentity();const aborted=join(scratch,'aborted-node_modules');renameSync(modulePath,aborted);
        const captured=optionalInfo(aborted);
        if(!captured||!sameIdentity(captured,moduleOwned)||pluginHash(await dependencyTree(aborted,aborted))!==pluginHash(moduleRows))throw new Error('Actual displaced modules changed during rollback; retained in recovery');
        moduleOwned=null;
      }
      if(moduleCaptured){
        if(optionalInfo(modulePath))throw new Error('Module rollback target is occupied');
        renameSync(moduleBackup,modulePath);moduleCaptured=false;
      }
    }catch(reason){conflicts.push(reason);}
    for(const entry of [...entries].reverse()){
      try{
        scratchIdentity();const path=join(source.root,entry.name);
        if(entry.owned){
          const aborted=join(scratch,'aborted-'+entry.name);renameSync(path,aborted);
          let owned=false;try{owned=sameFile(readDependencyFile(aborted,true),entry.owned,true);}catch{/* Restore actual captured bytes without following them. */}
          if(!owned){linkSync(aborted,path);unlinkSync(aborted);throw new Error(`Actual authored ${entry.name} changed during rollback`);}
        }else if(optionalInfo(path))throw new Error(`Authored ${entry.name} occupies rollback target`);
        if(entry.captured){linkSync(entry.backup,path);unlinkSync(entry.backup);entry.captured=false;}
      }catch(reason){conflicts.push(reason);}
    }
    if(conflicts.length){keepScratch=true;throw new AggregateError([error,...conflicts],`PLUGIN_DEPENDENCY_RECOVERY_CONFLICT: displaced source files retained at ${scratch}`);}
    await syncDirectory(source.root);throw error;
  }finally{if(!keepScratch){scratchIdentity();await rm(scratch,{recursive:true,force:true});}}
}
