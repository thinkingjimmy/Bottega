/**
 * [INPUT]: Depends on Electron app, Node http/fs/net/path, http-proxy, support Assistant and local react-grab Fixed assets
 * [OUTPUT]: Provides AppGateway with generation-bound BaseGuiApiHandler context, fixed origin hosting/agent App, effect-lifetime lease, independent base-gui routing with Promise/stream error boundaries
 * [POS]: The network isolation of the apps module with HTTP error boundaries, unified by Host routing, containment and injecting
 */

import { createReadStream } from "node:fs";
import {
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server as NetServer } from "node:net";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  extname,
  join,
  normalize,
  posix,
  resolve,
} from "node:path";
import { pipeline } from "node:stream/promises";
import { app, session } from "electron";
import httpProxy from "http-proxy";
import { asError } from "../errors";
import {
  GatewayRequestLeaseRegistry,
  type GatewayGenerationBinding,
} from "./gateway-request-leases";
import { isContained } from "./support";
import type { BaseGuiLiveBinding } from "../../../shared/apps-ipc";

const DEFAULT_PORT = 4700;
const APP_HOST_PATTERN = /^([a-z0-9]{10})\.localhost$/;

/** base-gui 的保留前缀：静态路径解析之前截获，同名 App 文件永不可达。 */
const API_PREFIX = "/_api";
const SDK_PREFIX = "/_sdk";

/**
 * base-gui 的禁外联 CSP，职责边界如实：
 * - 它锁的是**子资源加载与 fetch/XHR/WebSocket 出口**；
 * - 跨源**导航**另有其人——产品既有 fixed-origin guard 与 iframe sandbox（无 top-navigation）；
 * - **WebRTC 它管不到**：Chromium 150 不认 CSP3 `webrtc 'block'`（实测 console 明报
 *   "Unrecognized"，ICE 仍出 host 候选，见 dev/base-gui-csp-probe.cjs），
 *   数据通道出口由 window/security.ts 的 webRTCIPHandlingPolicy 在低层封堵；
 * - `script-src 'self'` 会拦 **inline script**——gui/ 的 JS 必须外置文件引用，
 *   否则整页静默白屏。静态伺服无渲染期，故不采用 per-response nonce。
 *
 * frame-ancestors 必须显式列出 `file:`：CSP 的 `*` **只匹配网络 scheme**，
 * 而打包后的产品 renderer 是 `file://`——写 `*` 等于把自己的 embed 挡死
 * （真机实证：Chromium 150 报 "The scheme 'http:' must be added explicitly"）。
 * 合法宿主只有产品自己：打包态 file://，开发态 vite 的 http://localhost:<port>。
 */
const BASE_GUI_CSP =
  "default-src 'self'; script-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'self' file: http://localhost:*";

type StaticRoute = {
  type: "static";
  root: string;
  rootReal: string;
};

/**
 * base 型 App 的 `gui/` 独立路由类型：与 static 共用 containment 解析，
 * 但独占 `_api` 截获与禁外联 CSP，且**绝不注入 ReactGrab**——注入的 inline
 * script 与 `script-src 'self'` 天然互斥，同用一型必然自相矛盾。
 */
type BaseGuiRoute = {
  type: "base-gui";
  root: string;
  rootReal: string;
  binding: BaseGuiLiveBinding;
};

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

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * 解码后必须做词法归一化再判路由：`%2F` 产出的 `//_api`、`%2E` 产出的
 * `/./_api` 都能骗过前缀判断，却会被磁盘层 resolve 归一化回 `_api/`——
 * 判定与解析看到的必须是同一条路径，否则保留前缀就有影子文件缺口。
 */
function decodePathname(request: IncomingMessage) {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://localhost").pathname
    );
    if (pathname.includes("\0")) return null;
    return posix.normalize(pathname);
  } catch {
    return null;
  }
}

/** 保留段大小写不敏感：macOS APFS 默认大小写不敏感，`/_API/x` 与 `gui/_api/x` 同盘。 */
function isApiPath(pathname: string) {
  const first = pathname.split("/", 2)[1]?.toLowerCase();
  return first === API_PREFIX.slice(1);
}

function isSdkPath(pathname: string) {
  const first = pathname.split("/", 2)[1]?.toLowerCase();
  return first === SDK_PREFIX.slice(1);
}

export class AppGateway {
  private readonly routes = new Map<string, GatewayRoute>();
  private readonly settingsPath: string;
  private readonly proxy = httpProxy.createProxyServer({ ws: true });
  private server: Server | null = null;
  private port = DEFAULT_PORT;
  private reactGrabScript = "";
  private reactGrabStyle = "";
  private reactGrabEnabled = false;
  private baseGuiApi: BaseGuiApiHandler | null = null;
  readonly requestLeases = new GatewayRequestLeaseRegistry();
  /* 窄解析器：gateway 不认识 AppStore，只问「这个 App 此刻的 active 代是什么」。 */
  private activeBinding: (appId: string) => GatewayGenerationBinding | null =
    () => null;

  constructor(
    userData: string,
    private readonly onWarning: (message: string) => void
  ) {
    this.settingsPath = join(userData, "apps-settings.json");
    this.proxy.on("proxyReq", (proxyRequest, request) => {
      const route = this.routeFromRequest(request);
      if (route?.type === "proxy") {
        proxyRequest.setHeader("host", `127.0.0.1:${route.upstreamPort}`);
      }
    });
    this.proxy.on("proxyRes", (proxyResponse, request) => {
      const appId = this.appIdFromRequest(request);
      const route = appId ? this.routes.get(appId) : undefined;
      const location = proxyResponse.headers.location;
      if (!appId || route?.type !== "proxy" || !location) return;
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
      const error = asError(cause);
      console.warn(
        `[apps] react-grab 资产不可用，组件选取静默降级：${error.message}`
      );
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
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    });
  }

  getOrigin(appId: string) {
    return `http://${appId}.localhost:${this.port}`;
  }

  isRegisteredOrigin(value: string) {
    return Boolean(this.routeFromOrigin(value));
  }

  /** base-gui 的 origin 不享有 static/server 的权限例外（如剪贴板写）。 */
  isBaseGuiOrigin(value: string) {
    return this.routeFromOrigin(value)?.type === "base-gui";
  }

  private routeFromOrigin(value: string) {
    try {
      const url = new URL(value);
      const match = url.hostname.match(APP_HOST_PATTERN);
      if (url.protocol !== "http:" || Number(url.port) !== this.port || !match) {
        return undefined;
      }
      return this.routes.get(match[1]);
    } catch {
      return undefined;
    }
  }

  configureGenerationResolver(
    resolver: (appId: string) => GatewayGenerationBinding | null
  ) {
    this.activeBinding = resolver;
  }

  attachBaseGuiApi(handler: BaseGuiApiHandler) {
    this.baseGuiApi = handler;
  }

  async registerStatic(
    appId: string,
    root: string,
    binding: GatewayGenerationBinding
  ) {
    const rootReal = await realpath(root);
    this.routes.set(appId, { type: "static", root, rootReal, binding });
  }

  /** 调用方须已完成 appDir 父边界校验；此处只固化 canonical 根供逐请求 containment。 */
  registerBaseGui(
    appId: string,
    root: string,
    rootReal: string,
    binding: BaseGuiLiveBinding
  ) {
    this.routes.set(appId, { type: "base-gui", root, rootReal, binding });
  }

  isBaseGuiRegistered(appId: string) {
    return this.routes.get(appId)?.type === "base-gui";
  }

  /**
   * origin 跨 generation 固定，旧 Service Worker 不能跟着 origin 继承下一代能力。
   * CSP 负责阻止新注册；这里清掉升级前已经落盘的 worker 与其 cache。
   */
  clearBaseGuiWorkerState(appId: string) {
    return session.defaultSession.clearStorageData({
      origin: this.getOrigin(appId),
      storages: ["serviceworkers", "cachestorage"],
    });
  }

  registerProxy(
    appId: string,
    upstreamPort: number,
    binding: GatewayGenerationBinding
  ) {
    this.routes.set(appId, { type: "proxy", upstreamPort, binding });
  }

  unregister(appId: string) {
    this.routes.delete(appId);
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
    server.on("upgrade", (request, socket, head) => {
      const appId = this.appIdFromRequest(request);
      const route = appId ? this.routes.get(appId) : undefined;
      if (!appId || route?.type !== "proxy") {
        socket.destroy();
        return;
      }
      /* WS 是最长寿的那一类连接：它必须与 HTTP 走同一道 generation 门，
         并且 lease 活到 socket 真的关闭为止，drain 才等得到零。 */
      const leaseId = this.admitRequest(appId, route);
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
    const appId = this.appIdFromRequest(request);
    const route = appId ? this.routes.get(appId) : undefined;
    if (!appId || !route) {
      this.respond(response, 404, "App 未运行或 Host 无效");
      return;
    }
    /* 每请求复核，而不是只在签发 origin 时看一眼：origin 跨代不变，
       长寿命 iframe 会带着旧代的 URL 一直敲门（风险 11）。 */
    const leaseId = this.admitRequest(appId, route);
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
    response.once("close", release);
    response.once("finish", release);
    if (route.type === "proxy") {
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
    await this.serveFile(route, pathname, request, response);
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
    const root = app.isPackaged
      ? join(process.resourcesPath, "gui-sdk")
      : join(app.getAppPath(), "resources", "gui-sdk");
    try {
      const body = await readFile(join(root, "base-api.js"));
      response.statusCode = 200;
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.setHeader("content-length", String(body.byteLength));
      response.end(method === "HEAD" ? undefined : body);
    } catch {
      this.respond(response, 503, "GUI SDK 资源不可用");
    }
  }

  private async serveFile(
    route: StaticRoute | BaseGuiRoute,
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    const lexical = resolve(route.root, `.${pathname}`);
    if (!isContained(normalize(route.root), lexical)) {
      this.respond(response, 403, "拒绝访问 App 目录之外的路径");
      return;
    }

    let target = lexical;
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, "index.html");
      target = await realpath(target);
      if (!isContained(route.rootReal, target)) {
        this.respond(response, 403, "拒绝访问符号链接指向的外部路径");
        return;
      }
    } catch {
      target = await realpath(join(route.root, "index.html")).catch(() => "");
      if (!target || !isContained(route.rootReal, target)) {
        this.respond(response, 404, "静态资源不存在");
        return;
      }
    }

    const contentType =
      MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    response.statusCode = 200;
    response.setHeader("content-type", contentType);
    response.setHeader("cache-control", "no-store");
    if (route.type === "base-gui") {
      response.setHeader("content-security-policy", BASE_GUI_CSP);
    }
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    if (contentType.startsWith("text/html")) {
      const html = await readFile(target, "utf8");
      response.end(
        route.type === "base-gui" ? html : this.injectReactGrab(html)
      );
      return;
    }
    await pipeline(createReadStream(target), response);
  }

  private injectReactGrab(html: string) {
    if (!this.reactGrabEnabled) return html;
    const style = this.reactGrabStyle.replace(/<\/style/gi, "<\\/style");
    const script = this.reactGrabScript.replace(/<\/script/gi, "<\\/script");
    const injection = `<style id="ai-chat-react-grab-style">${style}</style><script>${script}</script>`;
    return html.includes("</head>")
      ? html.replace("</head>", `${injection}</head>`)
      : `${injection}${html}`;
  }

  private appIdFromRequest(request: IncomingMessage) {
    const host = (request.headers.host ?? "").split(":")[0];
    return host.match(APP_HOST_PATTERN)?.[1];
  }

  /* 放行三条件：admission 未关、route 仍在、且它绑定的那一代仍是 active。
     任一不成立都不放行——「透明转到新代」正是这里禁止的事。 */
  private admitRequest(appId: string, route: GatewayRoute) {
    const active = this.activeBinding(appId);
    if (
      !active ||
      active.generationId !== route.binding.generationId ||
      active.lifecycleRevision !== route.binding.lifecycleRevision
    ) {
      return null;
    }
    return this.requestLeases.acquire(appId, route.binding);
  }

  private routeFromRequest(request: IncomingMessage) {
    const appId = this.appIdFromRequest(request);
    return appId ? this.routes.get(appId) : undefined;
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
    response.end(
      JSON.stringify({
        error: { code, message, outcome: "not-committed" },
      })
    );
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
