/**
 * [INPUT]: Depends on private sealed artifact directories and durable generation reachability.
 * [OUTPUT]: Provides complete artifact byte accounting and unreachable generation reclamation.
 * [POS]: Plugin retention leaf; source, runtime and receipt bytes share one quota.
 */
import { lstat, readdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { removePackageArtifact } from "../../apps/share/package/package-contract";

export async function artifactBytes(root:string):Promise<number> {
  let entries=0,bytes=0;
  async function visit(path:string) {
    if(++entries>4096)throw new Error("Plugin artifact inventory exceeds its budget");
    const info=await lstat(path);
    if(info.isDirectory())for(const name of await readdir(path))await visit(join(path,name));
    else if(info.isFile()&&!info.isSymbolicLink())bytes+=info.size;
    else throw new Error("Invalid sealed plugin artifact entry");
  }
  await visit(root);return bytes;
}

export async function collectUnreferenced(root:string,retained:ReadonlySet<string>) {
  const entries=await readdir(root,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return [];throw error;});
  for(const entry of entries) {
    if(!entry.isDirectory()||!/^plugin-[a-f0-9-]{36}$/.test(entry.name)||retained.has(entry.name))continue;
    await removePackageArtifact(join(root,entry.name));
  }
}

export async function collectUnknownPlugins(root:string,installed:ReadonlySet<string>) {
  const entries=await readdir(root,{withFileTypes:true});
  for(const entry of entries) {
    if(!entry.isDirectory()||!/^[a-z][a-z0-9.-]{0,119}$/.test(entry.name)||installed.has(entry.name))continue;
    const path=join(root,entry.name);
    await collectUnreferenced(path,new Set());
    await rmdir(path).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="ENOTEMPTY"&&error.code!=="ENOENT")throw error;});
  }
}
