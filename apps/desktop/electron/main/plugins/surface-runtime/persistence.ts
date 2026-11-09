/**
 * [INPUT]: Strict current and bounded legacy plugin schemas, regular persisted files and parent-synced durable publication.
 * [OUTPUT]: migratePluginFile serializes each file migration, validates legacy state, preserves its exact bytes with retry durability, then publishes the current format; unknown formats remain untouched.
 * [POS]: Shared retained Surface/package migration boundary for loaded owners and cold account cleanup.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { z } from 'zod';
import { canonicalJson } from '@bottega/contracts/core/canonical-json';
import { durableReplaceBytes } from '../../persistence/durable-json';

const migrations=new Map<string,Promise<unknown>>();

export function migratePluginFile<T>(filePath:string,currentSchema:z.ZodType<T>,legacySchema:z.ZodType<T>):Promise<T|null> {
 const key=resolve(filePath),previous=migrations.get(key)??Promise.resolve();
 const task=previous.catch(()=>undefined).then(()=>migrate(key,currentSchema,legacySchema));
 migrations.set(key,task);
 const release=()=>{if(migrations.get(key)===task)migrations.delete(key);};
 void task.then(release,release);
 return task;
}

async function migrate<T>(filePath:string,currentSchema:z.ZodType<T>,legacySchema:z.ZodType<T>):Promise<T|null> {
 const info=await lstat(filePath).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
 if(!info)return null;
 if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1)throw new Error('Plugin state must be a private regular file');
 const bytes=await readFile(filePath),raw:unknown=JSON.parse(bytes.toString('utf8'));
 const current=currentSchema.safeParse(raw);
 if(current.success)return current.data;
 const migrated=legacySchema.parse(raw);
 const digest=createHash('sha256').update(bytes).digest('hex');
 const backupPath=join(dirname(filePath),'plugin-surface-backups',`${basename(filePath)}.v1-${digest}.json`);
 const backup=await lstat(backupPath).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
 if(backup){
  if(!backup.isFile()||backup.isSymbolicLink()||backup.nlink!==1||!(await readFile(backupPath)).equals(bytes))
   throw new Error('Plugin migration backup does not match its original bytes');
 }
 // Republish matching bytes too: a previous attempt may have stopped before its directory barrier.
 await durableReplaceBytes(backupPath,bytes);
 // Check for unexpected writes outside the serialized migration callers.
 if(!(await readFile(filePath)).equals(bytes))throw new Error('Plugin state changed during migration');
 await durableReplaceBytes(filePath,Buffer.from(canonicalJson(migrated)));
 return migrated;
}
