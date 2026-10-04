/**
 * [INPUT]: Depends on nothing; the composition root hands it the Chats owner's publishWarning once that exists.
 * [OUTPUT]: Provides StartupNotices: startup recovery notices raised before the Chats owner is composed are held and published once, in order,
 *           when it attaches; later ones go straight through.
 * [POS]: The one path for index.ts's recovery callbacks (settings reset, failed deferred check). A notice must reach a live window as an event,
 *        not only the next chat snapshot, and one raised during recovery initialize must not be dropped before the store exists.
 */
export class StartupNotices {
  private pending: string[] = [];
  private sink: ((message: string) => void) | null = null;

  raise(message: string) {
    if (this.sink) this.sink(message);
    else this.pending.push(message);
  }

  attach(sink: (message: string) => void) {
    this.sink = sink;
    const held = this.pending;
    this.pending = [];
    for (const message of held) sink(message);
  }
}
