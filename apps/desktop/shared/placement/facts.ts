/**
 * [INPUT]: Depends only on clone-safe primitive values
 * [OUTPUT]: Provides canonical App Use/Edit conversation, start-state, title, destination routing, residence, editor, source, and capability facts
 * [POS]: Shared information-architecture vocabulary; product-surface visibility remains in six focused sibling projections
 */

export type ConversationContext =
  | { kind: "ordinary" }
  | { kind: "app-use"; appId: string }
  | { kind: "app-edit"; appId: string; projectId: string };

export type ChatStartState =
  | { kind: "unstarted" }
  | {
      kind: "started-exact";
      firstUserMessageAt: number;
      firstUserMessageSeq: number;
    };

/* ChatStartState 只有两档，所以"用户已开口"与"该出现在历史里"是同一个
   判断——两个名字曾经并存，只会让读者以为它们有分歧。 */
export const isHistoryVisible = (state: ChatStartState) =>
  state.kind === "started-exact";

export type ChatTitleSource =
  | "app-fallback"
  | "local-fallback"
  | "generated"
  | "user";

export type ChatTitleJob =
  | { state: "none" }
  | {
      state: "pending";
      jobId: string;
      expectedRecordRevision: number;
      expectedTitleSource: "app-fallback" | "local-fallback";
      createdAt: number;
    }
  | { state: "completed"; jobId: string; completedAt: number }
  | { state: "superseded"; jobId: string; supersededAt: number };

export type ChatPlacementFacts = Readonly<{
  id: string;
  incarnationId: string;
  projectId?: string | null;
  context: ConversationContext;
  startState: ChatStartState;
  archivedAt?: number;
  effectiveArchived?: boolean;
  readOnlyReason?: "legacy-app-not-editable" | "external-readonly";
  updatedAt: number;
  createdAt: number;
}>;

export type ChatPlacementInput = Readonly<{
  id: string;
  incarnationId?: string;
  projectId?: string | null;
  context?: ConversationContext;
  startState?: ChatStartState;
  archivedAt?: number;
  effectiveArchived?: boolean;
  readOnlyReason?: "legacy-app-not-editable" | "external-readonly";
  updatedAt: number;
  createdAt: number;
}>;

export const hasCanonicalChatPlacement = <T extends ChatPlacementInput>(
  chat: T
): chat is T & ChatPlacementFacts =>
  typeof chat.incarnationId === "string" &&
  chat.context !== undefined &&
  chat.startState !== undefined;

export const isEffectivelyArchived = (chat: ChatPlacementInput) =>
  chat.effectiveArchived ?? Boolean(chat.archivedAt);

export type AppUseChatDestination = Readonly<{
  kind: "app-use-chat";
  appId: string;
  chatId: string;
  incarnationId: string;
}>;

export type AppEditorDestination =
  | Readonly<{
      kind: "app-editor-chat";
      appId: string;
      projectId: string;
      chatId: string;
      incarnationId: string;
    }>
  | Readonly<{
      kind: "app-editor-draft";
      appId: string;
      projectId: string;
      intentId: string;
    }>;

export type ArchiveDestination = Readonly<{
  kind: "archive";
  target: "chat" | "project";
  id: string;
}>;

export type ProductDestination =
  | Readonly<{ kind: "chat"; chatId: string }>
  | AppUseChatDestination
  | AppEditorDestination
  | ArchiveDestination
  | Readonly<{ kind: "base"; ownerKey: string; locator?: string }>;

export function productDestinationRoute(destination: ProductDestination) {
  switch (destination.kind) {
    case "chat":
      return `/chat/${encodeURIComponent(destination.chatId)}`;
    case "app-use-chat":
      return `/apps/${encodeURIComponent(destination.appId)}/app?panel=use&chatId=${encodeURIComponent(destination.chatId)}&incarnationId=${encodeURIComponent(destination.incarnationId)}`;
    case "app-editor-chat":
      return `/chat/${encodeURIComponent(destination.chatId)}`;
    case "app-editor-draft":
      return `/?projectId=${encodeURIComponent(destination.projectId)}&appEditAppId=${encodeURIComponent(destination.appId)}&appEditIntent=${encodeURIComponent(destination.intentId)}`;
    case "archive":
      return `/settings/archive?target=${encodeURIComponent(`${destination.target}:${destination.id}`)}`;
    case "base": {
      const [kind, id] = destination.ownerKey.split(":", 2);
      const route = `/bases/${encodeURIComponent(kind ?? "chat")}/${encodeURIComponent(id ?? "")}`;
      return destination.locator
        ? `${route}?locator=${encodeURIComponent(destination.locator)}`
        : route;
    }
  }
}

export type AppEditorProjection = Readonly<{
  editorActivatedAt: number | null;
  editorHiddenAt: number | null;
  editorRevision: number;
}>;

export const isEditorVisible = (editor: AppEditorProjection) =>
  editor.editorActivatedAt !== null &&
  (editor.editorHiddenAt === null ||
    editor.editorHiddenAt < editor.editorActivatedAt);

export type AppChatSlot = Readonly<{
  id: string;
  incarnationId: string;
  state: "draft" | "canonical";
  revision: number;
}>;

export type AppUseSwitchPhase =
  | "prepared"
  | "committed"
  | "old-revoked"
  | "old-drained"
  | "target-claimed"
  | "issuance-open"
  | "completed";

export type AppUseSwitchIntent = Readonly<{
  intentId: string;
  appId: string;
  source: AppChatSlot | null;
  target: AppChatSlot;
  expectedAppRevision: number;
  expectedLifecycleRevision: number;
  expectedGenerationBindingRevision: number;
  expectedGenerationId: string | null;
  expectedSourceSurfaceRevision: number;
  expectedTargetSurfaceRevision: number;
  expectedStudioSurfaceRevision: number;
  phase: AppUseSwitchPhase;
  createdAt: number;
}>;

export type AppUseSurfaceFence = Readonly<
  Pick<
    AppUseSwitchIntent,
    | "expectedSourceSurfaceRevision"
    | "expectedTargetSurfaceRevision"
    | "expectedStudioSurfaceRevision"
  >
>;

export type AppUseSwitchReceipt =
  | Readonly<{ status: "precommit-rejected"; active: AppChatSlot | null; reason: string }>
  | Readonly<{ status: "committed" | "recovering"; intentId: string; target: AppUseChatDestination }>
  | Readonly<{ status: "completed"; intentId: string; target: AppUseChatDestination }>;

export type AppSourceState = Readonly<{
  sourceRevision: number;
  fingerprint: string | null;
  lastReconciledAt: number | null;
}>;

export const CHAT_PANEL_CAPABILITIES = {
  ordinary: { base: true, appAttachment: true },
  "app-use": { base: false, appAttachment: false },
  "app-edit": { base: false, appAttachment: false },
} as const;

export type BaseNavigation =
  | { kind: "internal-app"; appId: string }
  | { kind: "conversation-contained"; chatId: string }
  | { kind: "project-contained"; projectId: string }
  | {
      kind: "root-user-managed";
      source: "retained-app-data";
      activatedAt: number;
    };
