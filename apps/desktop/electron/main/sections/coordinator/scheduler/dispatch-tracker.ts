/**
 * [INPUT]: Depends only on the native Promise
 * [OUTPUT]: Provides DispatchTracker: registration of fire-and-forget dispatches with their failure handler, plus a drain barrier that waits for every one of them — including any started while draining
 * [POS]: The quiescence primitive of sections/coordinator/scheduler; a kick returns immediately, but shutdown still has a point at which nothing can write any more
 */

export class DispatchTracker {
  private readonly inFlight = new Set<Promise<void>>();

  track(work: Promise<unknown>, onFailure: (cause: unknown) => void) {
    const dispatch: Promise<void> = work
      .then(() => undefined, onFailure)
      .finally(() => {
        this.inFlight.delete(dispatch);
      });
    this.inFlight.add(dispatch);
  }

  async drain() {
    while (this.inFlight.size) await Promise.all([...this.inFlight]);
  }
}
