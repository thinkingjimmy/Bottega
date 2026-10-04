/**
 * [INPUT]: Depends on AppStore publication/consent, verified generation artifacts and the fixed package copier.
 * [OUTPUT]: Provides generation history projection and restoration through the existing generation build/cutover lifecycle.
 * [POS]: App history leaf; restores selected source as a newly authorized generation, never swaps historical grants into active state.
 */
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AppRecord, AppGeneration } from "../../../../../shared/ipc/apps/apps-ipc";
import { verifyCompiledV3Artifact } from "../../gui-build/pipeline/seal";
import { copyPackage, removePackageArtifact, verifyPackageArtifact } from "../../share/package/package-contract";
import { generationDigests } from "../../generation/app-generation-plan";
type HistoryPorts = Readonly<{
 get(appId:string):AppRecord|undefined;
 artifactRoot(appId:string,generationId:string):string;
 stagingRoot:string;
 publishGeneration(appId:string,update:(record:AppRecord)=>AppRecord,options:{generationSourceDir:string}):Promise<AppRecord>;
}>;
export async function appGenerationHistory(ports:HistoryPorts,appId:string) {
  const record=ports.get(appId);if(!record)throw new Error("App does not exist");
  return Promise.all([...record.generations].sort((a,b)=>b.createdAt-a.createdAt).map(async generation=>({
    generationId:generation.generationId,createdAt:generation.createdAt,active:record.generationBinding.active?.generationId===generation.generationId,
    available:await stat(ports.artifactRoot(appId,generation.generationId)).then(value=>value.isDirectory(),()=>false),
    contentDigest:generation.contentDigest,sourcePackageDigest:generation.sourcePackageDigest,
  })));
}
export async function restoreAppGeneration(ports:HistoryPorts,appId:string,generationId:string,expectedActiveGenerationId:string|null) {
  const initial=ports.get(appId);if(!initial)throw new Error("App does not exist");
  assertCurrent(initial,expectedActiveGenerationId);
  const target=initial.generations.find(generation=>generation.generationId===generationId);
  if(!target)throw new Error("App generation is unavailable");
  const root=ports.artifactRoot(appId,generationId);
  await verify(root,target);
  const staging=await mkdtemp(join(ports.stagingRoot,"restore-"));
  try {
    await copyPackage(join(root,"source"),staging);
    return await ports.publishGeneration(appId,current=>{
      assertCurrent(current,expectedActiveGenerationId);
      if(current.generationBinding.pending)throw new Error("An App generation already awaits authorization");
      // Pending publication retains the current manifest/grant; promotion independently requires an exact new-generation grant.
      return {...current,manifest:target.manifest,lastError:null};
    },{generationSourceDir:staging});
  } finally {await removePackageArtifact(staging);}
}
function assertCurrent(record:AppRecord,expected:string|null) {
  if((record.generationBinding.active?.generationId??null)!==expected)throw new Error("Active App generation changed");
  if(record.state!=="ready")throw new Error("App is not ready for generation restoration");
}
async function verify(root:string,generation:AppGeneration) {
  if(generation.contentLayoutVersion===3) {
    if(!generation.buildReceiptDigest)throw new Error("Compiled generation receipt is missing");
    await verifyCompiledV3Artifact(root,{...generationDigests(generation),buildReceiptDigest:generation.buildReceiptDigest});
  } else await verifyPackageArtifact({root,manifest:generation.manifest,expected:generationDigests(generation)});
}
