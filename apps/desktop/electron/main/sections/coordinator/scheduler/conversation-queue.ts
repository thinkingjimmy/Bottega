/**
 * [INPUT]: Depends only on native Promise chaining
 * [OUTPUT]: Provides ConversationQueue.run, which serializes operations sharing a conversationId while different conversations proceed in parallel
 * [POS]: Short-critical-section executor for sections/coordinator/scheduler; it guards only the claim/write step, never a long-running Agent turn
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
