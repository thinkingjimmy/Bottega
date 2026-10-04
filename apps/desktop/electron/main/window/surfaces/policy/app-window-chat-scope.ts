/**
 * [INPUT]: Depends on TrustedRendererContext plus injected Studio-residence, active-slot, and canonical chat-identity facts
 * [OUTPUT]: Provides exact App-window active-use-chat projection, read assertion, and event-owner lookup
 * [POS]: Window-surfaces/policy pure chat disclosure rule; the controller supplies facts but does not duplicate branching
 */

import type { TrustedRendererContext } from "../trusted-renderer-context";

type ChatIdentity = Readonly<{
  incarnationId: string | null;
  appId: string | null;
  appRole: "edit" | "use" | null;
}>;

type ScopePorts = Readonly<{
  assertStudio(context: TrustedRendererContext, appId: string): void;
  activeUseChat(appId: string): string | undefined;
  chatIdentity(chatId: string): ChatIdentity | undefined;
}>;

export function appWindowUseChat(
  context: TrustedRendererContext,
  ports: ScopePorts
) {
  if (context.role !== "app-window" || !context.appId) return null;
  ports.assertStudio(context, context.appId);
  const chatId = ports.activeUseChat(context.appId);
  if (!chatId) return null;
  const identity = ports.chatIdentity(chatId);
  if (
    !identity?.incarnationId ||
    identity.appId !== context.appId ||
    identity.appRole !== "use"
  ) return null;
  return { chatId, incarnationId: identity.incarnationId } as const;
}

export function assertAppConversationRead(
  context: TrustedRendererContext,
  conversationId: string,
  scoped: ReturnType<typeof appWindowUseChat>
) {
  if (context.role === "main") return;
  if (!scoped || scoped.chatId !== conversationId) {
    throw new Error("App window chat read rejected outside its active use chat");
  }
}

export function appIdForActiveUseChat(
  conversationId: string,
  appIds: readonly string[],
  resolve: (appId: string) => string | undefined
) {
  return appIds.find((appId) => resolve(appId) === conversationId) ?? null;
}
