/**
 * [INPUT]: Original scoped workspace catalog, displayed immutable version history, header title/status content and owner-guarded version navigation; catalog-owned labels use the shared formatCopy formatter.
 * [OUTPUT]: One shared catalog with isolated reader/timer ownership, a header work/version menu and compact explicit current-version links.
 * [POS]: Work navigation reader; catalog reads never register documents or import old source.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { formatCopy } from "@ai-chat/ui/lib/workbench-copy/format";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@ai-chat/ui/components/ui/dropdown-menu";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import type { WorkspaceRead } from "@ai-chat/cloud-protocol/artifacts/design/model";
import { useArtifactHost, type ArtifactHost } from "../context";
import { workspaceCopy } from "./copy";
export type ArtifactWork = { documentId: string; title: string; revision: number; dirty: boolean; artifactRef: { artifactId: string }; fence?: ArtifactFence; format?: string };
type Catalog = { works: ArtifactWork[]; listeners: Set<() => void>; timer?: ReturnType<typeof setInterval>; flight?: Promise<void>; load(): void };
const catalogs = new WeakMap<NonNullable<ArtifactHost["workspace"]>, Catalog>();
function createCatalog(workspace: NonNullable<ArtifactHost["workspace"]>): Catalog {
  const next: Catalog = { works: [], listeners: new Set(), load() {
    if (next.flight) return;
    next.flight = workspace({ action: "list" }).then(value => { next.works = (value as { documents: ArtifactWork[] }).documents; for (const notify of next.listeners) notify(); }).catch(() => {}).finally(() => { next.flight = undefined; });
  } };
  return next;
}
export function useArtifactCatalog() {
  const host = useArtifactHost()!, [, refresh] = useState(0);
  let catalog = host.workspace ? catalogs.get(host.workspace) : undefined;
  if (!catalog && host.workspace) { catalog = createCatalog(host.workspace); catalogs.set(host.workspace, catalog); }
  useEffect(() => {
    if (!catalog) return; const notify = () => refresh(value => value + 1); catalog.listeners.add(notify); catalog.load();
    catalog.timer ??= setInterval(catalog.load, 5_000);
    return () => { catalog.listeners.delete(notify); if (!catalog.listeners.size) { clearInterval(catalog.timer); catalog.timer = undefined; } };
  }, [catalog]);
  return catalog?.works ?? [];
}
export function ArtifactDirectory({ state, artifactId, onVersion, children }: { state: WorkspaceRead; artifactId: string; onVersion(id: string): void; children: ReactNode }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), works = useArtifactCatalog(), [failed, setFailed] = useState(false);
  const others = works.filter(work => work.documentId !== state.documentId);
  return <nav data-workspace-directory="" aria-label={copy.works} className="flex min-w-0 items-center gap-2"><DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="ghost" aria-label={copy.works} className="-ml-2 min-h-[44px] min-w-0 max-w-full justify-start gap-2 px-2 py-1 text-left font-normal [-webkit-app-region:no-drag]">
      {children}<ChevronDown className="size-4 shrink-0" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent side="bottom" align="start" className="w-72 max-w-[calc(100vw-24px)]" data-workspace-directory-menu="" data-canvas-chrome="">
      <DropdownMenuLabel className="truncate" title={state.title}>{state.title}</DropdownMenuLabel>
      {state.revision < state.latestRevision && <DropdownMenuItem className="min-h-[44px]" onSelect={() => {
        setFailed(false); const latest = state.versions.find(version => version.revision === state.latestRevision); if (latest) onVersion(latest.artifactId);
      }}>{copy.current}</DropdownMenuItem>}
      <DropdownMenuRadioGroup aria-label={copy.version} value={artifactId} onValueChange={id => { setFailed(false); if (id !== artifactId) onVersion(id); }}>
        {[...state.versions].sort((left, right) => right.revision - left.revision).map(version => <DropdownMenuRadioItem key={version.artifactId} value={version.artifactId} className="min-h-[44px]">{formatCopy(copy.revisionTag, { revision: version.revision })}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {others.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>{copy.works}</DropdownMenuLabel>{others.map(work => <DropdownMenuItem key={work.documentId} className="min-h-[44px]" onSelect={() => {
        setFailed(false); void host.workspace!({ action: "read", artifactId: work.artifactRef.artifactId }).then(value => host.open((value as { fence: ArtifactFence }).fence, host.followUp)).catch(() => setFailed(true));
      }}><span className="truncate">{work.title} · {formatCopy(copy.revisionTag, { revision: work.revision })}</span></DropdownMenuItem>)}</>}
    </DropdownMenuContent>
  </DropdownMenu>{failed && <span role="alert" className="text-xs">{copy.failed}</span>}</nav>;
}
export function CurrentVersionLink({ fence }: { fence: ArtifactFence }) {
  const host = useArtifactHost()!, copy = workspaceCopy(host.locale), works = useArtifactCatalog(), latest = works.find(work => work.documentId === fence.design?.documentId), [failed, setFailed] = useState(false);
  if (!latest || latest.revision <= (fence.design?.revision ?? 0)) return null;
  return <><button type="button" data-action="current-version" className="min-h-[44px] text-xs text-muted-foreground underline hover:text-foreground" onClick={() => {
    setFailed(false); void host.workspace!({ action: "read", artifactId: latest.artifactRef.artifactId }).then(value => host.open((value as { fence: ArtifactFence }).fence, host.followUp)).catch(() => setFailed(true));
  }}>{copy.current} · {formatCopy(copy.revisionTag, { revision: latest.revision })}</button>{failed && <span role="alert" className="text-xs">{copy.failed}</span>}</>;
}
