/**
 * [INPUT]: Private original-parent token, exact main-frozen native job endpoint and authenticated save/cancel replies.
 * [OUTPUT]: Concrete original output preview/confirmation, frozen whole-folder jobs with real progress/cancel/retry, verified file Blobs and real private save/cancel outcomes for those same Blobs.
 * [POS]: Trusted editor export bridge; arbitrary renderer bytes cannot be staged or substituted for a main-owned result.
 */
import { nativeFetch } from "./transport";
type Preview = { preview: { id: string; digest: string; outputDigest: string; mode: string; description: string; warnings: string[]; pages: { requestId: string; mime: string; digest: string }[] }; request: { options: Record<string, unknown>; files?: string[] } };
type Delivery = { fence: { id: string; sha256: string; bytes: number; mime: string }; filename: string };
export function nativeDownloads(base: string, token: string | undefined, beforeProduce: () => Promise<void>) {
  const pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
  const staged = new WeakMap<Blob, { requestId: string; delivery: Delivery }>();
  let active = 0;
  window.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window.parent || !token || event.data?.token !== token || event.data.type !== "bottega:native:download-result") return;
    const work = pending.get(event.data.requestId); if (!work) return; pending.delete(event.data.requestId);
    if (event.data.outcome === "saved") work.resolve(); else work.reject(Object.assign(new Error("Native download was not saved"), { code: event.data.outcome === "declined" ? "declined" : "failed" }));
  });
  const headers = (id: string) => ({ "X-Bottega-Native": token!, "X-Bottega-Request": "native-" + id });
  const post = async (id: string, body: unknown) => {
    const response = await nativeFetch(base + "__deck/download", { method: "POST", headers: { ...headers(id), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "The main export job failed");
    return result;
  };
  const digest = async (blob: Blob) => "sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const declined = () => Object.assign(new Error("The export preview was cancelled"), { code: "declined" });
  const dialog = (title: string) => {
    const node = document.createElement("dialog"); node.setAttribute("aria-label", title);
    node.style.cssText = "width:min(1040px,92vw);max-height:90vh;padding:24px;border:1px solid #8886;border-radius:12px;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 16px 64px #0004;";
    const heading = document.createElement("h2"); heading.textContent = title; heading.style.cssText = "font:600 20px system-ui;margin:0 0 16px"; node.append(heading);
    document.body.append(node); node.showModal(); return node;
  };
  const button = (label: string, run: () => void) => { const value = document.createElement("button"); value.type = "button"; value.textContent = label; value.style.cssText = "font:500 14px system-ui;padding:8px 12px;margin:8px 8px 0 0;cursor:pointer"; value.addEventListener("click", run); return value; };
  const choosePptx = () => new Promise<"basic" | "pictures">((resolve, reject) => {
    const node = dialog("Choose a PPTX version"), text = document.createElement("p");
    text.textContent = "This producer does not embed fonts. Review an editable basic-font version or exact slide pictures before downloading."; node.append(text);
    const finish = (variant?: "basic" | "pictures") => { node.remove(); if (variant) resolve(variant); else reject(declined()); };
    node.addEventListener("cancel", event => { event.preventDefault(); finish(); });
    node.append(button("Editable basic fonts", () => finish("basic")), button("Slide pictures", () => finish("pictures")), button("Cancel", () => finish()));
  });
  const review = (result: Preview) => new Promise<void>((resolve, reject) => {
    const node = dialog("Review export"), urls: string[] = [], description = document.createElement("p");
    description.textContent = result.preview.description; description.style.cssText = "font:14px/1.5 system-ui"; node.append(description);
    const pages = document.createElement("div"); pages.style.cssText = "max-height:60vh;overflow:auto;display:grid;gap:16px"; node.append(pages);
    let closed = false;
    const finish = (confirmed: boolean) => { if (closed) return; closed = true; node.remove(); for (const url of urls) URL.revokeObjectURL(url);
      if (confirmed) resolve(); else { void post(crypto.randomUUID(), { cancelPreview: result.preview.id }).catch(() => {}); reject(declined()); } };
    const confirm = button("Download this version", () => finish(true)); confirm.disabled = true;
    node.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    node.append(confirm, button("Cancel", () => finish(false)));
    void (async () => {
      if (!result.preview.pages.length || result.preview.pages.length > 512) throw new Error("The concrete preview page range is invalid");
      for (const [index, page] of result.preview.pages.entries()) {
        const response = await nativeFetch(base + "__deck/download", { headers: headers(page.requestId) });
        if (!response.ok) throw new Error("The concrete export preview expired");
        const blob = await response.blob(); if (blob.size > 2 * 1024 * 1024 || await digest(blob) !== page.digest) throw new Error("The concrete export preview changed");
        if (closed) return;
        const figure = document.createElement("figure"), label = document.createElement("figcaption"), image = document.createElement("img");
        label.textContent = "Page " + (index + 1); image.alt = "Export preview page " + (index + 1); image.style.cssText = "display:block;width:100%;height:auto;border:1px solid #8886";
        const url = URL.createObjectURL(blob); urls.push(url); image.src = url; figure.style.margin = "0"; figure.append(label, image); pages.append(figure); await image.decode();
      }
      if (!closed) confirm.disabled = false;
    })().catch(error => { if (!closed) { closed = true; node.remove(); for (const url of urls) URL.revokeObjectURL(url); void post(crypto.randomUUID(), { cancelPreview: result.preview.id }).catch(() => {}); reject(error); } });
  });
  const project = async (context: { requestId?: string; cut?: { revision: number; snapshotRef: string } }, signal: AbortSignal, progress: (value: { stage: string; completed: number; total: number }) => void, retry = false) => {
    if (!token || active >= 2) throw new Error("Project export is unavailable or busy"); active++;
    const id = context.requestId ??= crypto.randomUUID();
    const cancel = () => { void post(id, { project: { action: "cancel" } }).catch(() => {}); };
    try {
      signal.throwIfAborted(); await beforeProduce(); signal.throwIfAborted();
      if (!context.cut) {
        const session = await nativeFetch(base + "__deck/session", { cache: "no-store" }); if (!session.ok) throw new Error("The saved project is unavailable");
        const value = await session.json(); if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !/^sha256:[a-f0-9]{64}$/.test(value.snapshotRef)) throw new Error("The saved project identity is invalid");
        context.cut = { revision: value.revision, snapshotRef: value.snapshotRef };
      }
      signal.addEventListener("abort", cancel, { once: true });
      let result = await post(id, { project: { action: retry ? "retry" : "start", ...context.cut } });
      while (result.project?.state === "running") {
        signal.throwIfAborted(); if (result.project.progress) progress(result.project.progress);
        await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(signal.reason); }, timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 120); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });
        result = await post(id, { project: { action: "status" } });
      }
      signal.throwIfAborted(); if (result.project?.state !== "complete") throw new Error(result.project?.error ?? (result.project?.state === "cancelled" ? "Project export cancelled" : "The complete project could not be prepared"));
      const delivery = result as Delivery;
      if (!delivery.fence || delivery.fence.mime !== "application/zip" || !/^[a-f0-9]{64}$/.test(delivery.fence.sha256) || delivery.fence.bytes < 22 || delivery.fence.bytes > 50_000_000 || !delivery.filename || result.revision !== context.cut.revision || result.snapshotRef !== context.cut.snapshotRef) throw new Error("The whole-project receipt changed its frozen source");
      const response = await nativeFetch(base + "__deck/download", { headers: headers(id), signal }); if (!response.ok) throw new Error("The retained whole-project file is unavailable");
      const blob = await response.blob(); signal.throwIfAborted();
      if (blob.size !== delivery.fence.bytes || await digest(blob) !== "sha256:" + delivery.fence.sha256) throw new Error("The complete project ZIP bytes changed");
      staged.set(blob, { requestId: id, delivery }); progress({ stage: "complete", completed: context.cut.revision, total: context.cut.revision }); return { filename: delivery.filename, data: blob, warnings: [] as string[] };
    } finally { signal.removeEventListener("abort", cancel); active--; }
  };
  return { project,
    async produce(options: Record<string, unknown>, files?: readonly string[]) {
      if (!token || active >= 2) throw new Error("Native export is unavailable or busy"); active++;
      try {
        await beforeProduce();
        let choices = { options, ...(files ? { files } : {}) };
        if (options.format === "pptx" && !(options.fonts as { mode?: string } | undefined)?.mode) {
          const variant = options.variant === "basic" || options.variant === "pictures" ? options.variant : await choosePptx();
          const selected: Record<string, unknown> = { ...options, variant };
          if (variant === "pictures") { delete selected.theme; delete selected.titlePlaceholders; } else delete selected.quality;
          const preview = await post(crypto.randomUUID(), { options: selected, ...(files ? { files } : {}), previewMode: variant === "basic" ? "basic" : "raster" }) as Preview;
          await review(preview); choices = preview.request;
        }
        const requestId = crypto.randomUUID(), delivery = await post(requestId, choices) as Delivery;
        if (!delivery.fence || !/^[a-f0-9]{64}$/.test(delivery.fence.sha256) || delivery.fence.bytes > 32 * 1024 * 1024 || !delivery.filename) throw new Error("The native export receipt is invalid");
        const result = await nativeFetch(base + "__deck/download", { headers: headers(requestId) });
        if (!result.ok) throw new Error("The original retained export is unavailable");
        const blob = await result.blob();
        if (blob.size !== delivery.fence.bytes || await digest(blob) !== "sha256:" + delivery.fence.sha256) throw new Error("The complete native export bytes changed");
        staged.set(blob, { requestId, delivery }); return { filename: delivery.filename, data: blob, warnings: [] as string[] };
      } finally { active--; }
    },
    async save({ filename, data }: { filename: string; data: Blob | ArrayBuffer }) {
      if (!token || pending.size >= 2) throw Object.assign(new Error("Native download is unavailable or busy"), { code: "failed" });
      const owned = data instanceof Blob ? staged.get(data) : undefined;
      if (!owned || filename !== owned.delivery.filename) throw Object.assign(new Error("Download the exact main-owned original export"), { code: "failed" });
      const { requestId, delivery } = owned;
      await new Promise<void>((resolve, reject) => { pending.set(requestId, { resolve, reject }); window.parent.postMessage({ type: "bottega:native:download", token, requestId, delivery }, "*"); });
    },
  };
}
