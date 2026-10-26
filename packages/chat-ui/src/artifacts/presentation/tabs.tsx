/**
 * [INPUT]: Owner-scoped immutable Artifact fences, original-composer callbacks and guarded panel presentation.
 * [OUTPUT]: Session-only Artifact tab identities, bounded owner memory and lazy active-tab content.
 * [POS]: Shared Artifact tab boundary for native and remote third-column hosts; no fences or callbacks are persisted.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ArtifactHostProvider, ArtifactPresentationProvider, useArtifactHost, type ArtifactHost, type ArtifactPresentation } from "../context";
import { ArtifactPreview } from "../renderer";
import { useArtifactCloseGuard } from "../lifecycle/close";

export type ArtifactTabId = `artifact:${string}`;
export type ArtifactTabValue = { fence: ArtifactFence; followUp?: ArtifactHost["followUp"] };
export const isArtifactTab = (id: unknown): id is ArtifactTabId => typeof id === "string" && /^artifact:[A-Za-z0-9_-]{1,128}$/.test(id);
export const artifactTabId = (fence: ArtifactFence): ArtifactTabId => `artifact:${fence.id}`;
const empty: ReadonlyMap<ArtifactTabId, ArtifactTabValue> = new Map();
const owners = new Map<string, ReadonlyMap<ArtifactTabId, ArtifactTabValue>>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function rememberArtifactTab(scope: string, fence: ArtifactFence, followUp?: ArtifactHost["followUp"]) {
  const id = artifactTabId(fence), previous = owners.get(scope)?.get(id);
  if (previous?.fence === fence && previous.followUp === followUp) return id;
  const values = new Map(owners.get(scope));
  values.set(id, { fence, followUp }); owners.delete(scope); owners.set(scope, values);
  if (owners.size > 64) owners.delete(owners.keys().next().value!);
  for (const listener of listeners) listener();
  return id;
}
export function useArtifactTabs(scope: string) {
  const read = () => owners.get(scope) ?? empty;
  return useSyncExternalStore(subscribe, read, read);
}

export function useArtifactTabGuard(owner: unknown) {
  const { beforeClose, close, failed } = useArtifactCloseGuard(), committed = useRef<unknown>(null);
  useLayoutEffect(() => { committed.current = owner; return () => { if (committed.current === owner) committed.current = null; }; }, [owner]);
  const current = useCallback(() => committed.current === owner, [owner]);
  const navigate = useCallback((action: () => void) => close(action, current), [close, current]);
  return { beforeClose, close: navigate, failed };
}

export function ArtifactTab({ value, presentation, onFollowUp }: { value: ArtifactTabValue; presentation: ArtifactPresentation; onFollowUp?(): void }) {
  const host = useArtifactHost(), active = useRef<ArtifactTabValue | null>(null), afterFollowUp = useRef(onFollowUp);
  useLayoutEffect(() => { afterFollowUp.current = onFollowUp; }, [onFollowUp]);
  useLayoutEffect(() => { active.current = value; return () => { if (active.current === value) active.current = null; }; }, [value]);
  const followUp = value.followUp ?? host?.followUp;
  const adapted = useMemo(() => host ? { ...host, followUp: followUp ? async (request: Parameters<NonNullable<ArtifactHost["followUp"]>>[0]) => {
    if (active.current !== value) return;
    await followUp(request);
    if (active.current === value) afterFollowUp.current?.();
  } : undefined } : null, [host, followUp, value]);
  return <ArtifactHostProvider value={adapted}><ArtifactPresentationProvider value={presentation}>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden text-sm"><ArtifactPreview fence={value.fence} expanded /></div>
  </ArtifactPresentationProvider></ArtifactHostProvider>;
}
