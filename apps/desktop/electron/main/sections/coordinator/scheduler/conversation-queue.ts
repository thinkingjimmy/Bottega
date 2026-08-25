/**
 * [INPUT]: Depends on Promise Microtask queue with conversationId
 * [OUTPUT]: Provides ConversationQueue, the same conversation, sequence, different conversation parallel
 * [POS]: The short-critical zone executor of sections/coordinator/scheduler; Only protect the team leader/ write a claim, and do not carry a long Agent turn
 */

export class ConversationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(conversationId: string, operation: () => Promise<T>) {
    const previous = this.tails.get(conversationId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => {}).then(() => current);
    this.tails.set(conversationId, tail);
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(conversationId) === tail) {
        this.tails.delete(conversationId);
      }
    }
  }
}
