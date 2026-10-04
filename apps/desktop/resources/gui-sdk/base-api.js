/**
 * [INPUT]: Depends on browser fetch/location/history/visibility, FileReader, AbortController, host inserted parent origin and synchronous source /_api/base
 * [OUTPUT]: The globalThis.BottegaBase provides fragment consumption, Base operations, attachment reads, scoped read-only Design list/history/source-line/preview URLs, and acknowledged allowlisted host actions
 * [POS]: The only product of resources/GUI-sdk is the Base GUI client; The App page does not contain token, split page, CAS or routing protocol details
 */
(function installBaseGuiSdk(global) {
  "use strict";

  var CHANNEL = "ai-chat:base-gui-host-action";
  var RESULT_CHANNEL = "ai-chat:base-gui-host-action-result";
  var HOST_ACTION_BYTE_LIMIT = 32 * 1024;
  var pendingActions = new Map();
  var requestSequence = 0;

  class BaseApiError extends Error {
    constructor(status, message, details) {
      super(message);
      this.name = "BaseApiError";
      this.status = status;
      Object.assign(this, details || {});
    }
  }

  function consumeFragment(locationLike, historyLike) {
    var params = new global.URLSearchParams(String(locationLike.hash || "").replace(/^#/, ""));
    var fragment = {
      token: params.get("baseToken") || params.get("token") || "",
      lang: params.get("lang") || "",
      hostOrigin: params.get("hostOrigin") || "",
      surfaceLeaseId: params.get("surfaceLeaseId") || "",
    };
    historyLike.replaceState(null, "", String(locationLike.pathname || "") + String(locationLike.search || ""));
    return fragment;
  }

  class Client {
    constructor(options) {
      options = options || {};
      this.token = options.token || "";
      this.fetch = options.fetch || global.fetch.bind(global);
      this.document = options.document || global.document;
      this.clock = options.clock || {
        setTimeout: global.setTimeout.bind(global),
        clearTimeout: global.clearTimeout.bind(global),
        sleep: (milliseconds) => new Promise((resolve) => global.setTimeout(resolve, milliseconds)),
      };
      this.abort = null;
      this.pollAbort = null;
      this.pollingSession = null;
      this.timer = null;
      this.revision = null;
      this.baseInstanceId = null;
    }

    async request(path, signal, init) {
      var response = await this.fetch(path, {
        method: init && init.method || "GET",
        headers: {
          Authorization: "Bearer " + this.token,
          ...(init && init.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(init && init.body ? { body: JSON.stringify(init.body) } : {}),
        cache: "no-store",
        signal: signal,
      });
      /* Base API 的 JSON/错误面恒是 JSON；解析失败退空对象，下面的 !ok 分支
         仍能给出带 status 的结构化错误。 */
      var body = await response.json().catch(() => ({}));
      if (!response.ok) {
        var details = body && typeof body.error === "object" ? body.error : {};
        if (response.status === 409 && path !== "/_api/base/meta") {
          details.latestMeta = await this.meta(signal).catch(() => null);
        }
        var fallback = typeof body.error === "string" ? body.error : "Base API " + response.status;
        throw new BaseApiError(response.status, details.message || fallback, {
          code: details.code || "unknown_error",
          outcome: details.outcome || (response.status >= 500 ? "unknown" : "not-committed"),
          issues: details.issues || [],
          currentRevision: details.currentRevision,
          latestMeta: details.latestMeta,
          retryAfter: response.headers && response.headers.get ? response.headers.get("retry-after") : null,
        });
      }
      return body;
    }

    meta(signal) { return this.request("/_api/base/meta", signal); }

    async refresh() {
      if (this.abort) this.abort.abort();
      var abort = new global.AbortController();
      this.abort = abort;
      try { return await this.readConsistent(abort.signal); }
      finally { if (this.abort === abort) this.abort = null; }
    }

    async readConsistent(signal) {
      var delays = [250, 500, 1000];
      for (var attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
          var start = await this.meta(signal);
          var records = [];
          var cursor = "";
          do {
            var query = new global.URLSearchParams({ limit: "500" });
            if (cursor) query.set("cursor", cursor);
            var page = await this.request("/_api/base/rows?" + query, signal);
            if (page.revision !== start.revision) throw new BaseApiError(409, "Base revision 在分页期间变化");
            records.push(...page.rows);
            cursor = page.nextCursor || "";
          } while (cursor);
          var end = await this.meta(signal);
          if (end.revision !== start.revision || end.baseInstanceId !== start.baseInstanceId) {
            throw new BaseApiError(409, "Base instance/revision 在尾部复核时变化", {
              code: "snapshot_changed", outcome: "not-committed",
            });
          }
          this.revision = end.revision;
          this.baseInstanceId = end.baseInstanceId;
          return { meta: end, rows: records };
        } catch (error) {
          if (!(error instanceof BaseApiError) || error.status !== 409 || attempt === delays.length) throw error;
          await this.clock.sleep(delays[attempt]);
        }
      }
      throw new BaseApiError(409, "Base 持续变化，请稍后重试");
    }

    insertRows(frozen, expectedRevision, signal) {
      return this.mutate("POST", { expectedBaseInstanceId: frozen.expectedBaseInstanceId, expectedRevision, rows: frozen.rows }, signal);
    }

    patchRows(expectedBaseInstanceId, expectedRevision, patches, signal) {
      return this.mutate("PATCH", { expectedBaseInstanceId, expectedRevision, patches }, signal);
    }

    deleteRows(expectedBaseInstanceId, expectedRevision, rowIds, signal) {
      return this.mutate("DELETE", { expectedBaseInstanceId, expectedRevision, rowIds }, signal);
    }

    mutate(method, body, signal) {
      return this.request("/_api/base/rows", signal, { method, body });
    }

    async getAttachment(attachmentId, signal) {
      var response = await this.fetch("/_api/base/attachments/" + encodeURIComponent(attachmentId), {
        headers: { Authorization: "Bearer " + this.token }, cache: "no-store", signal,
      });
      if (!response.ok) {
        var body = await response.json().catch(() => ({}));
        var details = body && typeof body.error === "object" ? body.error : {};
        throw new BaseApiError(response.status, details.message || "Attachment read failed", details);
      }
      return response.blob();
    }

    /* 展示用唯一出口：base-gui 的 CSP 是 `img-src 'self' data:`，没有 blob:，
       所以 createObjectURL(getAttachment()) 的 URL 一贴进 <img> 就被挡死。
       data: URL 由页面自己持有，不需要 revoke。 */
    async getAttachmentDataUrl(attachmentId, signal) {
      var blob = await this.getAttachment(attachmentId, signal);
      return await new Promise((resolve, reject) => {
        var reader = new global.FileReader();
        reader.onerror = () => reject(new BaseApiError(0, "Attachment 读取失败"));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(blob);
      });
    }

    startPolling(onSnapshot, onError, interval = 5000) {
      this.stopPolling();
      var session = { active: true, inFlight: false, unhealthy: false };
      this.pollingSession = session;
      var isActive = () => this.pollingSession === session && session.active;
      var schedule = () => {
        if (!isActive()) return;
        if (this.timer !== null) this.clock.clearTimeout(this.timer);
        this.timer = this.clock.setTimeout(() => { this.timer = null; return tick(); }, interval);
      };
      var tick = async () => {
        if (!isActive() || session.inFlight) return;
        if (this.document.hidden) return schedule();
        session.inFlight = true;
        var pollAbort = new global.AbortController();
        this.pollAbort = pollAbort;
        try {
          var meta = await this.meta(pollAbort.signal);
          if (!isActive()) return;
          if (meta.revision !== this.revision || session.unhealthy) onSnapshot(await this.refresh());
          session.unhealthy = false;
        } catch (error) {
          if (!isActive() || isAbortError(error)) return;
          onError(error);
          if (isFatalError(error)) return this.stopPolling();
          session.unhealthy = true;
        } finally {
          if (this.pollAbort === pollAbort) this.pollAbort = null;
          session.inFlight = false;
          if (isActive()) schedule();
        }
      };
      var visible = () => {
        if (this.document.hidden || !isActive() || session.inFlight) return;
        if (this.timer !== null) this.clock.clearTimeout(this.timer);
        this.timer = null;
        void tick();
      };
      this.visibilityHandler = visible;
      this.document.addEventListener("visibilitychange", visible);
      schedule();
      return () => { if (this.pollingSession === session) this.stopPolling(); };
    }

    stopPolling() {
      if (this.pollingSession) this.pollingSession.active = false;
      this.pollingSession = null;
      if (this.timer !== null) this.clock.clearTimeout(this.timer);
      this.timer = null;
      if (this.visibilityHandler) this.document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
      if (this.pollAbort) this.pollAbort.abort();
      this.pollAbort = null;
      if (this.abort) this.abort.abort();
      this.abort = null;
    }
  }

  function isAbortError(error) { return error instanceof Error && error.name === "AbortError"; }
  function isFatalError(error) { return error instanceof BaseApiError && [401, 403, 404, 410].includes(error.status); }

  var fragment = consumeFragment(global.location, global.history);
  var client = new Client({ token: fragment.token });
  var api = {
    language: fragment.lang,
    BaseApiError,
    Client,
    consumeFragment,
    createClient: (options) => new Client(options),
    meta: (signal) => client.meta(signal),
    rows: async () => (await client.refresh()).rows,
    snapshot: () => client.refresh(),
    insertRows: (expectedBaseInstanceId, expectedRevision, rows, signal) =>
      client.insertRows({ expectedBaseInstanceId, rows }, expectedRevision, signal),
    patchRows: (expectedBaseInstanceId, expectedRevision, patches, signal) =>
      client.patchRows(expectedBaseInstanceId, expectedRevision, patches, signal),
    deleteRows: (expectedBaseInstanceId, expectedRevision, rowIds, signal) =>
      client.deleteRows(expectedBaseInstanceId, expectedRevision, rowIds, signal),
    getAttachment: (attachmentId, signal) => client.getAttachment(attachmentId, signal),
    getAttachmentDataUrl: (attachmentId, signal) => client.getAttachmentDataUrl(attachmentId, signal),
    workspaceFiles: (signal) => client.request("/_api/workspace/files", signal),
    workspaceVersions: (file, signal) =>
      client.request("/_api/workspace/versions?file=" + encodeURIComponent(file), signal),
    workspaceSourceLine: (file, htmlHint, signal) =>
      client.request("/_api/workspace/source-line?file=" + encodeURIComponent(file) +
        "&hint=" + encodeURIComponent(htmlHint), signal),
    previewUrl: (file) => {
      if (!fragment.surfaceLeaseId) throw new Error("Workspace preview surface missing");
      var canonical = String(file || "").replace(/^design\//, "");
      if (!canonical || canonical.includes("\\") || canonical.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("Workspace preview path invalid");
      }
      return "/_preview/" + fragment.surfaceLeaseId + "/design/" + canonical.split("/").map(encodeURIComponent).join("/");
    },
    workspaceVersionUrl: (versionId) => {
      if (!fragment.surfaceLeaseId) throw new Error("Workspace preview surface missing");
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(versionId || ""))) {
        throw new Error("Workspace version identity invalid");
      }
      return "/_preview/" + fragment.surfaceLeaseId + "/versions/" + versionId + ".html";
    },
    startPolling: (onSnapshot, onError, interval) => client.startPolling(onSnapshot, onError, interval),
    stopPolling: () => client.stopPolling(),
    hostAction: (action) => {
      if (!fragment.hostOrigin) throw new Error("Base GUI host origin missing");
      var requestId = "host_" + Date.now().toString(36) + "_" + (++requestSequence).toString(36);
      return new Promise(function (resolve, reject) {
        var timer = global.setTimeout(function () {
          pendingActions.delete(requestId);
          reject(new Error("Host action acknowledgement timed out"));
        }, 5_000);
        pendingActions.set(requestId, { resolve: resolve, reject: reject, timer: timer });
        global.parent.postMessage(
          { channel: CHANNEL, token: fragment.token, requestId: requestId, action: action },
          fragment.hostOrigin
        );
      });
    },
    composeText: (text) => {
      if (typeof text !== "string" || !text || new global.TextEncoder().encode(text).byteLength > HOST_ACTION_BYTE_LIMIT) {
        throw new Error("compose-text exceeds the 32 KiB limit");
      }
      return api.hostAction({ type: "compose-text", text });
    },
  };
  global.addEventListener("message", function (event) {
    if (event.source !== global.parent || (fragment.hostOrigin !== "*" && event.origin !== fragment.hostOrigin)) return;
    var result = event.data;
    if (!result || result.channel !== RESULT_CHANNEL || typeof result.requestId !== "string" || typeof result.ok !== "boolean") return;
    var pending = pendingActions.get(result.requestId);
    if (!pending) return;
    pendingActions.delete(result.requestId);
    global.clearTimeout(pending.timer);
    if (result.ok) pending.resolve(true);
    else pending.reject(new Error(typeof result.error === "string" && result.error ? result.error : "Host action was rejected"));
  });
  Object.defineProperty(global, "BottegaBase", { value: Object.freeze(api), configurable: false, writable: false });
})(globalThis);
