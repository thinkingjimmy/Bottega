/**
 * [INPUT]: Depends on the controlled read-only Git origin reader and a ProjectStore gitRemote writer.
 * [OUTPUT]: Provides ProjectRemoteRefresh, a per-Project throttled background refresh of the portable origin hint.
 * [POS]: Project workspace-read side effect; it never runs on the store queue and never gates turn admission.
 */
import { readProjectRemote } from "./remote";

/* Origin is discovered, not authored, so it is refreshed on the read path instead of at creation.
   Reading it costs a `git config` subprocess, and the workspace read path runs on every turn — one
   probe per Project per window keeps the cost proportional to sessions rather than to turns. */
export const PROJECT_REMOTE_REFRESH_WINDOW_MS = 5 * 60 * 1000;

type RemoteRefreshPorts = {
  read?: (directory: string) => Promise<string | undefined>;
  write: (projectId: string, gitRemote: string | undefined) => Promise<unknown>;
  now?: () => number;
};

export class ProjectRemoteRefresh {
  private readonly probed = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  constructor(private readonly ports: RemoteRefreshPorts) {}

  /** Fire and forget: the caller is resolving a workspace and must not wait for, or fail on, Git. */
  schedule(projectId: string, directory: string) {
    if (!directory || this.inFlight.has(projectId)) return;
    const now = (this.ports.now ?? Date.now)();
    const probed = this.probed.get(projectId);
    if (probed !== undefined && now - probed < PROJECT_REMOTE_REFRESH_WINDOW_MS) return;
    this.probed.set(projectId, now);
    const running = this.refresh(projectId, directory)
      .catch((cause) => console.warn("[projects] Git origin refresh failed", projectId, cause))
      .finally(() => this.inFlight.delete(projectId));
    this.inFlight.set(projectId, running);
  }

  /** Shutdown waits for in-flight probes; otherwise their write races the closing store queue. */
  async flush() {
    while (this.inFlight.size) await Promise.allSettled([...this.inFlight.values()]);
  }

  private async refresh(projectId: string, directory: string) {
    const remote = await (this.ports.read ?? readProjectRemote)(directory);
    // The store short-circuits an unchanged value, so a repository without an origin writes nothing.
    await this.ports.write(projectId, remote);
  }
}
