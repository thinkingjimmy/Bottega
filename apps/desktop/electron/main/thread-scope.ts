/**
 * [INPUT]: Depends on shared SessionRef and the conversation/session composite identity
 * [OUTPUT]: Provides ThreadScopeRegistry for session authorization, same-session Speed wire suppression, explicit reset, and observed effective facts
 * [POS]: Electron main session lifecycle ledger; runtime facts derive wire snapshots but never rewrite persisted user preferences
 */

import type {
  AgentSendPayload,
  SessionServiceTierEffective,
  SessionRef,
} from "../../shared/agent-ipc";

const keyOf = (session: SessionRef) => `${session.backend}:${session.id}`;
const effectiveKey = (conversationId: string, session: SessionRef) =>
  `${conversationId}\0${keyOf(session)}`;

export class ThreadScopeRegistry {
  private readonly scopes = new Map<string, string>();
  private readonly sessionServiceTierEffectiveBySession =
    new Map<string, SessionServiceTierEffective>();

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

  setServiceTierEffective(
    session: SessionRef,
    conversationId: string,
    effective: SessionServiceTierEffective
  ) {
    this.assertResume(session, conversationId);
    this.sessionServiceTierEffectiveBySession.set(
      effectiveKey(conversationId, session),
      effective
    );
  }

  serviceTierEffective(session: SessionRef, conversationId: string) {
    return this.sessionServiceTierEffectiveBySession.get(
      effectiveKey(conversationId, session)
    );
  }

  /** Persisted preference stays untouched; only the same-session wire snapshot
   * converges to the backend fact until the user explicitly retries it. */
  payloadForTurn(payload: AgentSendPayload): AgentSendPayload {
    const session = payload.session;
    if (!session || !("serviceTier" in payload.turnOptions)) return payload;
    const effective = this.serviceTierEffective(
      session,
      payload.scope.conversationId
    );
    if (!effective || effective.value === payload.turnOptions.serviceTier) {
      return payload;
    }
    return {
      ...payload,
      turnOptions: {
        ...payload.turnOptions,
        serviceTier: effective.value,
      },
    };
  }

  resetServiceTierEffective(conversationId: string) {
    const prefix = `${conversationId}\0`;
    for (const key of this.sessionServiceTierEffectiveBySession.keys()) {
      if (key.startsWith(prefix)) {
        this.sessionServiceTierEffectiveBySession.delete(key);
      }
    }
  }

  releaseSession(session: SessionRef, conversationId: string) {
    this.sessionServiceTierEffectiveBySession.delete(
      effectiveKey(conversationId, session)
    );
    this.scopes.delete(keyOf(session));
  }

  releaseConversation(conversationId: string) {
    for (const [sessionKey, owner] of this.scopes) {
      if (owner === conversationId) this.scopes.delete(sessionKey);
    }
    this.resetServiceTierEffective(conversationId);
  }
}
