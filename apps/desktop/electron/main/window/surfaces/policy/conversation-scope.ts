/**
 * [INPUT]: Depends on shared chat surface identity, TrustedRendererContext, and injected residence/draft-owner facts
 * [OUTPUT]: Provides canonical/draft conversation bind and mutation residence assertions
 * [POS]: Window-surfaces/policy conversation admission rule shared by renderer mutations and main-owned lease binding
 */

import {
  chatSurface,
  type SurfaceResidence,
} from "../../../../../shared/window-surfaces-ipc";
import type { TrustedRendererContext } from "../trusted-renderer-context";

type Identity = Readonly<{ incarnationId: string | null }> | undefined;
type Ports = Readonly<{
  identity(chatId: string): Identity;
  residence(surface: ReturnType<typeof chatSurface>): SurfaceResidence;
  isResident(context: TrustedRendererContext, residence: SurfaceResidence): boolean;
  claimDraft(context: TrustedRendererContext, chatId: string, identity: Identity): void;
  bindOwner(chatId: string, windowId: string | null): void;
}>;

const canonicalResidence = (chatId: string, ports: Ports) => {
  const identity = ports.identity(chatId);
  return identity?.incarnationId
    ? { identity, residence: ports.residence(chatSurface(chatId, identity.incarnationId)) }
    : { identity, residence: null };
};

export function bindConversationScope(
  context: TrustedRendererContext,
  chatId: string,
  ports: Ports
) {
  const current = canonicalResidence(chatId, ports);
  if (!current.residence) return ports.claimDraft(context, chatId, current.identity);
  if (!ports.isResident(context, current.residence)) {
    throw new Error("Conversation is resident in another window");
  }
  ports.bindOwner(chatId, current.residence.windowId);
}

export function assertConversationMutationScope(
  context: TrustedRendererContext,
  chatId: string,
  ports: Ports
) {
  const current = canonicalResidence(chatId, ports);
  if (!current.residence) return ports.claimDraft(context, chatId, current.identity);
  if (!ports.isResident(context, current.residence)) {
    throw new Error("Conversation mutation rejected from nonresident window");
  }
}
