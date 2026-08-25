/**
 * [INPUT]: Pan-type containers without external dependence
 * [OUTPUT]: Provides TokenizedSubscriptionBroker Conversation A single subscription, attachmentId to prevent the token from being delayed in detachment, and deleted by mistake
 * [POS]: The first is the subscription booklet for Electron mainagent-bridge uses it to decrypt window subscriptions and turn lifecycle
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
