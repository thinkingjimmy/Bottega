/**
 * [INPUT]: Canonical System sources, original asset-group/blob records and exact native project members.
 * [OUTPUT]: Logical image assets with immutable captured provenance and explicit retirement on replacement/deletion.
 * [POS]: System asset boundary; the existing document journal owns every resource mutation.
 */
import { z } from "zod";
import type { DesignSystem } from "@ai-chat/cloud-protocol/artifacts/design/system/model";
import { designDigest, sourcePath } from "../../documents/model";
const record = z.object({ name: sourcePath, blob: z.string().regex(/^[a-f0-9]{32}$/), size: z.number().int().positive().max(8 * 1024 * 1024), type: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), storedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
const group = z.object({ name: z.string().min(1).max(80).refine(value => !/[\\/]/.test(value) && !value.includes("\0") && value !== "." && value !== ".."), order: z.array(sourcePath).max(256), files: z.record(z.string().max(240), record), tile: z.enum(["xs", "s", "m", "l", "xl"]).optional() }).strict();
const extensions: Record<string, string[]> = { "image/png":["png"], "image/jpeg":["jpg","jpeg"], "image/webp":["webp"], "image/gif":["gif"], "image/svg+xml":["svg"] };
export function applySystemAssets(system: DesignSystem, projected: ReadonlyMap<string, Uint8Array>, result: Map<string, Uint8Array>) {
  const index = projected.get("project/design-system.json"); if (!index || index.length > 1024 * 1024) throw new Error("The asset index is missing or oversized");
  const raw = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(index));
  const groups = z.record(z.string().max(240),group).parse(raw.assetGroups ?? {}); if (Object.keys(groups).length > 32) throw new Error("The asset group limit is 32");
  const assets = new Map<string,{data:Uint8Array;blob:boolean}>();
  for (const [path,data] of projected) if (/^project\/assets\/(?![a-f0-9]{32}\.[a-z]+$).+\.(?:png|jpe?g|webp|gif|svg)$/i.test(path)) assets.set(sourcePath.parse(path.slice(8)),{data,blob:false});
  const names = new Set<string>();
  for (const value of Object.values(groups)) {
    if (names.has(value.name)) throw new Error("Duplicate asset group"); names.add(value.name);
    for (const file of Object.values(value.files)) {
      const path = sourcePath.parse("assets/"+value.name+"/"+file.name), extension = file.name.split(".").at(-1)!.toLowerCase();
      if (!extensions[file.type]!.includes(extension)) throw new Error("Asset MIME and extension disagree");
      const candidates = extensions[file.type]!.flatMap(extension => { const bytes=projected.get("project/assets/"+file.blob+"."+extension); return bytes?[bytes]:[]; });
      if (candidates.length !== 1) throw new Error("The asset needs one exact uploaded source"); const data=candidates[0]!, digest=designDigest(data);
      if (data.length !== file.size || digest.slice(7,39) !== file.blob || file.sha256 !== undefined && digest !== "sha256:"+file.sha256) throw new Error("Asset bytes do not match their record");
      assets.set(path,{data,blob:true});
    }
  }
  if (assets.size > 256) throw new Error("The asset limit is 256");
  const active = new Set<string>();
  for (const [path,{data,blob}] of assets) {
    if (!data.length || data.length > 8*1024*1024) throw new Error("Asset size is invalid");
    const digest=designDigest(data), id="asset-"+(blob?"blob-":"file-")+designDigest(JSON.stringify([path,digest])).slice(7,39), capturedPath="captured/assets/"+id+"/"+digest.slice(7)+"."+path.split(".").at(-1)!.toLowerCase();
    let source=system.sources.files.find(source=>source.id===id);
    if (source && (source.digest !== digest || source.capturedPath !== capturedPath || source.path !== path)) throw new Error("Asset capture conflicts with an existing source");
    if (!source) { source={id,path,capturedPath,digest,bytes:data.length,version:{kind:"digest",digest}};system.sources.files.push(source); }
    delete source.retained;active.add(id);result.set(path,data);result.set(capturedPath,data);
  }
  for (const source of system.sources.files) if (/^asset-(?:blob|file)-/.test(source.id) && !active.has(source.id)) {
    source.retained=true;if (!assets.has(source.path)) result.delete(source.path);
  }
}
