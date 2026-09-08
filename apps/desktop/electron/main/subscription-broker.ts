/**
 * [INPUT]: Generic-typed in-memory map with no external dependencies
 * [OUTPUT]: Provides TokenizedSubscriptionBroker: one live subscriber per conversation, with an attachmentId token guarding against stale or out-of-order detach calls
 * [POS]: Electron main's generic subscription registry; agent-bridge uses it to track window subscriptions across turn lifecycle
 */

export class TokenizedSubscriptionBroker<T> {
  private readonly subscriptions = new Map<string, {
    attachmentId: string;
    subscriber: T;
  }>();

  attach(conversationId: string, attachmentId: string, subscriber: T) {
    this.subscriptions.set(conversationId, { attachmentId, subscriber });
  }

  detach(conversationId: string, attachmentId: string, subscriber: T) {
    const current = this.subscriptions.get(conversationId);
    if (
      current?.subscriber === subscriber &&
      current.attachmentId === attachmentId
    ) {
      this.subscriptions.delete(conversationId);
    }
  }

  current(conversationId: string) {
    return this.subscriptions.get(conversationId)?.subscriber;
  }

  removeSubscriber(subscriber: T) {
    for (const [conversationId, current] of this.subscriptions) {
      if (current.subscriber === subscriber) {
        this.subscriptions.delete(conversationId);
      }
    }
  }

  release(conversationId: string) {
    this.subscriptions.delete(conversationId);
  }
}
