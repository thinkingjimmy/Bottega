/**
 * [INPUT]: Depends only on the private userData/installation identity and optional loaded Widget cleanup participants.
 * [OUTPUT]: Provides WidgetScopeCleanup with serialized existing-account cleanup, late owner registration and an initialization barrier.
 * [POS]: Early Cloud account cleanup seam; exact file/schema code loads only when cleanup runs and the existing binding owns recovery.
 */
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
export type WidgetCleanupParticipant =
  "api" | "definitions" | "installations" | "instances" | "applications" | "generations" | "packages";
export class WidgetScopeCleanup {
  private readonly owners = new Map<
    WidgetCleanupParticipant,
    (accountId: string) => Promise<void>
  >();
  private tail: Promise<void> = Promise.resolve();
  private active = 0;
  private failure: unknown = null;
  constructor(
    private readonly userData: string,
    private readonly installationId: string,
  ) {}
  async ready() {
    await this.tail;
    if (this.failure) throw this.failure;
  }
  initialize(
    owners: Partial<
      Record<WidgetCleanupParticipant, (accountId: string) => Promise<void>>
    >,
    run: () => Promise<void>,
  ) {
    const task = this.tail.then(async () => {
      if (this.failure) throw this.failure;
      for (const name of Object.keys(owners) as WidgetCleanupParticipant[])
        if (this.owners.has(name))
          throw new Error("WIDGET_CLEANUP_OWNER_CONFLICT");
      await run();
      for (const [name, owner] of Object.entries(owners))
        this.owners.set(name as WidgetCleanupParticipant, owner!);
    });
    this.tail = task.catch(() => {});
    return task.then(() => () => {
      for (const [name, owner] of Object.entries(owners))
        if (this.owners.get(name as WidgetCleanupParticipant) === owner)
          this.owners.delete(name as WidgetCleanupParticipant);
    });
  }
  attach(
    name: WidgetCleanupParticipant,
    clear: (accountId: string) => Promise<void>,
  ) {
    if (this.active || this.failure || this.owners.has(name))
      throw new Error("WIDGET_CLEANUP_OWNER_CONFLICT");
    this.owners.set(name, clear);
    return () => {
      if (this.owners.get(name) === clear) this.owners.delete(name);
    };
  }
  cleanupScope(scope: SyncScope) {
    this.active++;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        const { clearWidgetAccountFile, clearWidgetCiphertext } =
          await import("./files");
        for (const name of [
          "api",
          "definitions",
          "installations",
          "instances",
          "applications",
          "generations",
          "packages",
        ] as const) {
          const owner = this.owners.get(name);
          if (owner) await owner(scope.userId);
          else
            await clearWidgetAccountFile(
              this.userData,
              this.installationId,
              scope.userId,
              name,
            );
        }
        await clearWidgetCiphertext(this.userData, scope);
        this.failure = null;
      })
      .catch((error) => {
        this.failure = error;
        throw error;
      })
      .finally(() => {
        this.active--;
      });
    this.tail = task.catch(() => {});
    return task;
  }
}
