/**
 * [INPUT]: Depends only on clone-safe primitives shared by Electron main, preload, and renderer
 * [OUTPUT]: Provides window role/bootstrap, exact App Studio route helpers, navigation-intent-fenced surface DTOs, migration commands, IPC channels, and WindowSurfacesBridgeApi
 * [POS]: Shared wire truth for one-surface-one-window routing; renderer submits intents while main owns residency and migration
 */

export const WINDOW_ROLE_ARGUMENT = "--bottega-window-role=";
export const WINDOW_ID_ARGUMENT = "--bottega-window-id=";
export const WINDOW_APP_ID_ARGUMENT = "--bottega-app-id=";

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

export type SurfaceComposerCapsule = Readonly<{
  chatId: string;
  incarnationId: string;
  /* 工作区身份必须随胶囊迁移：目标窗以空身份挂载会把迁来的 file 节点
     判为跨工作区污染并释放刚重绑的授权（零草稿丢失合同的反例）。 */
  workspaceIdentityKey: string;
  projectId: string | null;
  richValue: unknown;
  attachmentRefs: readonly string[];
  pendingAcks: readonly Readonly<{ kind: "manual" | "steer"; id: string }>[];
  queue: readonly Readonly<{
    id: string;
    richValue: unknown;
    displayText: string;
    /** Renderer-owned File/data URLs never cross windows; affected items stay fenced. */
    attachmentsDropped?: true;
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
      transactionId: string;
      capsule: SurfaceCapsuleV1;
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
    }>;

export type SurfaceMigrationReply = Readonly<{
  transactionId: string;
  outcome: "exported" | "committed" | "hydrated" | "restored" | "failed";
  capsule?: SurfaceCapsuleV1;
  message?: string;
}>;

export const WINDOW_SURFACES_CHANNEL = {
  residence: "window-surfaces:residence",
  navigationIntent: "window-surfaces:navigation-intent",
  show: "window-surfaces:show",
  openInWindow: "window-surfaces:open-in-window",
  reclaim: "window-surfaces:reclaim",
  syncUseChat: "window-surfaces:sync-use-chat",
  migrationReply: "window-surfaces:migration-reply",
  command: "window-surfaces:command",
} as const;

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
