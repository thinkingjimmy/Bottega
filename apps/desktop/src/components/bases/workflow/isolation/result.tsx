/**
 * [INPUT]: Canonical local Workflow isolation snapshots, accepted run state, reviewed HEAD/revision merge API and kept action state.
 * [OUTPUT]: WorkflowIsolationResult with factual branch/dirty/merge status and exact once-per-review accepted-result merge.
 * [POS]: Desktop contribution inside the shared run details Slot; phone/Web receive no local Git controls.
 */
import { useEffect,useRef,useState } from 'react';
import type { WorkflowsBridge,WorkflowIsolationSnapshot,WorkflowIsolationMergeResult } from '@ai-chat/cloud-protocol/contracts/workflow/bridge';
import type { WorkflowRun } from '@ai-chat/cloud-protocol/contracts/workflow/run';
import { useKeptState } from '@ai-chat/base-ui/ui/workflow/runs-context';
import { ConfirmationDialog } from '@ai-chat/ui/components/ui/app-dialog';
import { Button } from '@ai-chat/ui/components/ui/button';
import { workflowIsolationCopy } from './copy';
type Review={operationId:string;expectedHead:string;expectedRunRevision:number;branch:string;memberCommit:string};
export function WorkflowIsolationResult({bridge,run,locale}:{bridge:WorkflowsBridge;run:WorkflowRun;locale:string}){
  const copy=workflowIsolationCopy(locale),[snapshot,setSnapshot]=useState<WorkflowIsolationSnapshot|null>(null),[attempt,setAttempt]=useState(0);
  const [review,setReview]=useKeptState<Review|null>(`${run.runId}:isolation-review`,null),[busy,setBusy]=useKeptState(`${run.runId}:isolation-busy`,false),[error,setError]=useKeptState<string|null>(`${run.runId}:isolation-error`,null),[receipt,setReceipt]=useKeptState<WorkflowIsolationMergeResult|null>(`${run.runId}:isolation-result`,null),lock=useRef(false);
  const isolated=run.inputs.workspaceMode==='worktree';
  useEffect(()=>{if(!isolated)return;let live=true,generation=0;const load=()=>{const current=++generation;void bridge.isolation(run.runId).then(value=>{if(live&&current===generation)setSnapshot(value);},cause=>{if(live&&current===generation)setError(cause instanceof Error?cause.message:String(cause));});};load();const stop=bridge.onChanged(event=>{if(event.runId===run.runId)load();});return()=>{live=false;stop();};},[bridge,run.runId,isolated,attempt,setError]);
  if(!isolated)return null;
  const result=receipt??snapshot?.merge,state=result?.status??(snapshot?.status==='merged'?'applied':snapshot?.status),eligible=run.state==='succeeded'&&['accepted','accepted-with-exceptions'].includes(run.businessOutcome??'');
  const label=state==='applied'?copy.merged:state==='conflicted'?copy.conflicted:state==='blocked'?copy.blocked:state==='prepared'?copy.prepared:copy.ready;
  const merge=async()=>{if(!review||busy||lock.current)return;lock.current=true;setBusy(true);setError(null);const {operationId,expectedHead,expectedRunRevision}=review;
    try{const value=await bridge.mergeIsolation(run.runId,{operationId,expectedHead,expectedRunRevision});setReceipt(value);setReview(null);setAttempt(value=>value+1);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{lock.current=false;setBusy(false);}};
  return <section className="space-y-3 rounded-lg border p-3 text-xs" data-workflow-isolation={run.runId} data-workflow-merge-state={state}>
    <h3 className="font-medium">{copy.title}</h3>{snapshot&&<><p role="status">{busy?copy.pending:label}</p><p className="break-all text-muted-foreground">{copy.branch}: {snapshot.branch}</p>{snapshot.dirty&&state!=='applied'&&<p className="text-muted-foreground">{copy.dirty}</p>}</>}
    {error&&<p role="alert" className="break-words text-destructive">{error}</p>}{result?.error&&<p className="break-words text-destructive">{result.error}</p>}{result?.conflicts.length? <ul className="space-y-1 break-all text-destructive">{result.conflicts.map(file=><li key={file}>{file}</li>)}</ul>:null}
    <div className="flex flex-wrap gap-2">{eligible&&snapshot&&state!=='applied'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>{setError(null);setReview({operationId:crypto.randomUUID(),expectedHead:snapshot.expectedHead,expectedRunRevision:run.revision,branch:snapshot.branch,memberCommit:snapshot.memberCommit});}}>{copy.merge}</Button>}{(!snapshot||error)&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setError(null);setAttempt(value=>value+1);}}>{copy.retry}</Button>}</div>
    <ConfirmationDialog open={!!review} busy={busy} title={copy.reviewTitle} description={<div data-workflow-merge-review="" className="space-y-3"><p>{copy.reviewBody}</p><dl className="space-y-1 break-all text-xs"><dt>{copy.head}</dt><dd>{review?.expectedHead}</dd><dt>{copy.branch}</dt><dd>{review?.branch}</dd><dt>{copy.commit}</dt><dd>{review?.memberCommit}</dd></dl>{error&&<p role="alert" className="text-destructive">{error}</p>}</div>} confirmLabel={copy.confirm} onOpenChange={open=>{if(!open&&!busy)setReview(null);}} onConfirm={()=>void merge()}/>
  </section>;
}
