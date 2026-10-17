/**
 * [INPUT]: Original scoped workspace catalog and fixed Artifact card identity.
 * [OUTPUT]: One shared catalog, central work picker and compact explicit current-version links.
 * [POS]: Work navigation reader; catalog reads never register documents or import old source.
 */
import { useEffect, useState } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost, type ArtifactHost } from "../context";
import { workspaceCopy } from "./copy";
export type ArtifactWork = { documentId: string; title: string; revision: number; dirty: boolean; artifactRef: { artifactId: string }; fence?: ArtifactFence; format?: string };
type Catalog = { works: ArtifactWork[]; listeners: Set<() => void>; timer?: ReturnType<typeof setInterval>; flight?: Promise<void>; load(): void };
const catalogs = new WeakMap<NonNullable<ArtifactHost["workspace"]>, Catalog>();
export function useArtifactCatalog() {
  const host = useArtifactHost()!, [, refresh] = useState(0);
  let catalog = host.workspace ? catalogs.get(host.workspace) : undefined;
  if (!catalog && host.workspace) {
    const workspace = host.workspace, next: Catalog = { works: [], listeners: new Set(), load() {
      if (next.flight) return;
      next.flight = workspace({ action: "list" }).then(value => { next.works = (value as { documents: ArtifactWork[] }).documents; for (const notify of next.listeners) notify(); }).catch(() => {}).finally(() => { next.flight = undefined; });
    } }; catalogs.set(workspace, catalog = next);
  }
  useEffect(() => {
    if (!catalog) return; const notify = () => refresh(value => value + 1); catalog.listeners.add(notify); catalog.load();
    catalog.timer ??= setInterval(() => catalog.load(), 5_000);
    return () => { catalog.listeners.delete(notify); if (!catalog.listeners.size) { clearInterval(catalog.timer); catalog.timer = undefined; } };
  }, [catalog]);
  return catalog?.works ?? [];
}
export function ArtifactDirectory({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), works = useArtifactCatalog(), [failed, setFailed] = useState(false);
  return <nav aria-label={copy.works} className="flex min-w-0 items-center gap-2"><select aria-label={copy.works} value={fence.design?.documentId ?? ""} className="min-h-[44px] max-w-56 truncate rounded-md border-0 bg-transparent px-1 text-xs" onChange={event => {
    const work = works.find(work => work.documentId === event.target.value); if (!work) return;
    setFailed(false); void host.workspace!({ action: "read", artifactId: work.artifactRef.artifactId }).then(value => host.open((value as { fence: ArtifactFence }).fence, host.followUp)).catch(() => setFailed(true));
  }}><option value="" disabled>{copy.works}</option>{works.map(work => <option key={work.documentId} value={work.documentId}>{work.title} · v{work.revision}{work.dirty ? " *" : ""}</option>)}</select>{failed && <span role="alert" className="text-xs">{copy.failed}</span>}</nav>;
}
export function CurrentVersionLink({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), works = useArtifactCatalog(), latest = works.find(work => work.documentId === fence.design?.documentId), [failed, setFailed] = useState(false);
  if (!latest || latest.revision <= (fence.design?.revision ?? 0)) return null;
  return <><button type="button" data-action="current-version" className="min-h-[44px] text-xs text-muted-foreground underline hover:text-foreground" onClick={() => {
    setFailed(false); void host.workspace!({ action: "read", artifactId: latest.artifactRef.artifactId }).then(value => host.open((value as { fence: ArtifactFence }).fence, host.followUp)).catch(() => setFailed(true));
  }}>{copy.current} · v{latest.revision}</button>{failed && <span role="alert" className="text-xs">{copy.failed}</span>}</>;
}
