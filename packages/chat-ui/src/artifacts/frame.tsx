/**
 * [INPUT]: Authorized immutable leases, theme tokens, exact iframe messages and host user activation.
 * [OUTPUT]: Lazy sandboxed artifact frames with bounded sizing, revocation, sync-aware recovery and validated follow-ups.
 * [POS]: Shared artifact frame host; never reads or trusts child DOM or child activation claims.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactFence } from "@ai-chat/cloud-protocol/turns/text/artifact-reference";
import { ARTIFACT_THEME_TOKENS } from "@ai-chat/cloud-protocol/artifacts/theme";
import { ArtifactFollowUpGuard, artifactMessageSource } from "@ai-chat/cloud-protocol/artifacts/frame-security";
import { Button } from "@ai-chat/ui/components/ui/button";
import { MessageResponse } from "@ai-chat/ui/components/ai-elements/message";
import { useArtifactHost, type ArtifactLease } from "./context";
import { artifactCopy } from "./copy";
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
    if (!retained) return;
    return requestArtifactFrame(() => setAdmitted(true), () => setAdmitted(false), expanded ? 2 : visible ? 1 : 0);
  }, [retained, visible, expanded]);
  useEffect(() => {
    if (!host || !admitted) return;
    let alive = true, obtained: ArtifactLease | undefined;
    const controller = new AbortController();
    let renewal: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => { if (alive) setFailure("failed"); }, 30_000);
    void host.acquire(fence).then(async value => {
      obtained = value; clearTimeout(timeout); if (!alive) { host.release(value); return; } setLease(value); setAutomatic(0);
      renewal = setTimeout(() => setAttempt(value => value + 1), Math.max(1000, value.expiresAt - Date.now() - 10_000));
      if (fence.kind === "markdown") {
        const response = await fetch(value.url, { signal: controller.signal, credentials: "omit" });
        if (!response.ok) throw new Error("artifact-read-failed");
        const text = await response.text(); if (alive) setMarkdown(text);
      }
    }).catch(error => { clearTimeout(timeout); if (alive) setFailure(classifyFailure(error)); });
    return () => { alive = false; clearTimeout(timeout); clearTimeout(renewal); controller.abort(); if (obtained) host.release(obtained); setLease(null); };
  }, [host, fence, admitted, attempt]);
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
      if (event.data.type === "bottega:artifact:ready") { clearTimeout(readyTimer); theme(); }
      if (event.data.type === "bottega:artifact:shell-ready" && frame.current?.contentWindow) lease.mount?.(frame.current.contentWindow);
      if (event.data.type === "bottega:artifact:size" && Number.isFinite(event.data.height) && Date.now() - lastSize > 40) {
        lastSize = Date.now(); setHeight(Math.max(80, Math.min(100_000, Math.ceil(event.data.height))));
      }
      if (event.data.type === "bottega:artifact:escape") root.current?.focus();
      if (event.data.type === "bottega:artifact:error") setFailure("failed");
      if (event.data.type === "bottega:artifact:follow-up") {
        const accepted = guard.current.accept(event.data.payload, navigator.userActivation?.isActive === true);
        if (accepted && host.followUp) { host.followUp({ ...accepted, title: accepted.title ?? fence.title }); setBlocked(false); }
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
  return <div ref={root} tabIndex={-1} style={{ minHeight: 80, outlineOffset: 2 }}>
    {failure ? waiting ? <div role="status" className="px-3 py-2 text-sm text-muted-foreground">{copy.syncing}</div> :
      <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">{failure === "pending" ? copy.syncPending : failure === "sync" ? copy.syncRequired : copy.unavailable}
        <Button variant="outline" size="sm" type="button" className="relative touch-target-44" onClick={retry}>{copy.retry}</Button></div> :
      fence.kind === "markdown" && markdown !== null ? <div style={{ maxHeight: expanded ? undefined : viewport * 2, overflow: "hidden" }}><MessageResponse>{markdown}</MessageResponse></div> :
      admitted && lease && fence.kind === "image" ? <img src={source} alt={fence.title} style={{ display: "block", width: "100%", maxHeight: expanded ? undefined : viewport * 2, objectFit: "contain" }} onError={() => setFailure("failed")} /> :
      admitted && lease && fence.kind !== "markdown" ? <iframe ref={frame} onError={() => setFailure("failed")} src={source} title={fence.title} sandbox={fence.kind === "pdf" ? undefined : lease.sandbox} referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" scrolling={fence.kind === "pdf" ? "auto" : "no"}
        style={{ display: "block", border: 0, width: "100%", height: fence.kind === "pdf" ? "75vh" : fullHeight, background: "transparent" }} /> :
      <div role="status" style={{ height: fullHeight }}>{copy.loading}</div>}
    {blocked && <p role="status" className="px-3 text-sm text-muted-foreground">{copy.blocked}</p>}
    {!expanded && height > viewport * 2 && <Button variant="ghost" size="sm" type="button" className="relative touch-target-44" onClick={() => { void Promise.resolve(host?.open(fence, host?.followUp)).catch(() => setFailure("failed")); }}>{copy.expand}</Button>}
  </div>;
}
