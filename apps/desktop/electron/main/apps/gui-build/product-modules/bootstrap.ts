/**
 * [INPUT]: Depends on the signed App entry virtual-module identity, exact admitted gate slice, browser React/runtime primitives, and Gate-3-owned axe-core
 * [OUTPUT]: Provides deterministic gate-sliced trusted bootstrap source with token capture, fixed transport, shared query dedupe, closed critical registration, stable readiness with a hidden-frame timer fallback, metadata-checked revision reconciliation, the sole React root, and authenticated Workbench evidence
 * [POS]: gui-build/product-modules trusted runtime root; author source can consume its Provider but cannot import this module
 */

export type BootstrapRuntimeSlice = Readonly<{
  data: boolean;
  preferences: boolean;
  workspace: boolean;
  workbench: boolean;
}>;

export function bootstrapSource(
  appEntryModule: string,
  slice: BootstrapRuntimeSlice
) {
  const sdkTransport = slice.data || slice.preferences || slice.workspace;
  const routes = {
    ...(slice.data ? {
      "base.meta": ["GET", "/_api/base/meta"],
      "base.rows": ["GET", "/_api/base/rows"],
      "base.query-v1": ["POST", "/_api/base/query-v1"],
    } : {}),
    ...(slice.preferences ? {
      "preferences.read": ["GET", "/_api/preferences"],
      "preferences.write": ["POST", "/_api/preferences"],
    } : {}),
    ...(slice.workspace ? {
      "workspace.files": ["POST", "/_api/workspace/files"],
      "workspace.versions": ["POST", "/_api/workspace/versions"],
      "workspace.source-line": ["POST", "/_api/workspace/source-line"],
      "workspace.preview": ["POST", "/_api/workspace/preview"],
    } : {}),
  };
  const enabledOperations = [
    ...Object.keys(routes),
    ...(slice.data ? ["base.mutation", "attachment.read"] : []),
  ];
  return `
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
${slice.workbench ? 'import axe from "axe-core";' : ""}
import { __AppGuiProvider } from "@bottega/app-react";

${sdkTransport ? "const nativeFetch = globalThis.fetch.bind(globalThis);" : ""}
const nativePostMessage = globalThis.parent.postMessage.bind(globalThis.parent);
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get("baseToken") || "";
const leaseId = params.get("surfaceLeaseId") || "";
const readyNonce = params.get("readyNonce") || "";
const hostOrigin = params.get("hostOrigin") || "*";
${slice.workbench ? `const workbenchFixture = params.get("workbenchFixture") || "";
const workbenchScenario = params.get("workbenchScenario") || "ready";
const workbenchSecret = params.get("workbenchSecret") || "";
const workbench = workbenchFixture === "base-v1" && token === "" && leaseId === "" && /^[a-f0-9]{64}$/.test(workbenchSecret);
let workbenchReadyMs = null;
const workbenchLongTasks = [];
const workbenchObserver = workbench && typeof PerformanceObserver === "function"
  ? new PerformanceObserver((list) => workbenchLongTasks.push(...list.getEntries().map((entry) => entry.duration)))
  : null;
try { workbenchObserver?.observe({ type: "longtask", buffered: true }); } catch {}` : ""}
const environment = Object.freeze({
  language: params.get("lang") || "en",
  locale: params.get("locale") || params.get("lang") || "en",
  timeZone: params.get("timeZone") || "UTC",
  colorScheme: params.get("colorScheme") === "dark" ? "dark" : "light",
  reducedMotion: params.get("reducedMotion") === "true",
  density: params.get("density") === "compact" ? "compact" : "comfortable",
  viewport: Object.freeze({ width: innerWidth, height: innerHeight }),
});
history.replaceState(null, "", location.pathname + location.search);

const pendingActions = new Map();
${slice.data ? `const baseRevisionListeners = new Set();
const baseQueryCache = new Map();
const inFlightQueries = new Map();
let baseQueryCacheBytes = 0;
let lastBaseRevisionEvent = null;` : ""}
const criticalStates = new Map();
const previewCriticalIds = new Map();
let bootstrapRendered = false;
let criticalRegistrationClosed = false;
let criticalWatermark = 0;
let readyPublished = false;
let readyCheckScheduled = false;
/* Hidden candidate iframes can stop receiving animation frames in Chromium. */
const afterBootstrapFrame = (callback) => {
  const finish = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    callback();
  };
  const frame = requestAnimationFrame(finish);
  const timer = setTimeout(finish, 100);
};
const publishReady = () => {
  if (
    readyPublished ||
    readyCheckScheduled ||
    !bootstrapRendered ||
    !criticalRegistrationClosed ||
    [...criticalStates.values()].some((state) => state !== "success")
  ) return;
  const watermark = criticalWatermark;
  readyCheckScheduled = true;
  afterBootstrapFrame(() => afterBootstrapFrame(() => {
    readyCheckScheduled = false;
    if (
      readyPublished ||
      watermark !== criticalWatermark ||
      !criticalRegistrationClosed ||
      [...criticalStates.values()].some((state) => state !== "success")
    ) {
      publishReady();
      return;
    }
    readyPublished = true;
    nativePostMessage({ channel: "bottega:app-gui-ready", leaseId, readyNonce }, hostOrigin);
  }));
};
${slice.data ? `const notifyBaseRevision = (event) => {
  lastBaseRevisionEvent = event;
  baseQueryCache.clear();
  baseQueryCacheBytes = 0;
  for (const listener of baseRevisionListeners) listener(event);
};` : ""}
addEventListener("message", (event) => {
  if (event.source !== parent || (hostOrigin !== "*" && event.origin !== hostOrigin)) return;
  const message = event.data;
  ${slice.workbench ? `if (workbench && message?.channel === "bottega:workbench-check") {
    void runWorkbenchChecks(message.requestId);
    return;
  }` : ""}
  ${slice.data ? `if (message?.channel === "bottega:base-revision-changed") {
    if (typeof message.baseInstanceId === "string" && Number.isSafeInteger(message.revision) && Number.isSafeInteger(message.eventSeq)) {
      notifyBaseRevision(Object.freeze({ baseInstanceId: message.baseInstanceId, revision: message.revision, eventSeq: message.eventSeq, reason: "event" }));
    }
    return;
  }` : ""}
  if (!message || message.channel !== "ai-chat:base-gui-host-action-result") return;
  const pending = pendingActions.get(message.requestId);
  if (!pending) return;
  pendingActions.delete(message.requestId);
  clearTimeout(pending.timer);
  message.ok ? pending.resolve(message.value ?? { status: "accepted" }) : pending.reject(Object.assign(new Error(message.error || "Host action failed"), { code: "host_action_failed" }));
});

${sdkTransport ? `async function performRequest(operation, payload, signal) {
  const routes = ${JSON.stringify(routes)};
  const enabledOperations = new Set(${JSON.stringify(enabledOperations)});
  let route = routes[operation];
  let body = payload;
  if (operation === "base.mutation") {
    if (!enabledOperations.has(operation)) throw Object.assign(new Error("Unsupported SDK operation"), { code: "permission_denied" });
    const methods = { insert: "POST", patch: "PATCH", delete: "DELETE" };
    const method = methods[payload?.kind];
    if (!method) throw Object.assign(new Error("Unsupported Base mutation"), { code: "invalid_envelope" });
    route = [method, "/_api/base/rows"];
    const { kind: _kind, ...envelope } = payload;
    body = envelope;
  } else if (operation === "attachment.read") {
    if (!enabledOperations.has(operation)) throw Object.assign(new Error("Unsupported SDK operation"), { code: "permission_denied" });
    if (!/^attachment_[a-f0-9]{24}$/.test(payload?.attachmentId ?? "")) throw Object.assign(new Error("Invalid attachment id"), { code: "invalid_envelope" });
    route = ["GET", "/_api/base/attachments/" + payload.attachmentId];
  }
  if (!route) throw Object.assign(new Error("Unsupported SDK operation"), { code: "permission_denied" });
  if (operation === "base.rows") {
    const query = new URLSearchParams({ limit: "500" });
    if (payload?.cursor) query.set("cursor", payload.cursor);
    route = ["GET", route[1] + "?" + query];
  }
  const response = await nativeFetch(route[1], {
    method: route[0],
    signal,
    cache: "no-store",
    headers: { authorization: "Bearer " + token, "content-type": "application/json", "x-bottega-surface-lease": leaseId },
    ...(["POST", "PATCH", "DELETE"].includes(route[0]) ? { body: JSON.stringify(body ?? {}) } : {}),
  });
  if (operation === "attachment.read" && response.ok) return { value: new Uint8Array(await response.arrayBuffer()), bytes: 0 };
  /* 页大小从响应文本量出来。把刚解析出的对象再 JSON.stringify 一遍只为数字节，
     等于为每一页额外付一次完整序列化。 */
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { result = {}; }
  if (!response.ok) {
    const error = result.error ?? result;
    throw Object.assign(new Error(error.message || "App SDK request failed"), {
      status: response.status, code: error.code || "unknown_outcome",
      outcome: error.outcome ?? (response.status >= 500 ? "unknown" : "not-committed"),
      issues: error.issues ?? [], currentRevision: error.currentRevision,
      retryAfter: response.headers.get("retry-after"),
    });
  }
  return { value: result, bytes: new TextEncoder().encode(text).byteLength };
}` : ""}
${slice.data ? `/* 游标是不透明的续页凭据，不该以明文长期躺在缓存键里。 */
async function cursorIdentity(cursor) {
  if (typeof cursor !== "string" || cursor === "") return "FIRST_PAGE";
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cursor));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function queryCacheKey(payload) {
  const page = payload?.page ?? {};
  const { cursor: _cursor, ...rest } = page;
  return JSON.stringify([payload?.shape ?? null, rest, await cursorIdentity(page.cursor)]);
}
function storeQueryPage(cacheKey, outcome) {
  if (outcome.bytes > 700000) return;
  const previous = baseQueryCache.get(cacheKey);
  if (previous) baseQueryCacheBytes -= previous.bytes;
  baseQueryCache.set(cacheKey, { value: outcome.value, bytes: outcome.bytes, storedAt: Date.now() });
  baseQueryCacheBytes += outcome.bytes;
  while (baseQueryCache.size > 32 || baseQueryCacheBytes > 8 * 1024 * 1024) {
    const oldestKey = baseQueryCache.keys().next().value;
    const oldest = baseQueryCache.get(oldestKey);
    baseQueryCache.delete(oldestKey);
    baseQueryCacheBytes -= oldest?.bytes ?? 0;
  }
}
/* 两个 hook 挂载同一个查询，过去就是两次真请求。共享的那一次不带任何调用方的
   signal：谁取消只取消谁的等待，剩下的订阅者照拿结果，缓存也照样填上。 */
function sharedQuery(payload, signal) {
  return queryCacheKey(payload).then((cacheKey) => {
    const cached = baseQueryCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt <= 5000) return untilSettledOrAborted(Promise.resolve(cached.value), signal);
    let running = inFlightQueries.get(cacheKey);
    if (!running) {
      running = performRequest("base.query-v1", payload).then((outcome) => {
        storeQueryPage(cacheKey, outcome);
        return outcome.value;
      });
      running.catch(() => undefined);
      inFlightQueries.set(cacheKey, running);
      running.finally(() => { if (inFlightQueries.get(cacheKey) === running) inFlightQueries.delete(cacheKey); });
    }
    return untilSettledOrAborted(running, signal);
  });
}
function untilSettledOrAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}` : ""}

const client = Object.freeze({
  environment,
  reportCritical(id, state) {
    if (criticalStates.get(id) !== state) criticalWatermark += 1;
    criticalStates.set(id, state);
    publishReady();
  },
  releaseCritical(id) {
    if (criticalStates.delete(id)) criticalWatermark += 1;
    for (const [handle, ids] of previewCriticalIds) {
      if (ids.delete(id) && ids.size === 0) previewCriticalIds.delete(handle);
    }
    publishReady();
  },
  bindPreviewCritical(handle, id) {
    const ids = previewCriticalIds.get(handle) ?? new Set();
    ids.add(id);
    previewCriticalIds.set(handle, ids);
  },
  previewReady(handle) {
    for (const id of previewCriticalIds.get(handle) ?? []) {
      if (criticalStates.get(id) !== "success") criticalWatermark += 1;
      criticalStates.set(id, "success");
    }
    publishReady();
  },
  finishBootstrap() {
    bootstrapRendered = true;
    criticalRegistrationClosed = true;
    publishReady();
  },
  /* 客户端表面只暴露订阅：把 notifyBaseRevision 挂上去等于把「清空 SDK 缓存」
     和「伪造修订事件」两把钥匙交给 App 代码，而 app-react 一次也没用过它们。 */
  ${slice.data ? `subscribeBaseRevision(listener) {
    baseRevisionListeners.add(listener);
    return () => baseRevisionListeners.delete(listener);
  },` : `subscribeBaseRevision() { return () => undefined; },`}
  async request(operation, payload, signal) {
    ${slice.workbench ? "if (workbench) return workbenchRequest(operation, payload, signal);" : ""}
    ${sdkTransport ? `
    ${slice.data ? `if (operation === "base.query-v1") return sharedQuery(payload, signal);` : ""}
    const outcome = await performRequest(operation, payload, signal);
    ${slice.data ? `if (operation === "base.mutation") notifyBaseRevision(Object.freeze({ baseInstanceId: outcome.value.baseInstanceId, revision: outcome.value.revision, eventSeq: -1, reason: "mutation" }));` : ""}
    return outcome.value;` : `throw Object.assign(new Error("Unsupported SDK operation"), { code: "permission_denied" });`}
  },
  hostAction(action, timeoutMs = 5000) {
    ${slice.workbench ? 'if (workbench) return Promise.resolve(Object.freeze({ status: "declined", reason: "permission" }));' : ""}
    const requestId = "host_" + crypto.randomUUID().replaceAll("-", "_");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pendingActions.delete(requestId); reject(Object.assign(new Error("Host action timed out"), { code: "host_action_timeout" })); }, timeoutMs);
      pendingActions.set(requestId, { resolve, reject, timer });
      nativePostMessage({ channel: "ai-chat:base-gui-host-action", token, requestId, action }, hostOrigin);
    });
  },
});

${slice.workbench ? `const WORKBENCH_ROWS = 10000;
const WORKBENCH_COLUMNS = Object.freeze(Array.from({ length: 20 }, (_, index) => Object.freeze({
  id: "field_" + String(index + 1).padStart(2, "0"),
  name: "Field " + String(index + 1).padStart(2, "0"),
  type: index === 1 ? "number" : index === 2 ? "checkbox" : "text",
})));
function workbenchError(code, message) {
  return Object.assign(new Error(message), { code });
}
function abortableDelay(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")), { once: true });
  });
}
function fixtureValue(columnId, row) {
  const column = WORKBENCH_COLUMNS.find((item) => item.id === columnId);
  if (column?.type === "number") return row;
  if (column?.type === "checkbox") return row % 2 === 0;
  return columnId + " · " + String(row + 1).padStart(5, "0");
}
function fixtureEmpty(value) { return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0); }
function fixtureCompare(left, right) {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).normalize("NFC").toLowerCase() < String(right).normalize("NFC").toLowerCase() ? -1 : String(left).normalize("NFC").toLowerCase() > String(right).normalize("NFC").toLowerCase() ? 1 : 0;
}
function fixtureDirected(left, right, direction) {
  if (fixtureEmpty(left)) return fixtureEmpty(right) ? 0 : 1;
  if (fixtureEmpty(right)) return -1;
  const compared = fixtureCompare(left, right);
  return direction === "desc" ? -compared : compared;
}
function fixtureMatches(row, filter) {
  if (!filter) return true;
  if (filter.kind === "and") return filter.filters.every((child) => fixtureMatches(row, child));
  if (filter.kind === "or") return filter.filters.some((child) => fixtureMatches(row, child));
  if (filter.kind === "not") return !fixtureMatches(row, filter.filter);
  const current = fixtureValue(filter.columnId, row);
  if (filter.operator === "is-empty") return fixtureEmpty(current);
  if (filter.operator === "not-empty") return !fixtureEmpty(current);
  if (filter.operator === "contains") return String(current ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
  const compared = fixtureCompare(current, filter.value);
  if (filter.operator === "eq") return compared === 0;
  if (filter.operator === "neq") return compared !== 0;
  if (filter.operator === "gt") return compared > 0;
  if (filter.operator === "gte") return compared >= 0;
  if (filter.operator === "lt") return compared < 0;
  return compared <= 0;
}
function fixtureAggregate(operation, source) {
  const present = source.filter((value) => !fixtureEmpty(value));
  if (operation === "empty") return source.length - present.length;
  if (operation === "filled") return present.length;
  if (operation === "unique") return new Set(present.map((value) => JSON.stringify(value))).size;
  const values = present.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((left, right) => left - right);
  if (!values.length) return null;
  if (operation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (operation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (operation === "min") return values[0];
  if (operation === "max") return values.at(-1);
  if (operation === "range") return values.at(-1) - values[0];
  if (operation === "median") { const middle = Math.floor(values.length / 2); return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2; }
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}
async function fixtureDigest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value) + "\\n"));
  return "sha256:" + [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}
async function workbenchRequest(operation, payload, signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  if (workbenchScenario === "loading") return abortableDelay(signal);
  if (workbenchScenario === "permission") throw workbenchError("permission_denied", "Workbench fixture denied this operation");
  if (workbenchScenario === "network") throw workbenchError("network_unavailable", "Workbench fixture interrupted the transport");
  if (workbenchScenario === "unknown" && operation !== "base.meta") throw workbenchError("unknown_outcome", "Workbench fixture requires reconciliation");
  if (workbenchScenario === "conflict" && ["base.mutation", "preferences.write"].includes(operation)) {
    throw Object.assign(workbenchError("revision_conflict", "Workbench fixture advanced to revision 8"), { currentRevision: 8 });
  }
  const rowCount = workbenchScenario === "empty" ? 0 : workbenchScenario === "large" ? WORKBENCH_ROWS : 48;
  if (operation === "base.meta") return Object.freeze({
    name: "Workbench Base v1",
    columns: WORKBENCH_COLUMNS,
    views: Object.freeze([{ id: "view_all", name: "All rows", type: "table" }]),
    revision: 7,
    rowCount,
    baseInstanceId: "workbench_base_v1",
    capabilities: Object.freeze({ rowInsert: false, rowPatch: false, rowDelete: false, attachmentRead: false }),
    fixture: Object.freeze({ id: "base-v1", rows: rowCount, columns: WORKBENCH_COLUMNS.length, maximumRowsJsonBytes: 20 * 1024 * 1024 }),
  });
  if (operation === "base.rows") {
    const offset = Math.max(0, Number.parseInt(payload?.cursor || "0", 10) || 0);
    const count = Math.min(500, Math.max(0, rowCount - offset));
    const rows = Array.from({ length: count }, (_, index) => ({
      id: "fixture_" + (offset + index),
      values: Object.fromEntries(WORKBENCH_COLUMNS.map((column) => [column.id, fixtureValue(column.id, offset + index)])),
    }));
    return { revision: 7, rows, ...(offset + count < rowCount ? { nextCursor: String(offset + count) } : {}) };
  }
  if (operation === "base.query-v1") {
    const shape = payload?.shape ?? {};
    const offset = Math.max(0, Number.parseInt(payload?.page?.cursor || "0", 10) || 0);
    const limit = Math.min(200, Math.max(1, payload?.page?.limit || 100));
    const selected = Array.from({ length: rowCount }, (_, row) => row).filter((row) => fixtureMatches(row, shape.filter));
    if (shape.mode === "groups") {
      const numericOperations = new Set(["average", "max", "median", "min", "range", "stddev", "sum"]);
      for (const aggregate of shape.aggregates ?? []) {
        const column = WORKBENCH_COLUMNS.find((item) => item.id === aggregate.columnId);
        if (numericOperations.has(aggregate.op) && column?.type !== "number") throw workbenchError("query_aggregation_invalid", aggregate.op + " requires a numeric column");
      }
      const grouped = new Map();
      for (const row of selected) {
        const keys = (shape.groupBy ?? []).map((columnId) => fixtureValue(columnId, row));
        const identity = JSON.stringify(keys);
        const group = grouped.get(identity) ?? { keys, rows: [] };
        group.rows.push(row); grouped.set(identity, group);
      }
      const projected = await Promise.all([...grouped.values()].map(async (group) => ({
        groupId: await fixtureDigest(group.keys),
        keys: group.keys,
        rowCount: group.rows.length,
        aggregates: Object.fromEntries((shape.aggregates ?? []).map((aggregate) => [aggregate.id, fixtureAggregate(aggregate.op, group.rows.map((row) => fixtureValue(aggregate.columnId, row)))])),
      })));
      projected.sort((left, right) => {
        for (const sort of shape.sort ?? []) {
          const a = sort.kind === "group" ? left.keys[sort.index] : left.aggregates[sort.aggregateId];
          const b = sort.kind === "group" ? right.keys[sort.index] : right.aggregates[sort.aggregateId];
          const compared = fixtureDirected(a, b, sort.direction); if (compared) return compared;
        }
        return left.groupId.localeCompare(right.groupId, "en");
      });
      const end = Math.min(projected.length, offset + limit);
      return Object.freeze({
        version: 1,
        semanticsVersion: "base-gui-query-v1",
        mode: "groups",
        baseInstanceId: "workbench_base_v1",
        revision: 7,
        groups: Object.freeze(projected.slice(offset, end).map((group) => Object.freeze(group))),
        ...(end < projected.length ? { nextCursor: String(end) } : {}),
      });
    }
    selected.sort((left, right) => {
      for (const sort of shape.sort ?? []) { const compared = fixtureDirected(fixtureValue(sort.columnId, left), fixtureValue(sort.columnId, right), sort.direction); if (compared) return compared; }
      return left - right;
    });
    const end = Math.min(selected.length, offset + limit);
    const projection = Array.isArray(shape.projection) ? shape.projection.slice(0, 32) : WORKBENCH_COLUMNS.slice(0, 5).map((item) => item.id);
    const rows = Array.from({ length: Math.max(0, end - offset) }, (_, index) => {
      const row = selected[offset + index];
      return Object.freeze({
        rowId: "row_" + String(row + 1).padStart(5, "0"),
        values: Object.freeze(Object.fromEntries(projection.map((columnId) => [columnId, fixtureValue(columnId, row)]))),
      });
    });
    return Object.freeze({
      version: 1,
      semanticsVersion: "base-gui-query-v1",
      mode: "rows",
      baseInstanceId: "workbench_base_v1",
      revision: 7,
      rows,
      ...(end < selected.length ? { nextCursor: String(end) } : {}),
    });
  }
  if (operation === "preferences.read") return Object.freeze({ revision: 1, value: Object.freeze({}) });
  if (operation === "preferences.write") return Object.freeze({ revision: 2, value: Object.freeze(payload?.value ?? {}) });
  if (operation === "workspace.files") return Object.freeze({ files: Object.freeze([]) });
  if (operation === "workspace.versions") return Object.freeze({ versions: Object.freeze([]) });
  if (operation === "workspace.source-line") return null;
  if (operation === "base.mutation") throw workbenchError("permission_denied", "Workbench fixtures are read-only");
  throw workbenchError("permission_denied", "Operation is not available in the Workbench fixture");
}

async function runWorkbenchChecks(requestId) {
  if (typeof requestId !== "string" || requestId.length > 96) return;
  const startupLongTasks = [
    ...workbenchLongTasks,
    ...(workbenchObserver?.takeRecords().map((entry) => entry.duration) ?? []),
  ];
  const controls = [...document.querySelectorAll("button, input, select, textarea, a[href], [tabindex]")].filter((element) => element.tabIndex >= 0);
  const keyboard = controls.length > 0 && controls.every((element) => element.getAttribute("aria-hidden") !== "true")
    ? { state: "passed", detail: controls.length + " reachable control(s)" }
    : { state: "failed", detail: "No keyboard-reachable control or an aria-hidden control is tabbable" };
  const first = controls[0];
  first?.focus();
  const focus = first && document.activeElement === first
    ? { state: "passed", detail: "Focus entered the current generation" }
    : { state: "failed", detail: "Focus could not enter the current generation" };
  const report = await axe.run(document.documentElement).catch((error) => ({ error }));
  const axeResult = "error" in report
    ? { state: "failed", detail: report.error instanceof Error ? report.error.message : String(report.error) }
    : report.violations.length === 0
      ? { state: "passed", detail: report.passes.length + " rules passed" }
      : { state: "failed", detail: report.violations.length + " violations: " + report.violations.map((item) => item.id).join(", ") };
  const csp = await checkWorkbenchCsp();
  const domNodes = document.getElementsByTagName("*").length;
  const maxLongTaskMs = Math.max(0, ...startupLongTasks);
  const performanceResult = workbenchReadyMs !== null && workbenchReadyMs <= 1500 && domNodes <= 2000 && maxLongTaskMs <= 200
    ? { state: "passed", detail: "tti=" + Math.round(workbenchReadyMs) + "ms dom=" + domNodes + " maxLongTask=" + Math.round(maxLongTaskMs) + "ms" }
    : { state: "failed", detail: "tti=" + Math.round(workbenchReadyMs ?? -1) + "ms dom=" + domNodes + " maxLongTask=" + Math.round(maxLongTaskMs) + "ms" };
  const visual = await captureWorkbenchDocument().catch((error) => ({ error }));
  const result = {
    channel: "bottega:workbench-check-result",
    requestId,
    workbenchSecret,
    fixture: { id: "base-v1", rows: workbenchScenario === "empty" ? 0 : workbenchScenario === "large" ? WORKBENCH_ROWS : 48, columns: WORKBENCH_COLUMNS.length },
    checks: { keyboard, focus, axe: axeResult, csp, performance: performanceResult },
    visual: "error" in visual ? { error: visual.error instanceof Error ? visual.error.message : String(visual.error) } : { digest: visual.digest, bytes: visual.bytes },
  };
  nativePostMessage(result, hostOrigin, "error" in visual ? [] : [visual.bytes]);
}

function checkWorkbenchCsp() {
  return new Promise((resolve) => {
    const source = "https://workbench-csp.invalid/probe.js";
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      script.remove();
      resolve({ state: "failed", detail: "No script-src policy violation was observed" });
    }, 500);
    const blocked = (event) => {
      if (event.blockedURI !== source || !["script-src", "script-src-elem"].includes(event.effectiveDirective)) return;
      clearTimeout(timer);
      removeEventListener("securitypolicyviolation", blocked);
      script.remove();
      resolve({ state: "passed", detail: "External script was blocked by the production CSP" });
    };
    addEventListener("securitypolicyviolation", blocked);
    script.src = source;
    document.head.append(script);
  });
}

async function captureWorkbenchDocument() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script, link[rel=stylesheet]").forEach((element) => element.remove());
  const css = [...document.styleSheets].flatMap((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText); } catch { return []; }
  }).join("\\n");
  const style = document.createElement("style");
  style.textContent = css;
  clone.querySelector("head")?.append(style);
  const width = Math.max(320, document.documentElement.scrollWidth);
  const height = Math.max(240, document.documentElement.scrollHeight);
  const markup = new XMLSerializer().serializeToString(clone);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><foreignObject width="100%" height="100%">' + markup + "</foreignObject></svg>";
  const source = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const image = await new Promise((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error("Visual capture failed to load"));
    candidate.src = source;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  context.drawImage(image, 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
  const bytes = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return { bytes, digest: "sha256:" + [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
}` : ""}

${slice.data ? `/* 对账是「问一句有没有变」，不是「假设变了」。无条件 notifyBaseRevision 会清空
   整个查询缓存、让每一个挂载中的 hook 重新取数——每 24 秒一次，外加每次聚焦与
   可见性切换。先读一次 base.meta，修订确实前进了才广播。 */
let lastReconciledAt = 0;
let reconcileTimer = null;
const reconcile = async () => {
  if (document.visibilityState !== "visible" || Date.now() - lastReconciledAt < 5000) return;
  lastReconciledAt = Date.now();
  const meta = await client.request("base.meta", null).catch(() => null);
  if (!meta || !Number.isSafeInteger(meta.revision)) return;
  const previous = lastBaseRevisionEvent;
  const observed = Object.freeze({ baseInstanceId: meta.baseInstanceId ?? "", revision: meta.revision, eventSeq: previous?.eventSeq ?? -1, reason: "reconcile" });
  /* 第一次对账只是取基线：App 本来就是在这个修订上加载的，广播一次等于白清缓存。 */
  if (!previous) { lastBaseRevisionEvent = observed; return; }
  if (previous.revision === observed.revision && previous.baseInstanceId === observed.baseInstanceId) return;
  notifyBaseRevision(observed);
};
/* 隐藏时链条停摆：定时器只在可见状态下续期，重新可见时由事件重新点火。 */
const scheduleReconcile = () => {
  if (reconcileTimer !== null || document.visibilityState !== "visible") return;
  reconcileTimer = setTimeout(() => {
    reconcileTimer = null;
    void reconcile().finally(scheduleReconcile);
  }, 20000 + Math.floor(Math.random() * 8000));
};
const onReconcileTrigger = () => { void reconcile().finally(scheduleReconcile); };
scheduleReconcile();
addEventListener("focus", onReconcileTrigger);
document.addEventListener("visibilitychange", onReconcileTrigger);
` : ""}

const root = document.getElementById("root");
if (!root) throw new Error("Trusted root is missing");
const module = await import(${JSON.stringify(appEntryModule)});
if (typeof module.default !== "function") throw new Error("App default component is invalid");
flushSync(() => createRoot(root).render(
  React.createElement(__AppGuiProvider, { client }, React.createElement(module.default))
));
client.finishBootstrap();
${slice.workbench ? "if (workbench) workbenchReadyMs = performance.now();" : ""}
`;
}
