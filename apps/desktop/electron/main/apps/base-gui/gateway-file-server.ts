/**
 * [INPUT]: Depends on canonical static/Base GUI roots, Node fs/path/streams, gateway MIME/CSP policy, and optional trusted ReactGrab assets
 * [OUTPUT]: Provides contained no-follow static artifact delivery, Base GUI CSP delivery, HEAD handling, and nonce-bound non-Base HTML instrumentation
 * [POS]: Base GUI gateway file-serving leaf; AppGateway owns route/admission while this module owns byte projection
 */

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { BaseGuiLiveBinding } from "../../../../shared/apps-ipc";
import { isContained } from "../support";
import { appContentSecurityPolicy, MIME_TYPES } from "./gateway-policy";

export type GatewayStaticFileRoute = Readonly<{
  type: "static";
  root: string;
  rootReal: string;
}>;

export type GatewayBaseGuiFileRoute = Readonly<{
  type: "base-gui";
  surfaceId: string;
  root: string;
  rootReal: string;
  binding: BaseGuiLiveBinding;
}>;

export async function serveGatewayFile(input: Readonly<{
  route: GatewayStaticFileRoute | GatewayBaseGuiFileRoute;
  pathname: string;
  request: IncomingMessage;
  response: ServerResponse;
  baseGuiCsp: string;
  reactGrab: Readonly<{ enabled: boolean; script: string; style: string }>;
}>) {
  const { route, pathname, request, response } = input;
  const lexical = resolve(route.root, `.${pathname}`);
  if (!isContained(normalize(route.root), lexical)) {
    respond(response, 403, "拒绝访问 App 目录之外的路径");
    return;
  }
  let target = lexical;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
    target = await realpath(target);
    if (!isContained(route.rootReal, target)) {
      respond(response, 403, "拒绝访问符号链接指向的外部路径");
      return;
    }
  } catch {
    target = await realpath(join(route.root, "index.html")).catch(() => "");
    if (!target || !isContained(route.rootReal, target)) {
      respond(response, 404, "静态资源不存在");
      return;
    }
  }
  const contentType =
    MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
  response.statusCode = 200;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  const nonce = route.type === "base-gui" || !input.reactGrab.enabled
    ? undefined
    : randomBytes(18).toString("base64url");
  response.setHeader(
    "content-security-policy",
    route.type === "base-gui" ? input.baseGuiCsp : appContentSecurityPolicy(nonce)
  );
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  if (contentType.startsWith("text/html")) {
    const html = await readFile(target, "utf8");
    response.end(
      route.type === "base-gui"
        ? html
        : injectReactGrab(html, nonce, input.reactGrab)
    );
    return;
  }
  await pipeline(createReadStream(target), response);
}

function injectReactGrab(
  html: string,
  nonce: string | undefined,
  assets: Readonly<{ enabled: boolean; script: string; style: string }>
) {
  if (!assets.enabled) return html;
  const style = assets.style.replace(/<\/style/gi, "<\\/style");
  const script = assets.script.replace(/<\/script/gi, "<\\/script");
  const nonceAttribute = nonce ? ` nonce="${nonce}"` : "";
  const injection = `<style id="ai-chat-react-grab-style">${style}</style><script${nonceAttribute}>${script}</script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${injection}</head>`)
    : `${injection}${html}`;
}

function respond(response: ServerResponse, status: number, message: string) {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(message);
}
