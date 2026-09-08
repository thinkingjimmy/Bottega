/**
 * [INPUT]: No external imports; depends only on constructor-injected authorize/discard/insert/onPendingChange/reportError callbacks
 * [OUTPUT]: Provides FileAuthorizationQueue, which serializes per-file authorization with generation-fenced context switching and a live pending count
 * [POS]: The file-authorization transaction core for chat/composer; the React view only reads the pending/busy projection, with no race-prone branching of its own
 */

export type FileAuthorizationDependencies<FileValue, NodeValue> = {
  authorize: (file: FileValue) => Promise<NodeValue>;
  discard: (node: NodeValue) => void;
  insert: (node: NodeValue) => boolean;
  onPendingChange: (pending: number) => void;
  reportError: (cause: unknown, file: FileValue) => void;
};

type AuthorizationTicket = {
  contextKey: string;
  generation: number;
};

export class FileAuthorizationQueue<FileValue, NodeValue> {
  private closed = false;
  private contextKey: string | undefined;
  private generation = 0;
  private readonly pending = new Map<number, number>();

  constructor(
    private dependencies: FileAuthorizationDependencies<
      FileValue,
      NodeValue
    >
  ) {}

  setDependencies(
    dependencies: FileAuthorizationDependencies<FileValue, NodeValue>
  ) {
    this.dependencies = dependencies;
  }

  setContext(contextKey: string | undefined) {
    if (this.closed) return;
    if (this.contextKey === contextKey) {
      this.dependencies.onPendingChange(
        this.pending.get(this.generation) ?? 0
      );
      return;
    }
    this.contextKey = contextKey;
    this.generation += 1;
    this.dependencies.onPendingChange(0);
  }

  clearContext() {
    if (this.closed) return;
    this.contextKey = undefined;
    this.generation += 1;
  }

  isBusy() {
    return (this.pending.get(this.generation) ?? 0) > 0;
  }

  async accept(files: readonly FileValue[]) {
    if (this.closed || !this.contextKey || files.length === 0) return;
    const ticket = {
      contextKey: this.contextKey,
      generation: this.generation,
    } satisfies AuthorizationTicket;
    this.adjustPending(ticket, files.length);
    for (const [index, file] of files.entries()) {
      if (!this.isCurrent(ticket)) {
        this.adjustPending(ticket, -(files.length - index));
        break;
      }
      let node: NodeValue | undefined;
      try {
        node = await this.dependencies.authorize(file);
        if (!this.isCurrent(ticket) || !this.dependencies.insert(node)) {
          this.dependencies.discard(node);
          node = undefined;
        }
      } catch (cause) {
        if (node !== undefined) this.dependencies.discard(node);
        if (this.isCurrent(ticket)) {
          this.dependencies.reportError(cause, file);
        }
      } finally {
        this.adjustPending(ticket, -1);
      }
    }
  }

  close() {
    this.closed = true;
    this.contextKey = undefined;
    this.generation += 1;
  }

  private adjustPending(ticket: AuthorizationTicket, delta: number) {
    const count = Math.max(
      0,
      (this.pending.get(ticket.generation) ?? 0) + delta
    );
    if (count > 0) this.pending.set(ticket.generation, count);
    else this.pending.delete(ticket.generation);
    if (this.isCurrent(ticket)) {
      this.dependencies.onPendingChange(count);
    }
  }

  private isCurrent(ticket: AuthorizationTicket) {
    return (
      !this.closed &&
      ticket.generation === this.generation &&
      ticket.contextKey === this.contextKey
    );
  }
}
