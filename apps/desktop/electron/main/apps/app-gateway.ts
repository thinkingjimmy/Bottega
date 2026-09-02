/**
 * [INPUT]: Depends on Electron app/session, Node http/fs/net/path/crypto, http-proxy, generation bindings, the frozen legacy GUI SDK digest, and local ReactGrab assets
 * [OUTPUT]: Provides AppGateway with fixed-origin static/proxy/Base GUI hosting, digest-verified in-memory legacy SDK serving, explicit TCP connection custody at shutdown, finally-released static generation leases, transport-bound proxy/WS leases, per-preview opaque origins, self-only generic egress CSP, nonce-bound static injection, and pre-publication worker/cache cleanup
 * [POS]: The apps module network boundary; one route authority owns containment, CSP composition, lifecycle storage reset, proxying, and request admission
 */

import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { createServer, type Server as NetServer } from "node:net";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { app, session } from "electron";
import httpProxy from "http-proxy";
import { asError } from "../errors";
import {
  GatewayConnectionCustody,
  GatewayRequestLeaseRegistry,
  type GatewayGenerationBinding,
} from "./gateway-request-leases";
import type { BaseGuiLiveBinding } from "../../../shared/apps-ipc";
import type { WorkspacePreviewHandler } from "./base-gui/workspace-preview";
import {
  appContentSecurityPolicy,
  appendContentSecurityPolicy,
  BASE_GUI_CSP,
  decodePathname,
  gatewayIdentityFromHostname,
  gatewayRouteKey,
  isApiPath,
  isSdkPath,
  type GatewayHostIdentity,
} from "./base-gui/gateway-policy";
import {
  serveGatewayFile,
  type GatewayBaseGuiFileRoute,
  type GatewayStaticFileRoute,
} from "./base-gui/gateway-file-server";
import { readVerifiedLegacyBaseGuiSdk } from "./gui-build/metadata";

const DEFAULT_PORT = 4700;

type StaticRoute = GatewayStaticFileRoute;

/**
 * base 型 App 的 `gui/` 独立路由类型：与 static 共用 containment 解析，
 * 但独占 `_api` 截获与禁外联 CSP，且**绝不注入 ReactGrab**——注入的 inline
 * script 与 `script-src 'self'` 天然互斥，同用一型必然自相矛盾。
 */
type BaseGuiRoute = GatewayBaseGuiFileRoute;

type ProxyRoute = {
  type: "proxy";
  upstreamPort: number;
};

/* route 必须绑定它是哪一代发布的：origin 是 `<appId>.localhost`，跨代不变，
   只凭 origin 放行等于让长寿命 iframe/WS 永久继承旧代的能力（风险 11）。 */
type GatewayRoute = (StaticRoute | ProxyRoute) & {
  binding: GatewayGenerationBinding;
} | BaseGuiRoute;

export type BaseGuiApiHandler = (
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>;

type GatewaySettings = {
  port: number;
};

const WORKER_STORAGES = ["serviceworkers", "cachestorage"] as const;
type WorkerStorageCleaner = (
  origin: string,
  storages: typeof WORKER_STORAGES
) => Promise<void>;

export class AppGateway {
  private readonly routes = new Map<string, GatewayRoute>();
  private readonly settingsPath: string;
  private readonly proxy = httpProxy.createProxyServer({ ws: true });
  private readonly connections = new GatewayConnectionCustody();
  private server: Server | null = null;
  private port = DEFAULT_PORT;
  private reactGrabScript = "";
  private reactGrabStyle = "";
  private reactGrabEnabled = false;
  private baseGuiApi: BaseGuiApiHandler | null = null;
  private workspacePreview: WorkspacePreviewHandler | null = null;
  private legacyGuiSdk: Promise<Buffer | null> | null = null;
  readonly requestLeases = new GatewayRequestLeaseRegistry();
  /* Gateway 不认识 AppStore，只问某条 exact generation binding 是否仍可路由。
     promotion 后 active 与 bounded draining surface 可并存，绝不透明转代。 */
  private isRoutableBinding: (
    appId: string,
    binding: GatewayGenerationBinding
  ) => boolean = () => false;
  private validateSurfaceLease: (
    surfaceLeaseId: string
  ) => Promise<void> = async () => {
    throw Object.assign(new Error("App surface lease validator unavailable"), {
      status: 503,
    });
  };

  constructor(
    userData: string,
    private readonly onWarning: (message: string) => void,
    private readonly clearWorkerStorage: WorkerStorageCleaner = (
      origin,
      storages
    ) =>
      session.defaultSession.clearStorageData({
        origin,
        storages: [...storages],
      })
  ) {
    this.settingsPath = join(userData, "apps-settings.json");
    this.proxy.on("proxyReq", (proxyRequest, request) => {
      const route = this.routeFromRequest(request);
      if (route?.type === "proxy") {
        proxyRequest.setHeader("host", `127.0.0.1:${route.upstreamPort}`);
      }
    });
    this.proxy.on("proxyRes", (proxyResponse, request) => {
      const identity = this.identityFromRequest(request);
      const appId = identity?.appId;
      const route = identity ? this.routeFor(identity) : undefined;
      if (!appId || route?.type !== "proxy") return;
      /* 上游策略与宿主策略是两个独立 policy，浏览器按交集执行。覆盖上游头
         会把更严格的 App 自身规则放松，安全边界不能这样合并。 */
      appendContentSecurityPolicy(
        proxyResponse.headers,
        appContentSecurityPolicy()
      );
      const location = proxyResponse.headers.location;
      if (!location) return;
      const upstreamOrigins = [
        `http://127.0.0.1:${route.upstreamPort}`,
        `http://localhost:${route.upstreamPort}`,
      ];
      const source = upstreamOrigins.find((origin) =>
        location.startsWith(origin)
      );
      if (source) {
        proxyResponse.headers.location = `${this.getOrigin(appId)}${location.slice(source.length)}`;
      }
    });
  }

  async start() {
    try {
      await this.loadReactGrabAssets();
      this.reactGrabEnabled = true;
    } catch (cause) {
      this.reactGrabScript = "";
      this.reactGrabStyle = "";
      this.reactGrabEnabled = false;
      console.warn(`[apps] react-grab 资产不可用，组件选取静默降级：${asError(cause).message}`);
    }
    const saved = await this.readSettings();
    const candidates = saved
      ? [saved.port, ...this.candidatePorts().filter((port) => port !== saved.port)]
      : this.candidatePorts();
    let lastError: Error | null = null;
    for (const candidate of candidates) {
      try {
        this.server = await this.listen(candidate);
        this.port = candidate;
        await this.writeSettings({ port: candidate });
        if (saved && saved.port !== candidate) {
          this.onWarning(
            `App 网关端口 ${saved.port} 被占用，已切换到 ${candidate}；App 本地数据将重置。`
          );
        }
        return;
      } catch (cause) {
        lastError = asError(cause);
      }
    }
    throw lastError ?? new Error("无法启动 App 网关");
  }

  async close() {
    this.proxy.close();
    const server = this.server;
    this.server = null;
    if (!server) return;
    await this.connections.close(server);
  }

  getOrigin(appId: string) {
    return `http://${appId}.localhost:${this.port}`;
  }

  getSurfaceOrigin(appId: string, surfaceId: string) {
    return `http://${surfaceId}.${appId}.localhost:${this.port}`;
  }

  isRegisteredOrigin(value: string) {
    return Boolean(this.routeFromOrigin(value));
  }

  /** base-gui 的 origin 不享有 static/server 的权限例外（如剪贴板写）。 */
  isBaseGuiOrigin(value: string) {
    return this.routeFromOrigin(value)?.type === "base-gui";
  }

  /** Document navigations are narrower than HTTP resources served by the origin. */
  isAllowedBaseGuiDocumentUrl(value: string) {
    try {
      const url = new URL(value);
      const route = this.routeFromOrigin(url.origin);
      if (route?.type !== "base-gui" || url.search) return false;
      if (url.pathname === "/index.html") return true;
      const leaseId = route.binding.appSurfaceLeaseId;
      if (!leaseId) return false;
      /* 白名单必须与服务面同步：/versions/ 是网关在服务、SDK 在生成的既有路由，
         漏在这里等于把已交付的历史预览闷死在导航围栏后面。 */
      return (
        (url.pathname.startsWith(`/_preview/${leaseId}/design/`) &&
          url.pathname.toLowerCase().endsWith(".html")) ||
        /^\/_preview\/[^/]+\/versions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/.test(
          url.pathname
        ) && url.pathname.startsWith(`/_preview/${leaseId}/`)
      );
    } catch {
      return false;
    }
  }

  private routeFromOrigin(value: string) {
    try {
      const url = new URL(value);
      const identity = gatewayIdentityFromHostname(url.hostname);
      if (url.protocol !== "http:" || Number(url.port) !== this.port || !identity) {
        return undefined;
      }
      return this.routeFor(identity);
    } catch {
      return undefined;
    }
  }

  configureGenerationResolver(
    resolver: (appId: string, binding: GatewayGenerationBinding) => boolean
  ): void;
  configureGenerationResolver(
    resolver: (appId: string) => GatewayGenerationBinding | null
  ): void;
  configureGenerationResolver(
    resolver:
      | ((appId: string, binding: GatewayGenerationBinding) => boolean)
      | ((appId: string) => GatewayGenerationBinding | null)
  ) {
    this.isRoutableBinding = (appId, binding) => {
      const result = (
        resolver as (
          appId: string,
          binding: GatewayGenerationBinding
        ) => boolean | GatewayGenerationBinding | null
      )(appId, binding);
      return typeof result === "boolean"
        ? result
        : result?.generationId === binding.generationId &&
            result.lifecycleRevision === binding.lifecycleRevision;
    };
  }

  configureBaseGuiSurfaceValidator(
    validator: (surfaceLeaseId: string) => Promise<unknown>
  ) {
    this.validateSurfaceLease = async (surfaceLeaseId) => {
      await validator(surfaceLeaseId);
    };
  }

  attachBaseGuiApi(handler: BaseGuiApiHandler) {
    this.baseGuiApi = handler;
  }

  attachWorkspacePreview(handler: WorkspacePreviewHandler) {
    this.workspacePreview = handler;
  }

  async registerStatic(
    appId: string,
    root: string,
    binding: GatewayGenerationBinding
  ) {
    const rootReal = await realpath(root);
    await this.clearAppWorkerState(appId);
    this.routes.set(appId, { type: "static", root, rootReal, binding });
  }

  /** 调用方须已完成 appDir 父边界校验；此处只固化 canonical 根供逐请求 containment。 */
  registerBaseGui(
    appId: string,
    surfaceId: string,
    root: string,
    rootReal: string,
    binding: BaseGuiLiveBinding
  ) {
    this.routes.set(gatewayRouteKey({ appId, surfaceId }), {
      type: "base-gui",
      surfaceId,
      root,
      rootReal,
      binding,
    });
  }

  isBaseGuiRegistered(appId: string, surfaceId?: string) {
    if (surfaceId) {
      return this.routes.get(gatewayRouteKey({ appId, surfaceId }))?.type === "base-gui";
    }
    return [...this.routes.values()].some(
      (route) => route.type === "base-gui" && route.binding.appId === appId
    );
  }

  unregisterBaseGuiSurface(appId: string, surfaceId: string) {
    this.routes.delete(gatewayRouteKey({ appId, surfaceId }));
  }

  unregisterBaseGuiApp(appId: string) {
    const removed: Array<{ surfaceId: string }> = [];
    for (const [key, route] of this.routes) {
      if (route.type !== "base-gui" || route.binding.appId !== appId) continue;
      removed.push({ surfaceId: route.surfaceId });
      this.routes.delete(key);
    }
    return removed;
  }

  /**
   * origin 跨 generation 固定，旧 Service Worker 不能跟着 origin 继承下一代能力。
   * CSP 负责阻止新注册；这里清掉升级前已经落盘的 worker 与其 cache。
   */
  clearAppWorkerState(appId: string) {
    return this.clearWorkerStorage(this.getOrigin(appId), WORKER_STORAGES);
  }

  clearSurfaceWorkerState(appId: string, surfaceId: string) {
    return this.clearWorkerStorage(this.getSurfaceOrigin(appId, surfaceId), WORKER_STORAGES);
  }

  async registerProxy(
    appId: string,
    upstreamPort: number,
    binding: GatewayGenerationBinding
  ) {
    await this.clearAppWorkerState(appId);
    this.routes.set(appId, { type: "proxy", upstreamPort, binding });
  }

  unregister(appId: string) {
    this.routes.delete(appId);
    this.unregisterBaseGuiApp(appId);
  }

  getServerInjectionJavascript() {
    if (!this.reactGrabEnabled) return "";
    const style = JSON.stringify(this.reactGrabStyle);
    return `(() => {
      if (!document.getElementById("ai-chat-react-grab-style")) {
        const style = document.createElement("style");
        style.id = "ai-chat-react-grab-style";
        style.textContent = ${style};
        document.head.appendChild(style);
      }
      if (!window.__REACT_GRAB__) {
        ${this.reactGrabScript}
      }
    })();`;
  }

  async allocateUpstreamPort() {
    for (let port = 4100; port < 4700; port += 1) {
      if (await this.canListen(port)) return port;
    }
    throw new Error("没有可用的 App 内部端口");
  }

  private candidatePorts() {
    return Array.from({ length: 10 }, (_, index) => DEFAULT_PORT + index);
  }

  private async listen(port: number) {
    const server = createHttpServer((request, response) => {
      void this.handleRequest(request, response).catch((cause) =>
        this.handleRequestFailure(response, cause)
      );
    });
    server.on("connection", (connection) => this.connections.track(connection));
    server.on("upgrade", (request, socket, head) => {
      const identity = this.identityFromRequest(request);
      const appId = identity?.appId;
      const route = identity ? this.routeFor(identity) : undefined;
      if (!appId || route?.type !== "proxy") {
        socket.destroy();
        return;
      }
      /* WS 是最长寿的那一类连接：它必须与 HTTP 走同一道 generation 门，
         并且 lease 活到 socket 真的关闭为止，drain 才等得到零。 */
      const leaseId = this.admitRequest(appId, route, request);
      if (!leaseId) {
        socket.destroy();
        return;
      }
      socket.once("close", () => this.requestLeases.release(leaseId));
      this.proxy.ws(
        request,
        socket,
        head,
        {
          target: `http://127.0.0.1:${route.upstreamPort}`,
          changeOrigin: true,
        },
        () => socket.destroy()
      );
    });
    await new Promise<void>((resolvePromise, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolvePromise();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    return server;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ) {
    const identity = this.identityFromRequest(request);
    const appId = identity?.appId;
    const route = identity ? this.routeFor(identity) : undefined;
    if (
      appId &&
      identity?.surfaceId &&
      !route &&
      await this.serveOpaqueWorkspacePreview(
        appId,
        identity.surfaceId,
        request,
        response
      )
    ) return;
    if (!appId || !route) {
      this.respond(response, 404, "App 未运行或 Host 无效");
      return;
    }
    if (route.type === "base-gui") {
      try {
        if (
          identity?.surfaceId !== route.surfaceId ||
          route.binding.surfaceId !== route.surfaceId ||
          !route.binding.appSurfaceLeaseId
        ) {
          throw Object.assign(new Error("GUI surface binding mismatch"), {
            status: 401,
          });
        }
        await this.validateSurfaceLease(route.binding.appSurfaceLeaseId);
      } catch (cause) {
        const status = Number((cause as { status?: unknown }).status);
        this.respondBaseGuiError(
          response,
          status === 410 ? 410 : status === 503 ? 503 : 401,
          status === 410 ? "surface_gone" : "surface_invalid",
          status === 410 ? "App surface 已关闭" : "App surface 无效"
        );
        return;
      }
    }
    /* 每请求复核，而不是只在签发 origin 时看一眼：origin 跨代不变，
       长寿命 iframe 会带着旧代的 URL 一直敲门（风险 11）。 */
    const leaseId = this.admitRequest(appId, route, request);
    if (!leaseId) {
      const pathname = route.type === "base-gui" ? decodePathname(request) : null;
      if (pathname && (isApiPath(pathname) || isSdkPath(pathname))) {
        this.respondBaseGuiError(
          response,
          410,
          "generation_stale",
          "App 版本已切换或已停止，请重新打开"
        );
      } else {
        this.respond(response, 410, "App 版本已切换或已停止，请重新打开");
      }
      return;
    }
    const release = () => this.requestLeases.release(leaseId);
    if (route.type === "base-gui") {
      const pathname = decodePathname(request);
      if (pathname === null) {
        release();
        this.respond(response, 400, "请求路径无效");
        return;
      }
      if (pathname.startsWith("/_api/workspace/") || pathname.startsWith("/_preview/")) {
        if (!this.workspacePreview) {
          release();
          this.respondBaseGuiError(
            response,
            503,
            "workspace_preview_unavailable",
            "Workspace preview 尚未就绪"
          );
          return;
        }
        try {
          await this.workspacePreview(
            { appId, binding: route.binding },
            pathname,
            request,
            response
          );
        } finally {
          release();
        }
        return;
      }
      if (isSdkPath(pathname)) {
        try {
          await this.serveBaseGuiSdk(pathname, request, response);
        } finally {
          release();
        }
        return;
      }
      if (isApiPath(pathname)) {
        if (!this.baseGuiApi) {
          release();
          this.respond(response, 503, "Base API 尚未就绪");
          return;
        }
        try {
          await this.baseGuiApi(
            { appId, binding: route.binding },
            pathname,
            request,
            response
          );
        } finally {
          /* 客户端 close 只代表不再等响应；Base commit 已入队时 lease 必须
             活到 handler Promise settle，cutover/delete 才不会越过旧副作用。 */
          release();
        }
        return;
      }
    }
    if (route.type === "proxy") {
      response.once("close", release);
      response.once("finish", release);
      this.proxy.web(
        request,
        response,
        {
          target: `http://127.0.0.1:${route.upstreamPort}`,
          changeOrigin: true,
        },
        (error) => {
          if (!response.headersSent) {
            this.respond(response, 502, `App 上游不可用：${error.message}`);
          } else {
            response.destroy(error);
          }
        }
      );
      return;
    }
    const pathname = decodePathname(request);
    if (pathname === null) {
      this.respond(response, 400, "请求路径无效");
      return;
    }
    try {
      await serveGatewayFile({
        route,
        pathname,
        request,
        response,
        baseGuiCsp: route.type === "base-gui"
          ? `${BASE_GUI_CSP}; frame-src http://*.${route.binding.appId}.localhost:${this.port}`
          : BASE_GUI_CSP,
        reactGrab: {
          enabled: this.reactGrabEnabled,
          script: this.reactGrabScript,
          style: this.reactGrabStyle,
        },
      });
    } finally {
      release();
    }
  }

  private async serveBaseGuiSdk(
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    response.setHeader("content-security-policy", BASE_GUI_CSP);
    response.setHeader("cache-control", "no-store");
    if (pathname.toLowerCase() !== "/_sdk/base-api.js") {
      this.respond(response, 404, "GUI SDK 资源不存在");
      return;
    }
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      this.respond(response, 405, "请求方法不受支持");
      return;
    }
    const body = await this.loadLegacyGuiSdk();
    if (!body) {
      this.respond(response, 503, "GUI SDK 资源不可用");
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.setHeader("content-length", String(body.byteLength));
    response.end(method === "HEAD" ? undefined : body);
  }

  /* PRD D31/§7.5：legacy SDK 字节先过冻结的产品摘要，再常驻内存。逐请求读盘与
     「读到什么就发什么」是同一个缺陷的两面，验证一次后两者一起消失。 */
  private loadLegacyGuiSdk() {
    this.legacyGuiSdk ??= readVerifiedLegacyBaseGuiSdk(app.isPackaged
      ? join(process.resourcesPath, "gui-sdk")
      : join(app.getAppPath(), "resources", "gui-sdk")).catch(() => null).then((body) => {
        if (!body) console.warn("[apps] GUI SDK 字节未通过冻结产品摘要校验，legacy Base GUI 已断供");
        return body;
      });
    return this.legacyGuiSdk;
  }

  private identityFromRequest(request: IncomingMessage) {
    const host = (request.headers.host ?? "").split(":")[0];
    return gatewayIdentityFromHostname(host);
  }

  private routeFor(identity: GatewayHostIdentity) {
    return this.routes.get(gatewayRouteKey(identity));
  }

  private async serveOpaqueWorkspacePreview(
    appId: string,
    handle: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    const preview = this.workspacePreview;
    const binding = preview?.resolveOpaqueOrigin(appId, handle);
    if (!preview || !binding?.appSurfaceLeaseId) return false;
    try {
      await this.validateSurfaceLease(binding.appSurfaceLeaseId);
    } catch (cause) {
      const status = Number((cause as { status?: unknown }).status);
      this.respondBaseGuiError(
        response,
        status === 410 ? 410 : 401,
        status === 410 ? "surface_gone" : "surface_invalid",
        status === 410 ? "App surface 已关闭" : "App surface 无效"
      );
      return true;
    }
    if (!this.isRoutableBinding(appId, binding)) {
      this.respondBaseGuiError(
        response,
        410,
        "generation_stale",
        "App 版本已切换或已停止，请重新打开"
      );
      return true;
    }
    const leaseId = this.requestLeases.acquire(appId, binding, requestEvidence(request));
    if (!leaseId) {
      this.respondBaseGuiError(response, 409, "cutover_admission_closed", "App 正在切换版本");
      return true;
    }
    try {
      await preview.serveOpaqueOrigin(appId, handle, request, response);
    } finally {
      this.requestLeases.release(leaseId);
    }
    return true;
  }

  /* 放行三条件：admission 未关、route 仍在、且它绑定的那一代仍是 active。
     任一不成立都不放行——「透明转到新代」正是这里禁止的事。 */
  private admitRequest(appId: string, route: GatewayRoute, request: IncomingMessage) {
    if (!this.isRoutableBinding(appId, route.binding)) return null;
    return this.requestLeases.acquire(appId, route.binding, requestEvidence(request));
  }

  private routeFromRequest(request: IncomingMessage) {
    const identity = this.identityFromRequest(request);
    return identity ? this.routeFor(identity) : undefined;
  }

  private respond(response: ServerResponse, status: number, message: string) {
    if (response.destroyed || response.writableEnded) return;
    response.statusCode = status;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(message);
  }

  private respondBaseGuiError(
    response: ServerResponse,
    status: number,
    code: string,
    message: string
  ) {
    if (response.destroyed || response.writableEnded) return;
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.end(JSON.stringify({ error: { code, message, outcome: "not-committed" } }));
  }

  private handleRequestFailure(response: ServerResponse, cause: unknown) {
    if (response.destroyed || response.writableEnded) return;
    const error = asError(cause);
    console.error("[apps] static gateway request failed", error);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    this.respond(response, 500, "静态资源读取失败，请稍后重试");
  }

  private async canListen(port: number) {
    let server: NetServer | null = createServer();
    try {
      await new Promise<void>((resolvePromise, reject) => {
        server!.once("error", reject);
        server!.listen(port, "127.0.0.1", resolvePromise);
      });
      return true;
    } catch {
      return false;
    } finally {
      if (server?.listening) {
        await new Promise<void>((resolvePromise) =>
          server!.close(() => resolvePromise())
        );
      }
      server = null;
    }
  }

  private async loadReactGrabAssets() {
    const root = app.isPackaged
      ? join(process.resourcesPath, "react-grab")
      : join(app.getAppPath(), "node_modules", "react-grab", "dist");
    [this.reactGrabScript, this.reactGrabStyle] = await Promise.all([
      readFile(join(root, "index.global.js"), "utf8"),
      readFile(join(root, "styles.css"), "utf8"),
    ]);
  }

  private async readSettings(): Promise<GatewaySettings | null> {
    try {
      const parsed = JSON.parse(await readFile(this.settingsPath, "utf8"));
      return Number.isInteger(parsed.port) ? { port: parsed.port } : null;
    } catch {
      return null;
    }
  }

  private async writeSettings(settings: GatewaySettings) {
    const temporary = `${this.settingsPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.settingsPath);
  }
}

function requestEvidence(request: IncomingMessage) {
  return `${request.method ?? "GET"} ${request.url ?? "/"}`;
}
