/**
 * [INPUT]: Depends on Electron app paths, Node fs, the frozen legacy Base GUI SDK digest verifier, and local ReactGrab assets
 * [OUTPUT]: Provides digest-verified in-memory legacy SDK serving, once-escaped ReactGrab injection halves, and the renderer-side injection script
 * [POS]: AppGateway frozen-asset leaf; the route authority owns admission and CSP while this module owns trusted byte custody
 */

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { app } from "electron";
import { asError } from "../../errors";
import { BASE_GUI_CSP } from "../base-gui/gateway-policy";
import type { ReactGrabInjection } from "../base-gui/gateway-file-server";
import { readVerifiedLegacyBaseGuiSdk } from "../gui-build/metadata";

const DISABLED: ReactGrabInjection = { enabled: false, head: "", tail: "" };

export class GatewayFrozenAssets {
  private script = "";
  private style = "";
  private injection: ReactGrabInjection = DISABLED;
  private legacySdk: Promise<Buffer | null> | null = null;

  /* 资产是进程级常量：HTML 转义与拼接一次做完，逐请求只剩把 nonce 插进中缝。
     每条 HTML 响应重跑两次全局正则，是在为一份永不改变的字节反复收费。 */
  async load() {
    try {
      /* `app` 在测试宿主里根本不存在：读它必须与读盘同罪，一起被这层
         catch 兜住，否则网关连启动都启动不了。 */
      const root = app.isPackaged
        ? join(process.resourcesPath, "react-grab")
        : join(app.getAppPath(), "node_modules", "react-grab", "dist");
      const [script, style] = await Promise.all([
        readFile(join(root, "index.global.js"), "utf8"),
        readFile(join(root, "styles.css"), "utf8"),
      ]);
      this.adoptReactGrab(script, style);
    } catch (cause) {
      this.script = "";
      this.style = "";
      this.injection = DISABLED;
      console.warn(
        `[apps] react-grab 资产不可用，组件选取静默降级：${asError(cause).message}`
      );
    }
  }

  /** load() 之外唯一的写入口：字节进来，转义与拼接在这里一次做完。 */
  adoptReactGrab(script: string, style: string) {
    this.script = script;
    this.style = style;
    this.injection = {
      enabled: true,
      head: `<style id="ai-chat-react-grab-style">${style.replace(/<\/style/gi, "<\\/style")}</style><script`,
      tail: `>${script.replace(/<\/script/gi, "<\\/script")}</script>`,
    };
  }

  get reactGrab() {
    return this.injection;
  }

  /** Electron `executeJavaScript` 消费的是原始字节，不走 HTML 转义那条路。 */
  serverInjectionJavascript() {
    if (!this.injection.enabled) return "";
    return `(() => {
      if (!document.getElementById("ai-chat-react-grab-style")) {
        const style = document.createElement("style");
        style.id = "ai-chat-react-grab-style";
        style.textContent = ${JSON.stringify(this.style)};
        document.head.appendChild(style);
      }
      if (!window.__REACT_GRAB__) {
        ${this.script}
      }
    })();`;
  }

  async serveLegacySdk(
    pathname: string,
    request: IncomingMessage,
    response: ServerResponse
  ) {
    response.setHeader("content-security-policy", BASE_GUI_CSP);
    response.setHeader("cache-control", "no-store");
    if (pathname.toLowerCase() !== "/_sdk/base-api.js") {
      respond(response, 404, "GUI SDK 资源不存在");
      return;
    }
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      respond(response, 405, "请求方法不受支持");
      return;
    }
    const body = await this.loadLegacySdk();
    if (!body) {
      respond(response, 503, "GUI SDK 资源不可用");
      return;
    }
    response.statusCode = 200;
    response.setHeader("content-type", "text/javascript; charset=utf-8");
    response.setHeader("content-length", String(body.byteLength));
    response.end(method === "HEAD" ? undefined : body);
  }

  /* PRD D31/§7.5：legacy SDK 字节先过冻结的产品摘要，再常驻内存。逐请求读盘与
     「读到什么就发什么」是同一个缺陷的两面，验证一次后两者一起消失。 */
  private loadLegacySdk() {
    this.legacySdk ??= readVerifiedLegacyBaseGuiSdk(app.isPackaged
      ? join(process.resourcesPath, "gui-sdk")
      : join(app.getAppPath(), "resources", "gui-sdk")).catch(() => null).then((body) => {
        if (!body) console.warn("[apps] GUI SDK 字节未通过冻结产品摘要校验，legacy Base GUI 已断供");
        return body;
      });
    return this.legacySdk;
  }
}

function respond(response: ServerResponse, status: number, message: string) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}
