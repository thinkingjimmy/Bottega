/**
 * [INPUT]: Depends on Electron packaging, the shared development root, Node fs and the frozen legacy SDK digest verifier.
 * [OUTPUT]: Provides digest-verified in-memory legacy SDK serving, a ReactGrab injection renderer whose 685 KB of script and CSS stay resident as Buffers rather than JS strings, and the renderer-side injection script
 * [POS]: AppGateway frozen-asset leaf; the route authority owns admission and CSP while this module owns trusted byte custody
 */

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { app } from "electron";
import { asError } from "../../errors";
import { desktopDevelopmentRoot } from "../../system-skills";
import { BASE_GUI_CSP } from "../base-gui/gateway-policy";
import type { ReactGrabInjection } from "../base-gui/gateway-file-server";
import { readVerifiedLegacyBaseGuiSdk } from "../gui-build/metadata";

const DISABLED: ReactGrabInjection = { enabled: false, render: () => "" };

/* ── 一份字节，一次驻留 ──────────────────────────────────────────
 * react-grab 的 script + CSS 是 685 KB。从前它们以四份 JS 字符串常驻：
 * 原文两份、转义后的 head/tail 两份，而 V8 把源码字符串按双字节存——
 * 主进程为一段永不执行的注入负载白背了约 2.7 MB。
 *
 * 现在只留两个 Buffer（单字节，且不在 JS 堆上），HTML 注入串与
 * executeJavaScript 负载都在被要的那一刻才拼。代价是每次页面加载多跑两遍
 * 全局正则（实测两位数毫秒以内，且只发生在 text/html 响应上），换来的是
 * 空闲态完全不为它付费。静态资源请求根本不碰这条路。
 * ────────────────────────────────────────────────────────────── */
export class GatewayFrozenAssets {
  private script: Buffer | null = null;
  private style: Buffer | null = null;
  private injection: ReactGrabInjection = DISABLED;
  private legacySdk: Promise<Buffer | null> | null = null;

  async load() {
    try {
      /* `app` 在测试宿主里根本不存在：读它必须与读盘同罪，一起被这层
         catch 兜住，否则网关连启动都启动不了。 */
      const root = app.isPackaged
        ? join(process.resourcesPath, "react-grab")
        : join(desktopDevelopmentRoot(), "node_modules", "react-grab", "dist");
      const [script, style] = await Promise.all([
        readFile(join(root, "index.global.js")),
        readFile(join(root, "styles.css")),
      ]);
      this.adoptReactGrab(script, style);
    } catch (cause) {
      this.script = null;
      this.style = null;
      this.injection = DISABLED;
      console.warn(
        `[apps] react-grab 资产不可用，组件选取静默降级：${asError(cause).message}`
      );
    }
  }

  /** load() 之外唯一的写入口：进来的就是字节，转义留到被要的那一刻。 */
  adoptReactGrab(script: Buffer, style: Buffer) {
    this.script = script;
    this.style = style;
    this.injection = { enabled: true, render: (nonce) => this.renderInjection(nonce) };
  }

  get reactGrab() {
    return this.injection;
  }

  /** Electron `executeJavaScript` 消费的是原始字节，不走 HTML 转义那条路。 */
  serverInjectionJavascript() {
    if (!this.script || !this.style) return "";
    return `(() => {
      if (!document.getElementById("ai-chat-react-grab-style")) {
        const style = document.createElement("style");
        style.id = "ai-chat-react-grab-style";
        style.textContent = ${JSON.stringify(this.style.toString("utf8"))};
        document.head.appendChild(style);
      }
      if (!window.__REACT_GRAB__) {
        ${this.script.toString("utf8")}
      }
    })();`;
  }

  /* nonce 落在 `<script` 与 `>` 之间的那道中缝里，与从前 head/tail 两半拼出来
     的结果逐字节相同。 */
  private renderInjection(nonce: string | undefined) {
    if (!this.script || !this.style) return "";
    const style = this.style.toString("utf8").replace(/<\/style/gi, "<\\/style");
    const script = this.script.toString("utf8").replace(/<\/script/gi, "<\\/script");
    return `<style id="ai-chat-react-grab-style">${style}</style><script${
      nonce ? ` nonce="${nonce}"` : ""
    }>${script}</script>`;
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
      : join(desktopDevelopmentRoot(), "resources", "gui-sdk")).catch(() => null).then((body) => {
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
