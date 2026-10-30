/**
 * [INPUT]: Depends on the existing package journal, source/current/previous roots and original application/instance/install/fork retention projections.
 * [OUTPUT]: Provides DockWidgetRetention with change-keyed coalesced collection under the existing application/package writers and exact shutdown.
 * [POS]: Derived archive collection scheduler; it creates no independent retention database and never drops pending delivery or accepted files.
 */
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import type { WidgetPackageStore } from "../../../plugins/surface-runtime/packages/store";
import type { DockWidgetApplications } from "../../store/custom/applications";
export class DockWidgetRetention {
  private closed = false;
  private key: string | null = null;
  private pending = false;
  private flight: Promise<void> | null = null;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly packages: WidgetPackageStore,
    private readonly applications: DockWidgetApplications,
    private readonly roots: () => readonly string[],
  ) {
    this.unsubscribe = packages.onChanged(() => this.reconcile());
  }
  reconcile() {
    if (this.closed) return;
    const key = canonicalJson([
      this.packages.collectionState(),
      [...new Set(this.roots())].sort(),
    ]);
    if (key === this.key) return;
    this.key = key;
    this.pending = true;
    if (this.flight) return;
    const task = Promise.resolve()
      .then(async () => {
        while (this.pending && !this.closed) {
          this.pending = false;
          await this.applications.localMutation(async () => {
            if (!this.closed) await this.packages.collect(this.roots());
          });
        }
      })
      .catch((error) => {
        this.key = null;
        console.warn("[widgets] archive collection stopped", error);
      })
      .finally(() => {
        if (this.flight === task) this.flight = null;
      });
    this.flight = task;
  }
  async close() {
    this.closed = true;
    this.unsubscribe();
    await this.flight;
  }
}
