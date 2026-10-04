/**
 * [INPUT]: Depends on clone-safe primitives and workspace-reference identities shared by Electron main, preload, and renderer
 * [OUTPUT]: Provides window role/bootstrap, exact App Studio route helpers, navigation-intent-fenced surface DTOs, migration commands with side-channel image transfers and their limits, fixed background-destination (activity/General/Dock/Usage) commands, IPC channels, and WindowSurfacesBridgeApi
 * The resume-drafts command restores editing after a cancelled draft flush.
 * [POS]: apps/desktop/shared/ipc/settings; Shared wire truth for one-surface-one-window routing; renderer submits intents while main owns residency and migration
 */
import type { RemoteFileReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { ATTACHMENT_BYTE_LIMIT, ATTACHMENT_LIMIT, type AgentBackendId } from "../agent/agent-ipc";

export { WINDOW_ROLE_ARGUMENT } from "../../ipc-channels/window";
export { WINDOW_ID_ARGUMENT } from "../../ipc-channels/window";
export { WINDOW_APP_ID_ARGUMENT } from "../../ipc-channels/window";

export type ProductWindowRole = "main" | "app-window";
export type SurfaceKey = `app-studio:${string}` | `chat:${string}:${string}`;

export type ProductWindowContext = Readonly<{
  windowId: string;
  role: ProductWindowRole;
  appId: string | null;
}>;

export type SurfaceResidence = Readonly<{
  surface: SurfaceKey;
  /** null is the main-window sentinel; ordinary residency is deliberately absent from the main ledger. */
  windowId: string | null;
  claimRevision: number;
}>;

export type SurfaceRouteState = Readonly<{
  pathname: string;
  mainSurface?: "app" | "data";
  rightSurface?: "none" | "settings" | "edit" | "use";
  useDocked?: boolean;
  useChatId?: string | null;
}>;

/** An image that moves with the draft or a queued message; its bytes travel beside the capsule, never inside it. */
export type SurfaceComposerImage = Readonly<{
  id: string;
  transferId: string;
  name: string;
  mediaType: string;
  origin?: unknown;
}>;

/** Image bytes a source window hands main for one migration; main forwards only the ones that pass validation. */
export type SurfaceImageTransfer = Readonly<{ transferId: string; bytes: Uint8Array }>;

/* Twenty queued messages plus the draft, each at the attachment limit; the byte ceiling is the queue budget plus one full draft. */
export const SURFACE_IMAGE_TRANSFER_LIMITS = {
  count: 21 * ATTACHMENT_LIMIT,
  imageBytes: ATTACHMENT_BYTE_LIMIT,
  totalBytes: 256 * 1024 * 1024 + ATTACHMENT_LIMIT * ATTACHMENT_BYTE_LIMIT,
  transferId: /^[A-Za-z0-9_-]{8,64}$/,
} as const;

export type SurfaceComposerCapsule = Readonly<{
  revision?: number;
  chatId: string;
  incarnationId: string;
  /* 工作区身份必须随胶囊迁移：目标窗以空身份挂载会把迁来的 file 节点
     判为跨工作区污染并释放刚重绑的授权（零草稿丢失合同的反例）。 */
  workspaceIdentityKey: string;
  workspaceReferences?: readonly RemoteFileReference[];
  projectId: string | null;
  richValue: unknown;
  attachmentRefs: readonly string[];
  draftImages?: readonly SurfaceComposerImage[];
  /** Draft images that could not move (or were already unavailable); shown as removable chips on arrival. */
  unavailableAttachments?: readonly Readonly<{ id: string; name: string }>[];
  pendingAcks: readonly Readonly<{ kind: "manual" | "steer"; id: string }>[];
  queue: readonly Readonly<{
    id: string;
    richValue: unknown;
    displayText: string;
    images?: readonly SurfaceComposerImage[];
    /** Held: this attachment could not move (an image withheld or unreadable); the item is never sent without it. */
    unavailableAttachment?: string;
    content?: unknown;
    custodyIntentId?: string;
    outboxRef?: string;
    state: "queued" | "ambiguous";
    workspaceInvalidated?: true;
    createdAt: number;
  }>[];
  queuePaused: boolean;
}>;

export type SurfaceCapsuleV1 = Readonly<{
  version: 1;
  surface: SurfaceKey;
  route: SurfaceRouteState;
  composer?: SurfaceComposerCapsule;
}>;

export type ShowSurfaceInput = Readonly<{
  surface: SurfaceKey;
  route: string;
  navigationIntentId?: string;
}>;

export type OpenSurfaceInWindowInput = ShowSurfaceInput &
  Readonly<{
    appId: string;
    expectedRevision?: number;
    useChat?: Readonly<{ chatId: string; incarnationId: string }>;
  }>;

export type ReclaimSurfaceInput = ShowSurfaceInput &
  Readonly<{ expectedRevision?: number }>;

export type SurfaceIntentResult = Readonly<{
  action: "focused" | "migrated" | "shown";
  residence: SurfaceResidence;
}>;

export type SurfaceMigrationCommand =
  | Readonly<{ type: "prepare-hydrate"; transactionId: string; capsule: SurfaceCapsuleV1 }>
  | Readonly<{ type: "validate-export"; transactionId: string; capsule: SurfaceCapsuleV1 }>
  /* Background surfaces (menu bar, notch, Bottega Dock) reach the main window only through these
     fixed destinations; `agent` only narrows the Usage page. */
  | Readonly<{ type: "presence-destination"; destination: "activity" | "general" | "dock" | "usage"; agent?: AgentBackendId }>
  | Readonly<{
      type: "export";
      transactionId: string;
      surface: SurfaceKey;
    }>
  | Readonly<{
      type: "commit";
      transactionId: string;
      capsule: SurfaceCapsuleV1;
    }>
  | Readonly<{
      type: "hydrate";
      expectedComposerRevision?: number;
      mode?: "present" | "background";
      transactionId: string;
      capsule: SurfaceCapsuleV1;
      /** Only the images main accepted; a declared image without bytes arrives as unavailable. */
      images?: readonly SurfaceImageTransfer[];
    }>
  | Readonly<{
      type: "restore";
      transactionId: string;
      capsule: SurfaceCapsuleV1;
    }>
  | Readonly<{
      type: "residence-changed";
      residence: SurfaceResidence;
      reason: "intent" | "close" | "crash" | "quit";
      draftLost?: boolean;
    }>
  | Readonly<{
      type: "navigate";
      route: string;
    }>
  /* Before an authorized quit: the window saves its durable composer drafts (F-12), then replies "flushed". */
  | Readonly<{ type: "flush-drafts"; transactionId: string }>
  | Readonly<{ type: "resume-drafts" }>
  /* Main refused what this window exported: restore it from the window's own record of the export, never from main's copy. */
  | Readonly<{ type: "abort-export"; transactionId: string }>;

export type SurfaceMigrationReply = Readonly<{
  transactionId: string;
  mode?: "present" | "background";
  composerRevision?: number;
  outcome: "prepared" | "validated" | "exported" | "committed" | "hydrated" | "restored" | "flushed" | "failed";
  capsule?: SurfaceCapsuleV1;
  /** "exported" only: bytes for every image the capsule declares. */
  images?: readonly SurfaceImageTransfer[];
  message?: string;
}>;

export { WINDOW_SURFACES_CHANNEL } from "../../ipc-channels/window";

export type WindowSurfacesBridgeApi = Readonly<{
  context: ProductWindowContext;
  residence(surface: SurfaceKey): Promise<SurfaceResidence>;
  beginNavigationIntent(input: Readonly<{ intentId: string }>): Promise<void>;
  showSurface(input: ShowSurfaceInput): Promise<SurfaceIntentResult>;
  openInWindow(input: OpenSurfaceInWindowInput): Promise<SurfaceIntentResult>;
  reclaim(input: ReclaimSurfaceInput): Promise<SurfaceIntentResult>;
  syncUseChat(input: Readonly<{
    appId: string;
    previous?: Readonly<{ chatId: string; incarnationId: string }>;
    next?: Readonly<{ chatId: string; incarnationId: string }>;
  }>): Promise<SurfaceResidence | null>;
  reply(input: SurfaceMigrationReply): void;
  onCommand(callback: (command: SurfaceMigrationCommand) => void): () => void;
}>;

const SURFACE_PART = /^[A-Za-z0-9._-]{1,160}$/;

export function appStudioSurface(appId: string): SurfaceKey {
  if (!SURFACE_PART.test(appId)) throw new Error("Invalid App surface id");
  return `app-studio:${appId}`;
}

export function chatSurface(chatId: string, incarnation: string): SurfaceKey {
  if (!SURFACE_PART.test(chatId) || !SURFACE_PART.test(incarnation)) {
    throw new Error("Invalid chat surface identity");
  }
  return `chat:${chatId}:${incarnation}`;
}

export function assertSurfaceKey(value: unknown): SurfaceKey {
  if (typeof value !== "string") throw new Error("Invalid surface key");
  const parts = value.split(":");
  if (
    (parts.length === 2 && parts[0] === "app-studio" && SURFACE_PART.test(parts[1]!)) ||
    (parts.length === 3 &&
      parts[0] === "chat" &&
      SURFACE_PART.test(parts[1]!) &&
      SURFACE_PART.test(parts[2]!))
  ) {
    return value as SurfaceKey;
  }
  throw new Error("Invalid surface key");
}

export function appIdFromStudioSurface(value: unknown) {
  const surface = assertSurfaceKey(value);
  const prefix = "app-studio:";
  if (!surface.startsWith(prefix)) {
    throw new Error("Window intent requires an App Studio");
  }
  return surface.slice(prefix.length);
}

export function canonicalAppSurfaceRoute(
  appId: string,
  mainSurface: "app" | "data" = "app"
) {
  appStudioSurface(appId);
  return `/apps/${appId}/${mainSurface}` as const;
}

export function assertAppSurfaceRoute(value: unknown, appId: string): string {
  if (
    typeof value !== "string" ||
    (value !== canonicalAppSurfaceRoute(appId, "app") &&
      value !== canonicalAppSurfaceRoute(appId, "data"))
  ) {
    throw new Error("App surface route identity mismatch");
  }
  return value;
}
