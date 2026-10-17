/**
 * [INPUT]: Displayed revision, trusted source target, existing edit/Canvas checkpoints, owner input admission guard and original host journal ports.
 * [OUTPUT]: One owner-guarded property/Canvas/navigation controller with displayed CAS/snapshot identity, original request retention and source-conflict recovery.
 * [POS]: Shared mutation controller for Canvas chrome and inspectors; main remains the only save authority.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceCommand, WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { DesignAnchor, DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { canvasOperationsSchema, type CanvasOperation, type CanvasRequest } from "@ai-chat/cloud-protocol/artifacts/design/canvas/commands";
import { useArtifactHost } from "../../context";
import { workspaceCopy } from "../copy";
export type DesignEdit = NonNullable<DesignCheckpoint["edit"]>;
export type CanvasEdit = NonNullable<DesignCheckpoint["canvas"]>;
type Command = Omit<WorkspaceCommand, "chatId" | "incarnationId">;
type Result = { status: "committed" | "pending" | "conflict"; artifactId?: string; artifactRef?: { artifactId: string }; sourceConflict?: DesignEdit["sourceConflict"]; recovery?: { status: string } };
const refused = (cause: unknown) => cause instanceof Error && ((cause as { noAdmission?: boolean }).noAdmission || /REVISION_CONFLICT|SOURCE_CHANGED|INVALID_DOCUMENT|PATH_DENIED|BUDGET_EXCEEDED|ARTIFACT_DISABLED|artifact-conflict|artifact-invalid|artifact-path|artifact-budget|artifact-disabled|GENERATION_EXPIRED|artifact-generation-expired|Anchor|Select/.test(cause.message));
export function useDesignEdits({ state, anchor, draft, canvasDraft, onDraft, onCanvasDraft, onCommitted, onConflict, canCommit }: { state: WorkspaceRead | null; anchor: DesignAnchor | null; draft?: DesignEdit; canvasDraft?: CanvasEdit;
  onDraft(value: DesignEdit): Promise<unknown>; onCanvasDraft?(value: CanvasEdit): Promise<unknown>; onCommitted(id: string, operations?: CanvasOperation[]): void; onConflict?(): Promise<unknown>; canCommit?(): boolean }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), edit = useMemo<DesignEdit>(() => draft ?? { property: "text", value: "", anchor: null }, [draft]);
  const lock = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), pending = Boolean(edit.request || canvasDraft?.request);
  const conflict = edit.sourceConflict?.needsResolution || canvasDraft?.sourceConflict?.needsResolution;
  useEffect(() => { if (anchor && anchor !== edit.anchor && !busy && !pending && !conflict && !canvasDraft?.draft && !canvasDraft?.selection.some(id => state?.canvas?.objects.some(object => object.id === id))) void onDraft({ ...edit, anchor, sourceConflict: undefined,
    value: edit.anchor && (edit.property !== "text" ? Boolean(edit.value) : edit.value !== edit.anchor.currentText) ? edit.value : edit.property === "text" ? anchor.currentText : edit.property in (anchor.properties ?? {}) ? anchor.properties?.[edit.property as keyof NonNullable<DesignAnchor["properties"]>] ?? "" : "" }).catch(() => setError(copy.failed)); }, [anchor, edit, onDraft, pending, busy, conflict, copy.failed, canvasDraft?.draft, canvasDraft?.selection, state?.canvas?.objects]);
  const current = Boolean(state && state.enabled && state.editable !== false && state.revision === state.latestRevision && !state.dirty && !conflict);
  const settle = async (result: Result, working = edit) => {
    if (result.status === "pending") return false;
    if (result.status === "conflict") { await onDraft({ ...working, request: result.sourceConflict?.needsResolution ? working.request : undefined, sourceConflict: result.sourceConflict }); await onConflict?.(); return false; }
    const id = result.artifactRef?.artifactId ?? result.artifactId; if (!id) throw new Error("Saved version is unavailable");
    await onDraft({ ...working, request: undefined, sourceConflict: undefined, ...(working.request?.action === "patch" ? { anchor: null, value: "" } : {}) }); onCommitted(id); return true;
  };
  const settleCanvas = async (result: Result, working: CanvasEdit) => {
    if (!onCanvasDraft || result.status === "pending") return false;
    if (result.status === "conflict") { await onCanvasDraft({ ...working, request: result.sourceConflict?.needsResolution ? working.request : undefined, draft: result.sourceConflict?.needsResolution ? undefined : working.request?.operations ?? working.draft, sourceConflict: result.sourceConflict }); await onConflict?.(); return false; }
    const id = result.artifactRef?.artifactId ?? result.artifactId; if (!id) throw new Error("Saved version is unavailable");
    await onCanvasDraft({ ...working, request: undefined, draft: undefined, sourceConflict: undefined }); await onDraft({ ...edit, value: "", anchor: null, request: undefined, sourceConflict: undefined }); onCommitted(id, working.request?.operations); return true;
  };
  const admitted = () => { if (canCommit?.() !== false) return true; setError(copy.failed); return false; };
  const run = async (input: Command, working = edit) => {
    if (!admitted()) return false;
    if (lock.current || pending || (input.action === "restore" ? !state?.enabled || conflict : !current)) return false; lock.current = true; setBusy(true); setError(""); let submitted = false;
    try { const submittedEdit = { ...working, request: input as DesignEdit["request"], sourceConflict: undefined }; await onDraft(submittedEdit); submitted = true; return await settle(await host.workspace!(input) as Result, submittedEdit); }
    catch (cause) {
      if (!submitted || refused(cause)) await onDraft({ ...working, request: undefined }).catch(() => {});
      if (cause instanceof Error && /REVISION_CONFLICT|SOURCE_CHANGED|artifact-conflict/.test(cause.message)) await onConflict?.().catch(() => {});
      setError(cause instanceof Error && /SOURCE_CHANGED/.test(cause.message) ? copy.sourceChanged : copy.failed); return false;
    } finally { lock.current = false; setBusy(false); }
  };
  const restore = async (revision: number, historyAction?: "undo" | "redo") => {
    if (!state || !admitted()) return false;
    const latest = state.versions.find(version => version.revision === state.latestRevision); if (!latest) return false;
    const live = historyAction ? state : await host.workspace!({ action: "read", artifactId: latest.artifactId }) as WorkspaceRead;
    return run({ action: "restore", artifactId: latest.artifactId, targetRevision: revision, historyAction, expectedRevision: live.revision, readSetDigest: live.readSetDigest, generation: live.generation, requestId: crypto.randomUUID() });
  };
  const recover = async (resolve = false) => {
    const request = canvasDraft?.request ?? edit.request; if (!request || !state || lock.current) return false; lock.current = true; setBusy(true); setError("");
    try {
      let result = await host.workspace!({ action: resolve ? "resolve-edit" : "operation-status", artifactId: request.artifactId, requestId: request.requestId, ...(resolve ? { generation: state.generation } : {}) }) as Result;
      if (result.status === "pending" && result.recovery?.status === "paused") result = await host.workspace!({ action: "resume-edit", artifactId: request.artifactId, requestId: request.requestId, generation: state.generation }) as Result;
      return await (canvasDraft?.request ? settleCanvas(result, canvasDraft) : settle(result));
    } catch { setError(copy.failed); return false; } finally { lock.current = false; setBusy(false); }
  };
  const canvas = async (artifactId: string, operations: CanvasOperation[], working = canvasDraft) => {
    if (!admitted()) return false;
    if (!state || !current || !working || !onCanvasDraft || lock.current || pending) return false;
    lock.current = true; setBusy(true); setError(""); let submitted = false, request: CanvasRequest | undefined;
    try {
      request = { action: "canvas", artifactId, generation: state.generation, expectedRevision: state.revision, readSetDigest: state.readSetDigest, requestId: crypto.randomUUID(), operations: canvasOperationsSchema.parse(operations) };
      const submittedDraft = { ...working, draft: undefined, request, sourceConflict: undefined }; await onCanvasDraft(submittedDraft); submitted = true;
      return await settleCanvas(await host.workspace!(request) as Result, submittedDraft);
    } catch (cause) {
      if (!submitted || refused(cause)) await onCanvasDraft({ ...working, draft: request?.operations ?? operations, request: undefined }).catch(() => {});
      if (cause instanceof Error && /REVISION_CONFLICT|SOURCE_CHANGED|artifact-conflict/.test(cause.message)) await onConflict?.().catch(() => {});
      setError(cause instanceof Error && /SOURCE_CHANGED/.test(cause.message) ? copy.sourceChanged : copy.failed); return false;
    } finally { lock.current = false; setBusy(false); }
  };
  return { edit, canvasDraft, busy, pending, error, current, snapshotRef: state?.snapshotRef, restore, recover, canvas, change: (value: DesignEdit) => { void onDraft(value).catch(() => setError(copy.failed)); },
    changeCanvas: (value: CanvasEdit) => onCanvasDraft?.(value).catch(() => setError(copy.failed)),
    save: (artifactId: string) => { if (!edit.anchor || !state) return; return run({ action: "patch", artifactId, generation: state.generation, expectedRevision: state.revision, readSetDigest: state.readSetDigest, requestId: crypto.randomUUID(), anchor: edit.anchor, property: edit.property, value: edit.value }); } };
}
export type DesignEditController = ReturnType<typeof useDesignEdits>;
