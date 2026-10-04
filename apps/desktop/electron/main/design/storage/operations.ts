/**
 * [INPUT]: Depends on persistence/SerialQueue and caller-owned Design storage mutations
 * [OUTPUT]: Provides DesignStorageOperations, one fail-closed serialization boundary for capture, migration, termination, and history garbage collection
 * [POS]: Design storage's transaction scheduler; journals and live capture share it so destructive lifecycle work cannot interleave with new history
 */

import { SerialQueue } from "../../persistence/serial-queue";

export class DesignStorageOperations {
  private readonly queue = new SerialQueue();

  run<T>(operation: () => Promise<T>) {
    return this.queue.enqueue(operation);
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }
}
