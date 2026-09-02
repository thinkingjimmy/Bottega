/**
 * [INPUT]: Depends on React hooks and the trusted bootstrap client injected through the App SDK provider
 * [OUTPUT]: Provides the immutable @bottega/app-react runtime source consumed as a virtual module
 * [POS]: gui-build/product-modules SDK runtime snapshot; its bytes hash into every compiled-v3 receipt sdkDigest
 */

export const SDK_RUNTIME_SOURCE = `
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
const Context = createContext(null);
export function __AppGuiProvider({ client, children }) { return React.createElement(Context.Provider, { value: client }, children); }
function useClient() { const client = useContext(Context); if (!client) throw new Error("App SDK Provider is missing"); return client; }
function useResource(operation, payload, critical = true) {
  const client = useClient();
  const key = JSON.stringify([operation, payload]);
  const payloadRef = useRef(payload); payloadRef.current = payload;
  const [state, setState] = useState({ status: "loading" });
  const criticalId = useRef(crypto.randomUUID());
  if (critical) client.reportCritical(criticalId.current, state.status);
  const latest = useRef({ key, sequence: 0, controller: null }); latest.current.key = key;
  const run = useCallback((preserve = false) => {
    latest.current.controller?.abort();
    const controller = new AbortController();
    latest.current.controller = controller;
    const sequence = ++latest.current.sequence;
    if (!preserve) setState({ status: "loading" });
    client.request(operation, payloadRef.current, controller.signal).then(
      (data) => { if (latest.current.key === key && latest.current.sequence === sequence) setState({ status: "success", data }); },
      (error) => { if (!controller.signal.aborted && latest.current.key === key && latest.current.sequence === sequence) setState({ status: "error", error: { code: error.code || "unknown_outcome", message: error.message, retryable: error.code !== "permission_denied" } }); }
    );
  }, [client, key, operation]);
  useEffect(() => {
    run(false);
    const unsubscribe = operation === "base.meta" || operation === "base.query-v1"
      ? client.subscribeBaseRevision(() => {
          if (operation === "base.meta" || document.visibilityState === "visible") run(true);
        })
      : () => undefined;
    return () => {
      unsubscribe();
      latest.current.controller?.abort();
      if (critical) client.releaseCritical(criticalId.current);
    };
  }, [client, operation, run]);
  const retry = useCallback(() => run(state.status === "success"), [run, state.status]);
  return useMemo(() => ({ ...state, retry, critical }), [state, retry, critical]);
}
export function useAppEnvironment() { return useClient().environment; }
export function useBaseMeta(options = {}) { return useResource("base.meta", null, options.critical ?? true); }
export function useBaseRows(query, options = {}) { return useResource("base.query-v1", query, options.critical ?? true); }
export function useAttachment(input, options = {}) { return useResource("attachment.read", input, options.critical ?? false); }
export function useAppPreferences(options = {}) {
  const client = useClient();
  const resource = useResource("preferences.read", null, options.critical ?? true);
  const resourceRef = useRef(resource); resourceRef.current = resource;
  const queue = useRef({ timer: null, pending: null, chain: Promise.resolve(), revision: null });
  if (resource.status === "success" && Number.isSafeInteger(resource.data.revision)) {
    queue.current.revision = resource.data.revision;
  }
  const flush = useCallback(() => {
    const current = queue.current;
    const pending = current.pending;
    if (!pending) return current.chain;
    current.pending = null;
    if (current.timer) clearTimeout(current.timer);
    current.timer = null;
    const operation = current.chain.then(async () => {
      try {
        const revision = pending.expectedRevision ?? current.revision;
        if (!Number.isSafeInteger(revision)) throw Object.assign(new Error("Preferences must be loaded before writing"), { code: "preference_transitioning" });
        const result = await client.request("preferences.write", { expectedRevision: revision, value: pending.value });
        if (Number.isSafeInteger(result?.revision)) current.revision = result.revision;
        resourceRef.current.retry();
        for (const waiter of pending.waiters) waiter.resolve(result);
      } catch (error) {
        for (const waiter of pending.waiters) waiter.reject(error);
      }
    });
    current.chain = operation.then(() => undefined, () => undefined);
    return operation;
  }, [client]);
  const write = useCallback((value, expectedRevision) => new Promise((resolve, reject) => {
    const current = queue.current;
    const pending = current.pending;
    if (pending && expectedRevision !== undefined && pending.expectedRevision !== undefined && expectedRevision !== pending.expectedRevision) {
      void flush();
    }
    const target = current.pending ?? { value, expectedRevision, waiters: [] };
    target.value = value;
    if (expectedRevision !== undefined) target.expectedRevision = expectedRevision;
    target.waiters.push({ resolve, reject });
    current.pending = target;
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => void flush(), 250);
  }), [flush]);
  const reset = useCallback(async (expectedRevision) => {
    await flush();
    const current = queue.current;
    await current.chain;
    const revision = expectedRevision ?? current.revision;
    if (!Number.isSafeInteger(revision)) throw Object.assign(new Error("Preferences must be loaded before reset"), { code: "preference_transitioning" });
    const result = await client.request("preferences.write", { expectedRevision: revision, reset: true });
    if (Number.isSafeInteger(result?.revision)) current.revision = result.revision;
    resourceRef.current.retry();
    return result;
  }, [client, flush]);
  useEffect(() => () => {
    const current = queue.current;
    if (current.timer) clearTimeout(current.timer);
    const error = Object.assign(new Error("Preference write was cancelled"), { code: "preference_cancelled" });
    for (const waiter of current.pending?.waiters ?? []) waiter.reject(error);
    current.pending = null;
  }, []);
  return useMemo(() => ({ ...resource, write, reset }), [resource, write, reset]);
}
export function useWorkspaceFiles(options = {}) { return useResource("workspace.files", options, options.critical ?? true); }
export function useWorkspaceVersions(fileRef, options = {}) { return useResource("workspace.versions", { fileRef, ...options }, options.critical ?? true); }
export function useWorkspaceSourceLine(input, options = {}) { return useResource("workspace.source-line", input, options.critical ?? false); }
export function useWorkspacePreview(target, options = {}) {
  const client = useClient();
  const critical = options.critical ?? false;
  const criticalId = useRef(crypto.randomUUID());
  const resource = useResource("workspace.preview", { target, critical }, false);
  const handle = resource.status === "success"
    ? resource.data?.handle ?? resource.data
    : null;
  if (critical) {
    client.reportCritical(
      criticalId.current,
      resource.status === "error" ? "error" : "loading"
    );
    if (typeof handle === "string") {
      client.bindPreviewCritical(handle, criticalId.current);
    }
  }
  useEffect(() => () => {
    if (critical) client.releaseCritical(criticalId.current);
  }, [client, critical]);
  return useMemo(
    () => resource.status === "success" ? { ...resource, data: handle } : resource,
    [handle, resource]
  );
}
export function useBaseMutation() {
  const client = useClient();
  return useCallback((mutation, options = {}) => client.request("base.mutation", mutation, options.signal), [client]);
}
export function useHostAction() { const client = useClient(); return useCallback((action) => client.hostAction(action), [client]); }
export function useFileExport() {
  const client = useClient();
  return useCallback(async ({ request, data, signal }) => {
    const bytes = typeof data === "string"
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array ? data : new Uint8Array(data);
    if (bytes.byteLength !== request.byteLength) throw Object.assign(new Error("Export byte length does not match the request"), { code: "file_export_length" });
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const begin = await client.hostAction({ type: "file.export.begin", request }, 120000);
    if (begin.status !== "accepted") return begin;
    const cancel = () => client.hostAction({ type: "file.export.cancel", exportId: begin.exportId }, 15000).catch(() => undefined);
    const onAbort = () => { void cancel(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (let offset = 0, seq = 0; offset < bytes.byteLength; seq += 1) {
        if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        const chunk = bytes.slice(offset, Math.min(offset + begin.maxChunkBytes, bytes.byteLength));
        await client.hostAction({
          type: "file.export.chunk",
          header: { exportId: begin.exportId, seq, byteLength: chunk.byteLength },
          bytes: chunk,
        }, 15000);
        offset += chunk.byteLength;
      }
      return await client.hostAction({ type: "file.export.finalize", exportId: begin.exportId }, 30000);
    } catch (error) {
      await cancel();
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }, [client]);
}
export function WorkspacePreview({ handle, mode = "browse", onSelection }) {
  const client = useClient();
  const ref = useRef(null);
  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== ref.current?.contentWindow || event.origin !== "null") return;
      if (event.data?.handle !== handle) return;
      if (event.data?.channel === "bottega:workspace-preview-ready") {
        client.previewReady(handle);
        return;
      }
      if (
        event.data?.channel === "bottega:workspace-selection" &&
        validWorkspaceSelection(event.data.selection)
      ) onSelection?.(event.data.selection);
    };
    addEventListener("message", onMessage); return () => removeEventListener("message", onMessage);
  }, [client, handle, onSelection]);
  const labels = location.hostname.split(".");
  const appId = labels.at(-2) || "";
  if (!/^[a-z0-9-]{1,63}$/.test(handle)) throw new Error("Workspace preview handle must be one lowercase DNS label");
  const source = location.protocol + "//" + handle + "." + appId + ".localhost:" + location.port + "/index.html?mode=" + mode;
  return React.createElement("iframe", {
    ref,
    src: source,
    sandbox: "allow-scripts",
    referrerPolicy: "origin",
    title: "Workspace preview",
  });
}
function validWorkspaceSelection(value) {
  if (!value || typeof value !== "object") return false;
  if (value.kind === "region") {
    const rect = value.rect;
    return rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger) && rect.width > 0 && rect.height > 0;
  }
  return value.kind === "element" &&
    typeof value.selector === "string" && value.selector.length <= 512 &&
    typeof value.tagName === "string" && value.tagName.length <= 64 &&
    typeof value.htmlHint === "string" && value.htmlHint.length >= 3 && value.htmlHint.length <= 180 &&
    (value.sourceLine === null || Number.isSafeInteger(value.sourceLine));
}
`;
