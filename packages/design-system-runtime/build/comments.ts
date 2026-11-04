/**
 * [INPUT]: Trusted System DOM, original parent token and shared editor comment commands.
 * [OUTPUT]: C/Escape comment mode, nearby source-backed targets and persistent numbered markers.
 * [POS]: System annotation presentation; comments and Chat remain owned by the existing parent stores.
 */
export function installSystemAnnotations(token: string) {
  let mode = false, threads: { id: string; anchor: string; n: number }[] = [];
  const anchors = new Map<string, HTMLElement>();
  const style = document.createElement("style"); style.textContent = "html[data-bottega-comment-mode] iframe{pointer-events:none!important}"; document.head.append(style);
  const post = (value: unknown) => window.parent.postMessage(value, "*");
  const setMode = (on: boolean) => { mode = on; if (on) document.documentElement.setAttribute("data-bottega-comment-mode", ""); else document.documentElement.removeAttribute("data-bottega-comment-mode"); document.documentElement.style.cursor = on ? "crosshair" : ""; post({ type: "editor:mode", on }); };
  const targetFor = (anchor: string) => {
    const known = anchors.get(anchor); if (known?.isConnected) return known;
    try { const id = anchor.startsWith("system:") ? decodeURIComponent(anchor.slice(7)) : ""; return id ? document.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? undefined : undefined; } catch { return undefined; }
  };
  const reveal = (anchor: string) => {
    if (anchor.startsWith("system:")) {
      try { window.dispatchEvent(new CustomEvent("baocut:reveal-comment-target", { detail: { target: decodeURIComponent(anchor.slice(7)) } })); }
      catch { /* Invalid old anchors remain inert. */ }
    }
    const element = targetFor(anchor); element?.scrollIntoView({ block: "center", behavior: "smooth" });
    if (element) {
      element.style.outline = "2px solid #3b82f6";
      setTimeout(() => { element.style.outline = ""; }, 2000);
    }
  };
  const paint = () => {
    document.querySelectorAll("[data-system-pin]").forEach(pin => pin.remove());
    for (const thread of threads) {
      const target = targetFor(thread.anchor); if (!target?.isConnected) continue;
      const rect = target.getBoundingClientRect(), pin = document.createElement("button"); pin.dataset.systemPin = thread.id; pin.textContent = String(thread.n); pin.type = "button"; pin.setAttribute("aria-label", `Comment ${thread.n}`);
      Object.assign(pin.style, { position: "fixed", top: rect.top + "px", left: Math.max(4, rect.right - 24) + "px", zIndex: "500", borderRadius: "50%", width: "24px", height: "24px", border: "0", background: "#3868f9", color: "white", cursor: "pointer" });
      pin.dataset.nativeCommentPin = thread.id; pin.onclick = () => { reveal(thread.anchor); post({ type: "editor:open-thread", id: thread.id }); }; document.body.append(pin);
    }
  };
  window.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window.parent || event.data?.token !== token) return;
    const message = event.data;
    if (message.type === "editor:set-mode") setMode(message.on === true);
    if (message.type === "editor:threads" && Array.isArray(message.threads)) { threads = message.threads; paint(); }
    if (message.type === "editor:reveal") { const target = threads.find(thread => thread.id === message.id); if (target) reveal(target.anchor); }
    if (message.type === "editor:reveal-anchor") reveal(message.anchor);
  });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") { setMode(false); return; }
    const target = event.target as HTMLElement;
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.key.toLowerCase() === "c" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); setMode(!mode); }
  }, true);
  document.addEventListener("click", event => {
    if (!mode || !(event.target instanceof HTMLElement) || event.target.closest("[data-system-pin],[data-uncommentable],[data-mc-scrim],[data-cds-overlay]")) return;
    const target = event.target.closest<HTMLElement>("[data-comment-target]") ?? event.target.closest<HTMLElement>("tr,[data-token-name],article,section,h1,h2,h3") ?? event.target;
    const label = (target.getAttribute("data-comment-name") || target.innerText || target.getAttribute("aria-label") || "Design system").trim().slice(0, 200);
    const text = target.getAttribute("data-id") ?? target.querySelector("code")?.textContent?.trim() ?? label;
    const anchor = "system:" + encodeURIComponent(text).slice(0, 240);
    if (anchors.size >= 256 && !anchors.has(anchor)) { const stale = [...anchors.keys()].find(key => !threads.some(thread => thread.anchor === key)); if (stale) anchors.delete(stale); }
    anchors.set(anchor, target); target.dataset.systemAnchor = anchor;
    event.preventDefault(); event.stopImmediatePropagation();
    post({ type: "editor:compose", requestId: crypto.randomUUID(), anchor, label, file: /^(?:comp|props)-/.test(text) ? "components.json" : "tokens.json", point: { x: event.clientX, y: event.clientY } });
  }, true);
  document.addEventListener("scroll", paint, true); window.addEventListener("resize", paint);
}
