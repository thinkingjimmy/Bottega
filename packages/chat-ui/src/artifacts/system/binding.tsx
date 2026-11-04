/**
 * [INPUT]: Original Chat's catalog, immutable system versions and existing consumer command/checkpoint owner; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: Human-named fixed system/version choices with optional provenance and explicit binding.
 * [POS]: Consumer system picker; choices never float an existing binding or grant foreign source authority.
 */
import { useEffect, useState, type ReactNode } from "react";
import { nativeHistoryResultSchema } from "@ai-chat/cloud-protocol/artifacts/design/history/model";
import { historyCopy } from "../history/copy";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { useArtifactHost } from "../context";
import { useArtifactCatalog } from "../presentation/directory";
import { workspaceCopy } from "./display/copy";
import { systemCopy } from "./copy";
import type { SystemCommand, SystemDraft } from "./model";
export function SystemBindingPicker({ artifactId, state, draft, busy, editable, mutate, run, feedback }: { artifactId: string; state: WorkspaceRead; draft: SystemDraft; busy: boolean; editable: boolean;
  mutate(value: SystemDraft): void; run(input: SystemCommand): Promise<void>; feedback: ReactNode }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), system = systemCopy(host.locale), catalog = useArtifactCatalog();
  const systems = catalog.filter(work => work.format === "bottega-design-system" || work.fence?.design?.format === "bottega-design-system");
  const selectedId = draft.systemId ?? state.manifest.systems?.[0]?.documentId ?? "", selected = systems.find(work => work.documentId === selectedId);
  const artifact = selected?.artifactRef.artifactId;
  const [loaded, setLoaded] = useState<{ artifact?: string; versions?: WorkspaceRead["versions"]; failed?: boolean; next?:number|null; busy?:boolean }>({});
  const versions = loaded.artifact === artifact ? loaded.versions ?? [] : [], failed = loaded.artifact === artifact && loaded.failed;
  useEffect(() => {
    if (!artifact) return;
    let current = true;
    void host.workspace!({action:"native-history-list",artifactId:artifact,documentId:selectedId,history:{cursor:0}}).then(value=>{
      const result=nativeHistoryResultSchema.parse(value);if(result.kind!=="list")throw new Error("The selected System History is unavailable");
      if(current)setLoaded({artifact,versions:result.entries.map(entry=>({revision:entry.revision,artifactId:entry.artifactId,createdAt:entry.createdAt})),next:result.nextCursor});
    }).catch(()=>{if(current)setLoaded({artifact,failed:true})});
    return () => { current = false; };
  }, [host, artifact, selectedId]);
  const bound=state.manifest.systems?.find(value=>value.documentId===selectedId), boundOnly=bound&&!versions.some(version=>version.revision===bound.revision);
  const revision = draft.targetRevision ?? state.manifest.systems?.find(value => value.documentId === selectedId)?.revision ?? selected?.revision;
  return <fieldset data-system-binding={state.documentId} className="flex min-w-0 flex-col gap-4" disabled={busy}>
    <legend className="mb-3 text-sm font-medium">{system.bind}</legend>
    {(state.manifest.systems ?? []).map(binding => <div key={binding.documentId} className="rounded-md bg-muted p-3 text-sm"><p className="font-medium">{systems.find(work => work.documentId === binding.documentId)?.title ?? binding.documentId}</p><p className="text-xs text-muted-foreground">{system.fixed} · {formatCopy(copy.revisionTag, { revision: binding.revision })}</p><details className="mt-2"><summary className="min-h-[44px] cursor-pointer py-2 text-xs">{copy.sourceDetails}</summary><p className="break-all font-mono text-xs">{binding.snapshotRef}</p><p className="text-xs">{system.closure}: {binding.files.length}</p></details></div>)}
    {!systems.length ? <p role="status" className="text-sm text-muted-foreground">{copy.noSystems}</p> : <>
      <label className="flex min-w-0 flex-col gap-2 text-sm">{copy.system}<select aria-label={copy.system} disabled={Boolean(draft.request)} value={selectedId} className="min-h-[44px] max-w-full rounded-md border bg-background px-2" onChange={event => {
        const target = systems.find(work => work.documentId === event.target.value); if (target) mutate({ ...draft, systemId: target.documentId, targetRevision: target.revision });
      }}><option value="">{copy.chooseSystem}</option>{systems.map(work => <option key={work.documentId} value={work.documentId}>{work.title}</option>)}</select></label>
      <label className="flex flex-col gap-2 text-sm">{copy.revisionScope}<select aria-label={copy.version} disabled={Boolean(draft.request) || !selected} value={revision ?? ""} className="min-h-[44px] rounded-md border bg-background px-2" onChange={event => mutate({ ...draft, systemId: selectedId, targetRevision: Number(event.target.value) })}><option value="" disabled>{copy.version}</option>{boundOnly&&<option value={bound.revision}>{formatCopy(copy.revisionTag,{revision:bound.revision})}</option>}{versions.map(version => <option key={version.revision} value={version.revision}>{formatCopy(copy.revisionTag, { revision: version.revision })}</option>)}</select></label>
      {loaded.artifact===artifact&&loaded.next!==null&&loaded.next!==undefined&&<Button type="button" variant="outline" disabled={loaded.busy} onClick={()=>{
        setLoaded(value=>({...value,busy:true}));void host.workspace!({action:"native-history-list",artifactId:artifact,documentId:selectedId,history:{cursor:loaded.next!}}).then(value=>{const result=nativeHistoryResultSchema.parse(value);if(result.kind!=="list")throw new Error("The selected System History is unavailable");setLoaded(previous=>previous.artifact!==artifact?previous:{artifact,versions:[...(previous.versions??[]),...result.entries.map(entry=>({revision:entry.revision,artifactId:entry.artifactId,createdAt:entry.createdAt}))],next:result.nextCursor})}).catch(()=>setLoaded(previous=>previous.artifact!==artifact?previous:{...previous,busy:false,failed:true}));
      }}>{historyCopy(host.locale).more}</Button>}
      <Button type="button" disabled={!editable || !selected || !revision || !versions.some(value => value.revision === revision) && bound?.revision!==revision} className="min-h-[44px]" onClick={() => void run({ action: "system-bind", artifactId, generation: state.generation, requestId: crypto.randomUUID(), expectedRevision: state.revision, readSetDigest: state.readSetDigest, systemId: selectedId, targetRevision: revision })}>{system.bindAction}</Button>
    </>}
    {failed && <p role="alert">{copy.failed}</p>}{feedback}
  </fieldset>;
}
