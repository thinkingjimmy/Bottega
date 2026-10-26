/**
 * [INPUT]: Authorized leases, host workspace lifecycle events, theme tokens, exact frame messages and host activation.
 * [OUTPUT]: Owns bounded ordinary preview acquisition/readiness/expiry, fresh iframe contexts on lease-source changes, and releases failed quota slots and late leases.
 * [POS]: Shared artifact frame host; never reads or trusts child DOM or child activation claims.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ARTIFACT_THEME_TOKENS } from "@ai-chat/cloud-protocol/artifacts/theme";
import { ArtifactFollowUpGuard, artifactMessageSource } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import { Button } from "@ai-chat/ui/components/ui/button";
import { LoadingState } from "@ai-chat/ui/components/feedback/loading-state";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { useArtifactHost, type ArtifactLease } from "./context";
import { artifactCopy } from "./copy";
import { PreviewLifetime } from "./lifecycle/lease";
import { requestArtifactFrame } from "./quota";
/** The executing device may not have published the bytes yet; that is a wait, not a dead artifact. */
type ArtifactFailure = "pending" | "sync" | "failed";
const AUTOMATIC_RETRIES = 10;
const classifyFailure = (error: unknown): ArtifactFailure => {
  const message = String((error as { message?: unknown } | null | undefined)?.message ?? error);
  return message.includes("artifact-sync-pending") ? "pending" : message.includes("artifact-sync-unavailable") ? "sync" : "failed";
};
export function ArtifactFrame({ fence, expanded = false }: { fence: ArtifactFence; expanded?: boolean }) {
  const host = useArtifactHost(), copy = artifactCopy(host?.locale ?? "en");
  const root = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null), guard = useRef(new ArtifactFollowUpGuard());
  const [visible, setVisible] = useState(false), [retained, setRetained] = useState(false), [admitted, setAdmitted] = useState(false), [lease, setLease] = useState<ArtifactLease | null>(null);
  const [height, setHeight] = useState(200), [failure, setFailure] = useState<ArtifactFailure | null>(null), [attempt, setAttempt] = useState(0), [markdown, setMarkdown] = useState<string | null>(null);
  const [automatic, setAutomatic] = useState(0), [blocked, setBlocked] = useState(false);
  const lifetime = useRef<PreviewLifetime<ArtifactLease> | null>(null);
  const [pluginOff, setPluginOff] = useState(false);
  useEffect(() => host?.workspaceEvents?.(event => { if (event.type === "changed") setPluginOff(event.enabled === false); }), [host]);
  const [viewport, setViewport] = useState(() => typeof innerHeight === "number" ? innerHeight : 800);
  useEffect(() => {
    const resized = () => setViewport(innerHeight); window.addEventListener("resize", resized); return () => window.removeEventListener("resize", resized);
  }, []);
  useEffect(() => {
    const element = root.current; if (!element) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      setVisible(Boolean(entry?.isIntersecting));
      if (entry?.isIntersecting) setRetained(true);
      else timer = setTimeout(() => setRetained(false), 30_000);
    }, { rootMargin: "0px" });
    observer.observe(element); return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (!retained || pluginOff || failure) return;
    return requestArtifactFrame(() => setAdmitted(true), () => setAdmitted(false), expanded ? 2 : visible ? 1 : 0);
  }, [retained, visible, expanded, pluginOff, failure]);
  useEffect(() => {
    if (!host || !admitted || pluginOff || failure) return;
    const request = new PreviewLifetime<ArtifactLease>(value => host.release(value), () => setFailure("failed"));
    lifetime.current = request; request.acquiring();
    void host.acquire(fence).then(async value => {
      if (!request.accept(value)) return;
      setLease(value); setAutomatic(0);
      if (fence.kind === "markdown") {
        const response = await fetch(value.url, { signal: request.controller.signal, credentials: "omit" });
        if (!response.ok) throw new Error("artifact-read-failed");
        const text = await response.text();
        if (!request.closed) { setMarkdown(text); request.ready(); }
      } else if (fence.kind === "pdf") request.ready();
    }).catch(error => { if (!request.closed) { request.dispose(); setFailure(classifyFailure(error)); } });
    return () => { request.dispose(); if (lifetime.current === request) lifetime.current = null; setLease(null); setMarkdown(null); };
  }, [host, fence, admitted, attempt, pluginOff, failure]);
  useEffect(() => {
    if (!retained || admitted || failure || pluginOff) return;
    const timer = setTimeout(() => setFailure("failed"), 30_000);
    return () => clearTimeout(timer);
  }, [retained, admitted, failure, pluginOff]);
  useEffect(() => {
    if (failure !== "pending" || automatic >= AUTOMATIC_RETRIES) return;
    const timer = setTimeout(() => { setAutomatic(value => value + 1); setFailure(null); setAttempt(value => value + 1); }, Math.min(30_000, 5_000 * 2 ** automatic));
    return () => clearTimeout(timer);
  }, [failure, automatic]);
  useEffect(() => {
    if (!lease || !host) return;
    const expectedOrigin = lease.sandbox === "allow-scripts" ? "null" : lease.origin;
    const theme = () => {
      const style = getComputedStyle(document.documentElement);
      frame.current?.contentWindow?.postMessage({ type: "bottega:artifact:theme", theme: {
        mode: document.documentElement.classList.contains("dark") ? "dark" : "light",
        tokens: Object.fromEntries(ARTIFACT_THEME_TOKENS.map(token => [token, style.getPropertyValue("--" + token).trim()])) } }, expectedOrigin === "null" ? "*" : expectedOrigin);
    };
    let lastSize = 0;
    const readyTimer = ["markdown", "pdf", "image"].includes(fence.kind) ? undefined : setTimeout(() => setFailure("failed"), 20_000);
    const message = (event: MessageEvent) => {
      if (!artifactMessageSource(event, frame.current?.contentWindow, expectedOrigin) || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "bottega:artifact:ready") { clearTimeout(readyTimer); lifetime.current?.ready(); theme(); }
      if (event.data.type === "bottega:artifact:shell-ready" && frame.current?.contentWindow) lease.mount?.(frame.current.contentWindow);
      if (event.data.type === "bottega:artifact:size" && Number.isFinite(event.data.height) && Date.now() - lastSize > 40) {
        lastSize = Date.now(); setHeight(Math.max(80, Math.min(100_000, Math.ceil(event.data.height))));
      }
      if (event.data.type === "bottega:artifact:escape") root.current?.focus();
      if (event.data.type === "bottega:artifact:error") lifetime.current?.fail();
      if (event.data.type === "bottega:artifact:follow-up") {
        const accepted = guard.current.accept(event.data.payload, navigator.userActivation?.isActive === true);
        if (accepted && host.followUp) { void Promise.resolve(host.followUp({ ...accepted, title: accepted.title ?? fence.title })).then(() => setBlocked(false)).catch(() => setBlocked(true)); }
        else setBlocked(true);
      }
    };
    window.addEventListener("message", message);
    const observer = new MutationObserver(theme); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    theme(); return () => { clearTimeout(readyTimer); window.removeEventListener("message", message); observer.disconnect(); };
  }, [lease, host, fence.title, fence.kind]);
  const source = useMemo(() => {
    if (!lease) return undefined;
    const url = new URL(lease.url);
    if (url.protocol !== "blob:") url.searchParams.set("theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
    return url.href;
  }, [lease]);
  const retry = () => { setFailure(null); setAutomatic(0); setAttempt(value => value + 1); };
  const waiting = failure === "pending" && automatic < AUTOMATIC_RETRIES;
  const fullHeight = expanded ? height : Math.min(height, viewport * 2);
  if (pluginOff) return <div ref={root} tabIndex={-1} className="p-4 text-sm" role="status">{copy.unavailable}</div>;
  return <div ref={root} tabIndex={-1} className={expanded ? "min-h-0 flex-1 overflow-auto" : undefined} style={{ minHeight: expanded ? 0 : 80, outlineOffset: 2 }}>
    {failure ? <LoadingState inline locale={host?.locale ?? "en"} failed={!waiting} retry={retry}
      title={failure === "sync" ? copy.syncRequired : undefined} /> :
      fence.kind === "markdown" && markdown !== null ? <div style={{ maxHeight: expanded ? undefined : viewport * 2, overflow: "hidden" }}><MessageResponse>{markdown}</MessageResponse></div> :
      admitted && lease && fence.kind === "image" ? <img onLoad={() => lifetime.current?.ready()} src={source} alt={fence.title} style={{ display: "block", width: "100%", height: expanded ? "100%" : undefined, maxHeight: expanded ? undefined : viewport * 2, objectFit: "contain" }} onError={() => lifetime.current?.fail()} /> :
      admitted && lease && fence.kind !== "markdown" ? <iframe key={source} ref={frame} onError={() => lifetime.current?.fail()} src={source} title={fence.title} sandbox={fence.kind === "pdf" ? undefined : lease.sandbox} referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" scrolling={fence.kind === "pdf" ? "auto" : "no"}
        style={{ display: "block", border: 0, width: "100%", height: expanded ? "100%" : fence.kind === "pdf" ? "75vh" : fullHeight, background: "transparent" }} /> :
      <div style={{ height: fullHeight }} className="flex"><LoadingState locale={host?.locale ?? "en"} /></div>}
    {blocked && <p role="status" className="px-3 text-sm text-muted-foreground">{copy.blocked}</p>}
    {!expanded && height > viewport * 2 && <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={() => { void Promise.resolve(host?.open(fence, host?.followUp)).catch(() => setFailure("failed")); }}>{copy.expand}</Button>}
  </div>;
}
