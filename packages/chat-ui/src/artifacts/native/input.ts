/**
 * [INPUT]: Exact native workspace revision, mounted view identity and existing checkpoint CAS port.
 * [OUTPUT]: useNativeInput and its shared NativeInputPort serialize native and supplemental System input through one checkpoint writer, rebases one unchanged-input checkpoint race and preserves differing external-source drafts with explicit cross-revision saved/local conflict recovery and original operation references without another store.
 * [POS]: Native review recovery writer; each queued write retains its own original revision/version owner.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { checkpointSchema, type DesignCheckpoint } from "@ai-chat/cloud-protocol/artifacts/design/review";
import { nativeInputSchema, type NativeInput } from "@ai-chat/cloud-protocol/artifacts/design/native/comments";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import type { ArtifactHost } from "../context";
type SystemInput = DesignCheckpoint["system"];
const sameSystem = (left: SystemInput, right: SystemInput) => JSON.stringify(left) === JSON.stringify(right);
const sameInput = (left: NativeInput, right: NativeInput) => JSON.stringify(nativeInputSchema.parse(left)) === JSON.stringify(nativeInputSchema.parse(right));
export function useNativeInput(host: ArtifactHost, state: WorkspaceRead, artifactId: string, viewId: string) {
  const [input, setInput] = useState<NativeInput>(() => state.checkpoint?.native ?? { instruction: "" }), [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState<WorkspaceRead | null>(null);
  const value = useRef(input), tail = useRef<Promise<unknown>>(Promise.resolve()), owners = useRef(new Map<number, { sequence: number; version: number; native: NativeInput; system?: SystemInput }>());
  const save = useCallback(async (next: NativeInput, target = state, targetArtifactId = artifactId, system?: SystemInput) => {
    const native = nativeInputSchema.parse(next);
    const work = tail.current.catch(() => {}).then(async () => {
      let owner = owners.current.get(target.revision);
      if (!owner) { owner = { sequence: 0, version: target.checkpoint?.save?.version ?? 0, native: target.checkpoint?.native ?? { instruction: "" }, system: target.checkpoint?.system }; owners.current.set(target.revision, owner); if (owners.current.size > 64) owners.current.delete(owners.current.keys().next().value!); }
      const expected = owner, nextSystem = system ?? expected.system;
      const checkpoint = checkpointSchema.parse({ documentId: target.documentId, revision: target.revision,
        boardId: target.manifest.launchBoard, notes: target.checkpoint?.notes ?? [], native, ...(nextSystem ? { system: nextSystem } : {}) });
      const write = async () => await host.workspace!({ action: "checkpoint", artifactId: targetArtifactId, generation: target.generation,
        checkpoint: { ...checkpoint, save: { viewId, sequence: ++expected.sequence, version: expected.version } } }) as { checkpointVersion: number };
      let result: { checkpointVersion: number };
      try { result = await write(); }
      catch (cause) {
        const current = await host.workspace!({ action: "native-head", artifactId: targetArtifactId }) as WorkspaceRead;
        if (current.documentId !== target.documentId || current.revision !== target.revision || current.generation !== target.generation) throw cause;
        const stored = current.checkpoint?.native ?? { instruction: "" }, version = current.checkpoint?.save?.version ?? 0;
        if (sameInput(stored, native) && sameSystem(current.checkpoint?.system, nextSystem)) result = { checkpointVersion: version };
        else if (sameInput(stored, expected.native) && sameSystem(current.checkpoint?.system, expected.system)) { expected.version = version; result = await write(); }
        else throw cause;
      }
      expected.version = result.checkpointVersion; expected.native = native; expected.system = nextSystem; setFailed(false); setConflict(null); return result;
    });
    tail.current = work; void work.catch(() => {
      setFailed(true);
      void host.workspace!({ action: "native-head", artifactId: targetArtifactId }).then(result => { const next = result as WorkspaceRead; if (next.documentId === target.documentId && next.revision >= target.revision) setConflict(current => current && current.revision > next.revision ? current : next); }).catch(() => {});
    }); return work;
  }, [host, state, artifactId, viewId]);
  const saveSystem = useCallback((system: NonNullable<SystemInput>, target: WorkspaceRead, targetArtifactId: string) => {
    if (target.documentId !== state.documentId || target.manifest.format !== "bottega-design-system")
      return Promise.reject(new Error("The system input belongs to another document"));
    return save(value.current, target, targetArtifactId, system);
  }, [save, state.documentId]);
  const update = useCallback((next: NativeInput) => { value.current = next; setInput(next); return save(next); }, [save]);
  useEffect(() => { if (JSON.stringify(value.current) !== JSON.stringify(state.checkpoint?.native ?? { instruction: "" })) void save(value.current).catch(() => {}); }, [state.revision, state.checkpoint, save]);
  const flush = useCallback(async () => { await tail.current; }, []);
  const carry = useCallback(async (target: WorkspaceRead, external = false) => {
    if (!external) return save(value.current, target, target.fence!.id);
    const local = value.current, stored = target.checkpoint?.native ?? { instruction: "" };
    if (sameInput(local, { instruction: "" }) || sameInput(local, stored)) { setFailed(false); setConflict(null); return; }
    if (!sameInput(stored, { instruction: "" })) { setFailed(true); setConflict(target); throw new Error("Choose which native input to keep before reloading"); }
    try { return await save(local, target, target.fence!.id); }
    catch (cause) {
      const current = await host.workspace!({ action: "native-head", artifactId: target.fence!.id }) as WorkspaceRead;
      if (current.documentId === target.documentId && current.generation === target.generation && current.revision >= target.revision &&
        sameInput(local, current.checkpoint?.native ?? { instruction: "" })) { setFailed(false); setConflict(null); return; }
      if (current.documentId === target.documentId && current.revision >= target.revision) setConflict(current);
      throw cause;
    }
  }, [save, host]);
  const recover = useCallback(async (next: NativeInput) => {
    if (!conflict || conflict.revision < state.revision || conflict.documentId !== state.documentId || conflict.generation !== state.generation)
      throw new Error("Reopen the current document before recovering input");
    const previous = owners.current.get(conflict.revision);
    owners.current.set(conflict.revision, { sequence: previous?.sequence ?? 0, version: conflict.checkpoint?.save?.version ?? 0, native: conflict.checkpoint?.native ?? { instruction: "" }, system: conflict.checkpoint?.system });
    value.current = nativeInputSchema.parse(next); setInput(value.current); await save(value.current, conflict, conflict.fence!.id);
  }, [conflict, state, save]);
  return { input, update, saveSystem, flush, carry, failed, conflict, recover, current: value };
}

export type NativeInputPort = ReturnType<typeof useNativeInput>;
