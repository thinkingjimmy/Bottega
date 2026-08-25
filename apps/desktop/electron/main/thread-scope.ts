/**
 * [INPUT]: Depends on shared SessionRef, only consume a combination of session ID and conversationId
 * [OUTPUT]: Provides ThreadScopeRegistry, binds the unique conversationId to the backend: id and releases it after the chat is deleted
 * [POS]: Electron main's cross-backend session authorization ledger blocks the renderer from resuming chats across end-to-end
 */

import type { SessionRef } from "../../shared/agent-ipc";

const keyOf = (session: SessionRef) => `${session.backend}:${session.id}`;

export class ThreadScopeRegistry {
  private readonly scopes = new Map<string, string>();

  bind(session: SessionRef, conversationId: string) {
    const nextScope = conversationId;
    const key = keyOf(session);
    const currentScope = this.scopes.get(key);
    if (currentScope && currentScope !== nextScope) {
      throw new Error("Agent session 已绑定到其他会话，拒绝跨 scope 使用");
    }
    this.scopes.set(key, nextScope);
  }

  assertResume(session: SessionRef, conversationId: string) {
    const currentScope = this.scopes.get(keyOf(session));
    if (!currentScope) {
      throw new Error("Agent session 不属于当前应用会话，拒绝恢复");
    }
    if (currentScope !== conversationId) {
      throw new Error("Agent session 已绑定到其他会话，拒绝跨 scope 恢复");
    }
  }

  releaseConversation(conversationId: string) {
    for (const [sessionKey, owner] of this.scopes) {
      if (owner === conversationId) this.scopes.delete(sessionKey);
    }
  }
}
