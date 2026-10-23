/**
 * [INPUT]: Validated artifact fences and current host capabilities, including the active draft callback.
 * [OUTPUT]: Scope-bound capture recovery, preview-first design cards, expanded workspace chrome and file actions.
 * [POS]: Shared artifact presentation; native file paths and account keys stay outside the renderer.
 */
import { File, Expand, Minimize2 } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { decodeArtifactFence, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost, useArtifactPresentation } from "./context";
import { artifactCopy } from "./copy";
import { ArtifactFrame } from "./frame";
import { ArtifactImport } from "./import-dialog";
import { LivePreviewCard } from "./live/card";
import { DesignArtifactCard } from "./presentation/design-card";
import { ArtifactHeader, ArtifactLoading, fullLabel } from "./presentation/header";
const inlineKinds = new Set(["html-fragment", "html-document", "static-site", "svg", "markdown"]);
const Workspace = lazy(() => import("./workspace/view").then(module => ({ default: module.ArtifactWorkspaceView })));
export function ArtifactCard({ fence: original, expanded = false }: { fence: ArtifactFence; expanded?: boolean }) {
  const [recovered, setRecovered] = useState<{ scope: string; fence: ArtifactFence } | null>(null);
  const presentation = useArtifactPresentation(), host = useArtifactHost(), copy = artifactCopy(host?.locale ?? "en"), [error, setError] = useState(false), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const fence = recovered?.scope === host?.scope && recovered?.fence.id === original.id ? recovered.fence : original;
  const design = Boolean(fence.design);
  useEffect(() => { let current = true; if (original.rejected && host?.recover) void host.recover(original, false).then(value => { if (current) setRecovered(value ? { scope: host.scope, fence: value } : null); }).catch(() => {}); return () => { current = false; }; }, [original, host]);
  const recoveryEpoch = useRef(0);
  useLayoutEffect(() => { const epoch = ++recoveryEpoch.current; queueMicrotask(() => { if (epoch === recoveryEpoch.current) { setBusy(false); setError(false); } }); return () => { recoveryEpoch.current = epoch + 1; }; }, [original.id, host?.scope]);
  const retryCapture = async () => { if (!host?.recover || busy) return; const epoch = recoveryEpoch.current; setBusy(true); setError(false);
    try { const value = await host.recover(original, true); if (epoch === recoveryEpoch.current) { if (value) setRecovered({ scope: host.scope, fence: value }); else setError(true); } }
    catch { if (epoch === recoveryEpoch.current) setError(true); } finally { if (epoch === recoveryEpoch.current) setBusy(false); } };
  useEffect(() => { host?.remember?.(fence); }, [host, fence]);
  const run = async (action: "quick-look" | "reveal" | "open" | "save") => {
    if (!host || busy) return; setBusy(true); setError(false);
    try { await host.action(fence, action, host.followUp); } catch { setError(true); } finally { setBusy(false); }
  };
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  if (fence.rejected || !host) return <>{design && expanded && <ArtifactHeader title={fence.title} />}<div role="status" className="my-3 rounded-lg border p-4 text-sm">{fence.rejected && ["missing", "unreadable", "changed", "storage", "publish"].includes(fence.rejected) ? copy[fence.rejected as "missing" | "unreadable" | "changed" | "storage" | "publish"] : fence.rejected === "interrupted" ? copy.interrupted : fence.rejected === "budget" ? copy.budget : fence.rejected === "too-large" ? copy.tooLarge : fence.rejected === "not-utf8" ? copy.encoding : fence.rejected === "symlink" || fence.rejected === "path-denied" ? copy.pathDenied : copy.unavailable}{host?.recover && fence.rejected && ["missing", "changed", "storage", "publish", "unavailable"].includes(fence.rejected) && <Button disabled={busy} onClick={() => void retryCapture()}>{copy.retry}</Button>}{error && <p role="alert">{copy.failed}</p>}</div></>;
  if (design && expanded) return host.workspace ? <Suspense fallback={<ArtifactLoading title={fence.title} />}><Workspace fence={fence} /></Suspense> : <div className="flex min-h-0 flex-1 flex-col"><ArtifactHeader title={fence.title} /><p role="status" className="p-4 text-sm">{copy.unavailable}</p></div>;
  const open = () => { setError(false); void Promise.resolve().then(() => host.open(fence, host.followUp)).catch(() => setError(true)); };
  if (design) return <DesignArtifactCard fence={fence} busy={busy} error={error} open={open} save={() => void run("save")} />;
  const copyText = (value: string) => { void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setError(true)); };
  const media = host.desktop && ["pdf", "image"].includes(fence.kind);
  const inline = inlineKinds.has(fence.kind), top = fence.kind === "static-site" && host.directoryTopLevel;
  const action = (name: "quick-look" | "reveal" | "open" | "save", label: string) => <Button variant="ghost" size="sm" type="button" disabled={busy} className="relative touch-target-44" onClick={() => void run(name)}>{label}</Button>;
  return <section aria-label={`${fence.title} · ${inline ? copy.visualization : copy.file}`} className={expanded ? "flex min-h-0 flex-1 flex-col overflow-hidden bg-card text-card-foreground" : "my-3 overflow-hidden rounded-lg border bg-card text-card-foreground"} data-artifact-id={fence.id}>
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-1">
      <strong className="flex min-w-0 flex-1 items-center gap-2 text-sm">{!inline && <File aria-hidden className="size-4 shrink-0" />}<span className="truncate">{fence.title}</span></strong>
      {expanded && presentation?.canExpand && <Button variant="ghost" size="sm" type="button" className="min-h-[44px]" aria-label={presentation.full ? fullLabel(host.locale, true) : fullLabel(host.locale)} onClick={() => presentation.setFull(!presentation.full)}>{presentation.full ? <Minimize2 className="size-4" /> : <Expand className="size-4" />}</Button>}
      {(inline || media) && !expanded && <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={open}>{top ? copy.browser : host.sidePanel ? copy.panel : copy.preview}</Button>}
      {fence.kind === "claude-artifact" ? <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={open}>{copy.browser}</Button> : fence.kind !== "live-app" && action("save", copy.save)}
    </header>
    {(inline && !top || media && expanded) ? <ArtifactFrame fence={fence} expanded={expanded} /> : <div className="px-3 py-2 text-sm">
      {fence.kind === "live-app" ? <LivePreviewCard fence={fence} /> : fence.kind !== "claude-artifact" && <p>{fence.kind.toUpperCase()} · {Intl.NumberFormat(host.locale, { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format((fence.bytes ?? 0) / 1024)}{fence.createdAt && <> · <time dateTime={new Date(fence.createdAt).toISOString()}>{new Intl.DateTimeFormat(host.locale, { dateStyle: "medium", timeStyle: "short" }).format(fence.createdAt)}</time></>}</p>}
      {fence.kind !== "claude-artifact" && fence.kind !== "live-app" && <div className="flex flex-wrap gap-2">
        {host.desktop && action("quick-look", copy.quick)}{action("open", copy.open)}{host.desktop && action("reveal", copy.reveal)}
        {fence.kind === "xlsx" && <ArtifactImport fence={fence} />}
      </div>}
    </div>}
    {inline && <div className="flex flex-wrap gap-2 px-3 text-sm">{host.desktop && action("reveal", copy.reveal)}<Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={() => copyText(fence.title)}>{copy.copyTitle}</Button></div>}
    {fence.kind === "claude-artifact" && <div className="flex flex-wrap gap-2 px-3 text-sm"><Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={() => copyText(fence.url!)}>{copy.copyLink}</Button>{action("open", copy.external)}</div>}
    {copied && <p role="status" className="px-3 text-sm">{copy.copied}</p>}
    {fence.location === "workspace" && <p className="px-3 text-sm text-muted-foreground">{copy.workspace}</p>}
    {fence.collection === "dependencies" && <p className="px-3 text-sm text-muted-foreground">{copy.dependencies}</p>}
    {fence.collection === "entry-only" && <p className="px-3 text-sm text-muted-foreground">{copy.entryOnly}</p>}
    {error && <p role="alert" className="px-3 text-sm">{copy.failed}</p>}
  </section>;
}

export function ArtifactCodeBlock({ code }: { code: string }) {
  const host = useArtifactHost(), fence = useMemo(() => decodeArtifactFence(code), [code]);
  return fence ? <ArtifactCard key={host?.scope + fence.id} fence={fence} /> : <p role="status">{artifactCopy(host?.locale ?? "en").unavailable}</p>;
}
