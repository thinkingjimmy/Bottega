/**
 * [INPUT]: Original native checkpoint, current owned head and closed retained candidate/rollback request identities.
 * [OUTPUT]: Visible latest-AI rollback, existing-only operation recovery and explicit non-writing retained-input disposal.
 * [POS]: Shared review recovery owner; source journals and original Chat retain all execution and version authority.
 */
import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { workspaceCommandSchema, type WorkspaceCommand, type WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import { nativeOperationReference } from "@ai-chat/cloud-protocol/artifacts/design/native/operation";
import type { ArtifactHost } from "../../context";
import { nativeCopy } from "../copy";
type Command = Omit<WorkspaceCommand, "chatId" | "incarnationId">;
export function NativeRollback({ sourceChecked, host, state, viewId, read, update, flush, applied, className }: { sourceChecked(read: WorkspaceRead): void; host: ArtifactHost; state: WorkspaceRead; viewId: string;
  read(): NativeInput; update(value: NativeInput): Promise<void>; flush(): Promise<void>; applied(): void; className: string }) {
  const copy = nativeCopy(host.locale), active = useRef(false), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [notAccepted, setNotAccepted] = useState<string>();
  const [chatStatus,setChatStatus]=useState<"pending"|"paused"|"failed">("pending");
  const checkChat = async (resume=false) => {
    const pending=state.pendingChatEdit;if(!pending||active.current||!host.workspace)return;active.current=true;setBusy(true);
    try {
      const result=await host.workspace({action:resume?"resume-edit":"operation-status",artifactId:pending.artifactId,documentId:state.documentId,generation:state.generation,viewId,requestId:pending.requestId}) as {status:string;recovery?:{status:string}};
      if(result.status==="committed")sourceChecked(await host.workspace({action:"native-head",artifactId:state.fence!.id}) as WorkspaceRead);
      else setChatStatus(result.recovery?.status==="paused"?"paused":"pending");
    } catch {setChatStatus("failed");}finally{active.current=false;setBusy(false);}
  };
  const pendingText = read().pending;
  let pending: Command | undefined;
  try {
    const value = JSON.parse(pendingText ?? "null") as Command | null;
    if (value && ["native-candidate-accept", "native-ai-rollback", "native-candidate"].includes(value.action)) {
      workspaceCommandSchema.parse({ ...value, chatId: "retained-input", incarnationId: "retained-input" });
      if (value.action !== "native-candidate") nativeOperationReference(value);
      pending = value;
    }
  } catch { /* Unknown input remains with its original recovery owner. */ }
  const run = async (original?: Command) => {
    if (active.current || !host.workspace) return; active.current = true; setBusy(true); setFailed(false);
    try {
      if (original?.action === "native-candidate") {
        const result = await host.workspace({ action: "native-candidate-status", artifactId: state.fence!.id, documentId: state.documentId, generation: state.generation, viewId }) as { phase: string; requestId?: string };
        if (result.phase !== "idle" && result.requestId !== original.requestId) throw new Error("The retained proposal status belongs to another request");
        return;
      }
      let command = original;
      if (!command) {
        if (read().pending) throw new Error("Check the previous source operation first");
        await flush(); const head = await host.workspace({ action: "native-head", artifactId: state.fence!.id }) as WorkspaceRead;
        if (!head.aiRollback || !head.editable) throw new Error("The latest AI rollback is no longer available");
        command = { action: "native-ai-rollback", artifactId: head.fence!.id, documentId: head.documentId, viewId, generation: head.generation,
          expectedRevision: head.revision, readSetDigest: head.readSetDigest, requestId: crypto.randomUUID(), rollbackOf: head.aiRollback.requestId };
        await update({ ...read(), pending: JSON.stringify(command) });
      }
      const result = await host.workspace(original ? { action: "operation-status", artifactId: command.artifactId, documentId: command.documentId,
        generation: state.generation, viewId, requestId: command.requestId, nativeOperation: nativeOperationReference(command) } : command) as { status?: string };
      if (original && result.status === "not-accepted") { setNotAccepted(command.requestId); return; }
      if (result.status !== "committed") throw new Error("Query the original source operation");
      await update({ ...read(), pending: undefined }); applied();
    } catch { setFailed(true); }
    finally { active.current = false; setBusy(false); }
  };
  const discard = async () => {
    if (active.current || !pending || read().pending !== pendingText) return;
    if (pending.action !== "native-candidate" && notAccepted !== pending.requestId) return;
    active.current = true; setBusy(true); setFailed(false);
    try { await update({ ...read(), pending: undefined }); setNotAccepted(undefined); }
    catch { setFailed(true); }
    finally { active.current = false; setBusy(false); }
  };
  if (!state.aiRollback && !pending && !state.pendingChatEdit) return null;
  const mayDiscard = pending && (pending.action === "native-candidate" || notAccepted === pending.requestId);
  return <>
    {state.pendingChatEdit && <div data-native-chat-recovery="" role={chatStatus==="failed"?"alert":"status"} className="absolute right-0 bottom-12 w-72 rounded-lg border bg-background p-3 text-sm shadow-lg">
      <p>{chatStatus==="failed"?copy.failed:copy.pending}</p><button type="button" className="mt-2 min-h-11 rounded-md border px-3" disabled={busy} onClick={()=>void checkChat()}>{copy.check}</button>
      {chatStatus==="paused"&&<button type="button" className="mt-2 min-h-11 rounded-md border px-3" disabled={busy} onClick={()=>void checkChat(true)}>{copy.resume}</button>}
    </div>}
    {state.aiRollback && <button type="button" className={className} disabled={busy || Boolean(pendingText) || Boolean(state.pendingChatEdit)} title={copy.rollback} aria-label={copy.rollback} onClick={() => void run()}><RotateCcw className="size-4" /></button>}
    {(pending || failed) && <div role={failed ? "alert" : "status"} className="absolute right-0 bottom-12 w-72 rounded-lg border bg-background p-3 text-sm shadow-lg">
      <p>{pending?.action === "native-candidate" ? copy.proposalOnly : pending && notAccepted === pending.requestId ? copy.notAccepted : pending ? copy.pending : copy.failed}</p>
      {pending && <button type="button" className="mt-2 min-h-11 rounded-md border px-3" disabled={busy} onClick={() => void run(pending)}>{copy.check}</button>}
      {mayDiscard && <button type="button" className="mt-2 min-h-11 rounded-md border px-3" disabled={busy} onClick={() => void discard()}>{copy.discardRequest}</button>}
    </div>}
  </>;
}
