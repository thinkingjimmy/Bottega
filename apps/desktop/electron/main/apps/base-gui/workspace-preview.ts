/**
 * [INPUT]: Compiled App surface bindings, exact token claims and an injected bounded workspace port.
 * [OUTPUT]: POST-only compiled workspace routing and isolated opaque previews.
 * [POS]: General compiled App adapter; the old Design path routes and selection bridge are retired.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BaseGuiLiveBinding } from "../../../../shared/ipc/apps/apps-ipc";
import type { GuiTokenClaims } from "../generation/gui-api";
import { bearerToken, sameGuiBinding } from "./api/router";
import { CompiledWorkspaceFacade } from "./compiled-workspace";

type WorkspaceVersion = Readonly<{
  versionId: string;
  canonicalRelativePath: string;
  digest: string;
  source: "ai" | "manual" | "restore";
  parentVersion: string | null;
  restoredFromVersion?: string;
  provenance: Readonly<Record<string, string | undefined>>;
  createdAt: number;
}>;

export type WorkspacePreviewPort = Readonly<{
  list(binding: BaseGuiLiveBinding): Promise<{
    files: readonly string[];
    canvases?: readonly Readonly<{
      file: string;
      digest: string;
      advisories: readonly Readonly<{
        ruleId: string;
        message: string;
        count: number;
      }>[];
    }>[];
    revision: number;
    drafting?: boolean;
  }>;
  read(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<Buffer | string | null>;
  listVersions(
    binding: BaseGuiLiveBinding,
    canonicalRelativePath: string
  ): Promise<readonly WorkspaceVersion[]>;
  readVersion(binding: BaseGuiLiveBinding, versionId: string): Promise<{
    version: WorkspaceVersion;
    content: Buffer | string;
  }>;
}>;

type TokenVerifier = Readonly<{
  verify(
    appId: string,
    surfaceId: string,
    candidate: string
  ): GuiTokenClaims | null;
}>;

export type WorkspacePreviewHandler = ((
  context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>,
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse
) => Promise<boolean>) & Readonly<{
  resolveOpaqueOrigin(appId: string, handle: string): BaseGuiLiveBinding | null;
  serveOpaqueOrigin(
    appId: string,
    handle: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void>;
}>;

export function createWorkspacePreviewHandler(tokens: TokenVerifier, port: WorkspacePreviewPort): WorkspacePreviewHandler {
  const compiled = new CompiledWorkspaceFacade(port);
  const handler = async (context: Readonly<{ appId: string; binding: BaseGuiLiveBinding }>, pathname: string, request: IncomingMessage, response: ServerResponse) => {
    if (!pathname.startsWith("/_api/workspace/")) return false;
    const claims = tokens.verify(context.appId, context.binding.surfaceId, bearerToken(request));
    const granted = claims && sameGuiBinding(claims, context.binding) && context.binding.contentLayoutVersion === 3 &&
      context.binding.workspaceReadScope === "design/" && context.binding.baseCapabilities.includes("workspace-read");
    if (!granted) { response.writeHead(403, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify({ error: { code: "workspace_forbidden", message: "Workspace capability is unavailable" } })); return true; }
    await compiled.api(context, pathname, request, response); return true;
  };
  return Object.assign(handler, { resolveOpaqueOrigin: (appId: string, handle: string) => compiled.resolveOpaqueOrigin(appId, handle),
    serveOpaqueOrigin: (appId: string, handle: string, request: IncomingMessage, response: ServerResponse) => compiled.serveOpaqueOrigin(appId, handle, request, response) });
}
