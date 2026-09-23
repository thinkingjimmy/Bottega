/**
 * [INPUT]: Depends on backend descriptors' fixed selfUpdate arguments, the resolved runtime snapshot, the supervised command host, a sanitized login PATH and a caller-owned recheck.
 * [OUTPUT]: Provides CliUpdater, which runs one provider CLI self-update at a time and reports a result verified by the post-update version.
 * [POS]: setup's headless update boundary behind Settings › Updates; Terminal delivery in terminal-action.ts stays the fallback for installs a CLI cannot update itself.
 */

import type { AgentBackendId, BackendInfo } from "../../../shared/agent-ipc";
import type { CliUpdateResult } from "../../../shared/setup-ipc";
import type { ResolvedRuntime } from "../backends/types";
import { isVersionNewer, sanitizedProcessEnvironment } from "../backends/runtime-probe";
import { runSupervisedCommand } from "../backends/supervised-command";

/* Installers download a full binary; ten minutes covers a slow link without letting a hung prompt live forever. */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1_000;
const OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const LOG_TAIL_CHARS = 16 * 1024;

export type CliUpdaterDependencies = {
  runtime(backend: AgentBackendId): ResolvedRuntime | undefined;
  args(backend: AgentBackendId): readonly string[] | undefined;
  /** Re-probes the CLI after the command exits and returns the fresh facts. */
  recheck(backend: AgentBackendId): Promise<BackendInfo | undefined>;
  run?: typeof runSupervisedCommand;
};

const tail = (value: string) => value.length > LOG_TAIL_CHARS ? value.slice(-LOG_TAIL_CHARS) : value;

export class CliUpdater {
  /* One global chain: two installers rewriting shared shell shims at once is a race no CLI promises to survive. */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly flights = new Map<AgentBackendId, Promise<CliUpdateResult>>();

  constructor(private readonly dependencies: CliUpdaterDependencies) {}

  update(backend: AgentBackendId): Promise<CliUpdateResult> {
    const existing = this.flights.get(backend);
    if (existing) return existing;
    const task = this.chain.then(() => this.run(backend)).finally(() => {
      if (this.flights.get(backend) === task) this.flights.delete(backend);
    });
    this.chain = task.catch(() => undefined);
    this.flights.set(backend, task);
    return task;
  }

  private async run(backend: AgentBackendId): Promise<CliUpdateResult> {
    const runtime = this.dependencies.runtime(backend);
    const args = this.dependencies.args(backend);
    if (!runtime || !args) return { ok: false, reason: "unavailable", log: "" };
    const before = runtime.version;
    let log = "";
    try {
      const { stdout } = await (this.dependencies.run ?? runSupervisedCommand)({
        backend,
        command: runtime.executable,
        args: [...args],
        env: sanitizedProcessEnvironment(runtime.path),
        timeoutMs: UPDATE_TIMEOUT_MS,
        maxBuffer: OUTPUT_LIMIT_BYTES,
        label: `${backend} ${args.join(" ")}`,
      });
      log = tail(stdout.trim());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return { ok: false, reason: /超时/.test(message) ? "timeout" : "failed", log: tail(message) };
    }
    /* Exit 0 only proves the updater ran. Package-manager installs often print advice and exit cleanly. */
    const after = await this.dependencies.recheck(backend).catch(() => undefined);
    const version = after?.version;
    const upToDate = Boolean(version) && (
      (after?.latestVersion ? !isVersionNewer(after.latestVersion, version!) : false) ||
      version !== before && isVersionNewer(version!, before)
    );
    return upToDate ? { ok: true, version } : { ok: false, reason: "unchanged", log };
  }
}
