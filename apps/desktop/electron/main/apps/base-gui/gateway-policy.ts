/**
 * [INPUT]: Depends on Node HTTP request headers and URL/path normalization
 * [OUTPUT]: Provides App gateway host parsing, route keys, reserved-path decoding, MIME lookup, and CSP composition
 * [POS]: Stateless policy leaf for AppGateway; it keeps HTTP syntax and browser policy out of route lifecycle code
 */

import type { IncomingMessage } from "node:http";
import { posix } from "node:path";

const APP_HOST_PATTERN = /^([a-z0-9]{10})\.localhost$/;
const SURFACE_HOST_PATTERN = /^([a-z0-9-]{16,64})\.([a-z0-9]{10})\.localhost$/;
const API_PREFIX = "/_api";
const SDK_PREFIX = "/_sdk";

export type GatewayHostIdentity = Readonly<{
  appId: string;
  surfaceId: string | null;
}>;

export const BASE_GUI_CSP =
  "default-src 'self'; script-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'self' file: http://localhost:*";

export const MIME_TYPES: Record<string, string> = {
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

export function appContentSecurityPolicy(nonce?: string) {
  const scriptNonce = nonce ? ` 'nonce-${nonce}'` : "";
  return (
    `default-src 'self'; script-src 'self'${scriptNonce}; ` +
    "connect-src 'self'; " +
    "img-src 'self' data: blob:; media-src 'self' data: blob:; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
    "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'self' file: http://localhost:*"
  );
}

export function appendContentSecurityPolicy(
  headers: IncomingMessage["headers"],
  policy: string
) {
  const current = headers["content-security-policy"];
  headers["content-security-policy"] = current
    ? Array.isArray(current)
      ? [...current, policy]
      : [current, policy]
    : policy;
}

export function decodePathname(request: IncomingMessage) {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url ?? "/", "http://localhost").pathname
    );
    return pathname.includes("\0") ? null : posix.normalize(pathname);
  } catch {
    return null;
  }
}

export function isApiPath(pathname: string) {
  return pathname.split("/", 2)[1]?.toLowerCase() === API_PREFIX.slice(1);
}

export function isSdkPath(pathname: string) {
  return pathname.split("/", 2)[1]?.toLowerCase() === SDK_PREFIX.slice(1);
}

export function gatewayIdentityFromHostname(
  hostname: string
): GatewayHostIdentity | null {
  const surface = hostname.match(SURFACE_HOST_PATTERN);
  if (surface) return { surfaceId: surface[1]!, appId: surface[2]! };
  const app = hostname.match(APP_HOST_PATTERN);
  return app ? { appId: app[1]!, surfaceId: null } : null;
}

export function gatewayRouteKey(identity: GatewayHostIdentity) {
  return identity.surfaceId
    ? `surface:${identity.surfaceId}:${identity.appId}`
    : identity.appId;
}
