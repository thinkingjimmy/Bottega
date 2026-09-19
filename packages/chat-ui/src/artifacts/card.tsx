/**
 * [INPUT]: Validated artifact fences and current host capabilities, including the active draft callback.
 * [OUTPUT]: Inline previews, document cards, Claude links and local service status with recoverable actions.
 * [POS]: Shared artifact presentation; native file paths and account keys stay outside the renderer.
 */
import { Button } from "@ai-chat/ui/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { decodeArtifactFence, type ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { useArtifactHost } from "./context";
import { artifactCopy } from "./copy";
import { ArtifactFrame } from "./frame";
import { ArtifactImport } from "./import-dialog";
const inlineKinds = new Set(["html-fragment", "html-document", "static-site", "svg", "markdown"]);
export function ArtifactCard({ fence, expanded = false }: { fence: ArtifactFence; expanded?: boolean }) {
  const host = useArtifactHost(), copy = artifactCopy(host?.locale ?? "en"), [error, setError] = useState(false), [busy, setBusy] = useState(false), [copied, setCopied] = useState(false);
  const run = async (action: "quick-look" | "reveal" | "open" | "save") => {
    if (!host || busy) return; setBusy(true); setError(false);
    try { await host.action(fence, action, host.followUp); } catch { setError(true); } finally { setBusy(false); }
  };
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  if (fence.rejected || !host) return <div role="status" className="my-3 rounded-lg border p-4 text-sm">{fence.rejected === "interrupted" ? copy.interrupted : fence.rejected === "budget" ? copy.budget : fence.rejected === "too-large" ? copy.tooLarge : fence.rejected === "not-utf8" ? copy.encoding : fence.rejected === "symlink" || fence.rejected === "path-denied" ? copy.pathDenied : copy.unavailable}</div>;
  const open = () => { setError(false); void Promise.resolve().then(() => host.open(fence, host.followUp)).catch(() => setError(true)); };
  const copyText = (value: string) => { void navigator.clipboard.writeText(value).then(() => setCopied(true)).catch(() => setError(true)); };
  const media = host.desktop && ["pdf", "image"].includes(fence.kind);
  const inline = inlineKinds.has(fence.kind), top = fence.kind === "static-site" && host.directoryTopLevel;
  const action = (name: "quick-look" | "reveal" | "open" | "save", label: string) => <Button variant="ghost" size="sm" type="button" disabled={busy} className="relative touch-target-44" onClick={() => void run(name)}>{label}</Button>;
  return <section aria-label={`${fence.title} · ${inline ? copy.visualization : copy.file}`} className="my-3 overflow-hidden rounded-lg border bg-card text-card-foreground" data-artifact-id={fence.id}>
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-1">
      <strong className="flex min-w-0 flex-1 items-center gap-2 text-sm">{!inline && <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6" /></svg>}<span className="truncate">{fence.title}</span></strong>
      {(inline || media) && !expanded && <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={open}>{top ? copy.browser : host.sidePanel ? copy.panel : copy.preview}</Button>}
      {fence.kind === "claude-artifact" ? <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={open}>{copy.browser}</Button> : fence.kind !== "live-app" && action("save", copy.save)}
    </header>
    {(inline && !top || media && expanded) ? <ArtifactFrame fence={fence} expanded={expanded} /> : <div className="px-3 py-2 text-sm">
      {fence.kind === "live-app" ? <p>{fence.service?.lifecycle === "turn" ? copy.stopped : copy.local} <span className="font-mono">127.0.0.1:{fence.service?.port}</span></p> : fence.kind !== "claude-artifact" && <p>{fence.kind.toUpperCase()} · {Intl.NumberFormat(host.locale, { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format((fence.bytes ?? 0) / 1024)}{fence.createdAt && <> · <time dateTime={new Date(fence.createdAt).toISOString()}>{new Intl.DateTimeFormat(host.locale, { dateStyle: "medium", timeStyle: "short" }).format(fence.createdAt)}</time></>}</p>}
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
