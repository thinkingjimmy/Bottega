/**
 * [INPUT]: Depends on Electron app paths, the renderer IPC registrar and trusted window context, the window-surface residency guard, the shared durable draft
 *          contract, FileAuthorizationStore, the workspace resolver, ChatsService events, the build's cloud config and the signed-in account
 * [OUTPUT]: Provides composerDraftsRegistrar: one process-wide ComposerDraftStore behind the composer-drafts load/save channels, removing a Chat's drafts
 *           when it is deleted; queuedComposerDraft reads queue identities for App disable impact
 * [POS]: Wiring of electron/main/composer/drafts; store.ts owns the files and rules, this validates renderer input and binds it to its window
 */

import { app } from "electron";
import { z } from "zod";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { BLANK_DRAFT_PREFIX, COMPOSER_DRAFTS_CHANNEL, type ComposerDraftKey, type SaveComposerDraftInput } from "../../../../shared/composer/drafts-ipc";
import type { AgentWorkspaceScope } from "../../../../shared/ipc/agent/agent-ipc";
import type { ChatsService } from "../../chats/service/chats-service";
import type { FileAuthorizationStore } from "../../workspace/files/file-authorizations";
import { rendererIpc } from "../../registration/ipc-registrar";
import type { WorkspaceResolver } from "../../skills/catalog/skills-catalog";
import { surfaceWindowController } from "../../window/surfaces/surface-window-controller";
import type { TrustedRendererContext } from "../../window/surfaces/trusted-renderer-context";
import { ComposerDraftStore } from "./store";

declare const __BOTTEGA_CLOUD_CONFIG__: CloudBuildConfig | null;

const id = z.string().min(1).max(256);
const keySchema = z.object({ chatId: id, incarnationId: z.string().max(256) }).strict();
const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("conversation"), conversationId: id }).strict(),
  z.object({ kind: z.literal("project"), projectId: id }).strict(),
  z.object({ kind: z.literal("app"), appId: id }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);
const saveSchema = keySchema.extend({
  baseRevision: z.number().int().nonnegative(),
  draft: z.object({
    richValue: z.array(z.unknown()).max(512),
    unavailableAttachments: z.array(z.object({ id, name: z.string().max(1024) }).strict()).max(64),
    queue: z.object({ paused: z.boolean(), items: z.array(z.object({
      id, richValue: z.array(z.unknown()).max(512), displayText: z.string(), imageNames: z.array(z.string().max(1024)).max(16).optional(),
      content: z.unknown().optional(), custodyIntentId: id.optional(), outboxRef: id.optional(), state: z.enum(["queued", "ambiguous"]),
      unavailableAttachment: z.string().max(1024).optional(), createdAt: z.number(),
    }).strict()).max(20) }).strict(),
    pendingAcks: z.array(z.object({ kind: z.enum(["manual", "steer"]), id }).strict()).max(64),
    workspaceIdentityKey: z.string().max(4096),
    projectId: id.nullable(),
  }).strict().nullable(),
  fileScopes: z.record(id, scopeSchema),
}).strict();

type Deps = Readonly<{
  chats: Pick<ChatsService, "onEvent">;
  files: FileAuthorizationStore;
  resolveWorkspace: WorkspaceResolver;
  /** The signed-in user on this computer, or null (drafts then live under "local"). */
  userId(): string | null;
}>;

let store: ComposerDraftStore | null = null;

/** Reads saved queue identities without restoring attachment grants or changing drafts. */
export const queuedComposerDraft = (key: ComposerDraftKey) => store?.queued(key) ?? Promise.resolve([]);

/* A file chip may only be granted again under this Chat's own scope, or the App this window serves. */
/* A Chat's draft follows its window residency; the blank page's draft exists only in the main window. */
function assertDraftAccess(context: TrustedRendererContext, chatId: string) {
  if (chatId.startsWith(BLANK_DRAFT_PREFIX)) {
    if (context.role !== "main") throw new Error("COMPOSER_DRAFT_SCOPE");
    return;
  }
  surfaceWindowController.assertConversationMutation(context, chatId);
}

function assertScopes(context: TrustedRendererContext, input: SaveComposerDraftInput) {
  for (const scope of Object.values(input.fileScopes) as AgentWorkspaceScope[]) {
    if (scope.kind === "conversation" && scope.conversationId !== input.chatId) throw new Error("COMPOSER_DRAFT_SCOPE");
    if (context.role === "app-window" && scope.kind === "app" && scope.appId !== context.appId) throw new Error("COMPOSER_DRAFT_SCOPE");
  }
}

export function composerDraftsRegistrar(deps: Deps) {
  if (!store) {
    const config = typeof __BOTTEGA_CLOUD_CONFIG__ === "undefined" ? null : __BOTTEGA_CLOUD_CONFIG__;
    const drafts = new ComposerDraftStore(app.getPath("userData"), {
      grants: deps.files,
      resolveWorkspace: (scope) => deps.resolveWorkspace(scope).workspace,
      identity: () => {
        const userId = deps.userId();
        return config && userId ? { environmentId: config.environmentId, deploymentId: config.deploymentId, userId } : null;
      },
    });
    deps.chats.onEvent((event) => { if (event.type === "removed") void drafts.removeChat(event.chatId).catch(() => undefined); });
    store = drafts;
  }
  const drafts = store;
  return {
    register(_window: unknown, rendererUrl: string) {
      rendererIpc(rendererUrl, "Composer draft request rejected").roles("main", "app-window")
        .handleWithContext(COMPOSER_DRAFTS_CHANNEL.load, (context, raw) => {
          const key = keySchema.parse(raw);
          assertDraftAccess(context, key.chatId);
          return drafts.load(context.windowId, key);
        })
        .handleWithContext(COMPOSER_DRAFTS_CHANNEL.save, (context, raw) => {
          const input = saveSchema.parse(raw) as SaveComposerDraftInput;
          assertDraftAccess(context, input.chatId);
          assertScopes(context, input);
          return drafts.save(context.windowId, input);
        });
    },
  };
}
