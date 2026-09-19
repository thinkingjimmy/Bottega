/**
 * [INPUT]: Depends on Node fs stat/readFile, the durable atomic write primitive, and the shared BackendInfo/capability contracts.
 * [OUTPUT]: Provides RuntimeSnapshotStore: a durable record of the last launch's confirmed-installed Agents and the identity-validated provisional BackendInfo list handed to the window.
 * [POS]: Startup-only side ledger; it never feeds the runtime registry, so a stale or corrupt file can delay the shell but never claim an Agent this launch has not confirmed.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_BACKEND_ORDER,
  type AgentBackendId,
  type BackendCapabilities,
  type BackendInfo,
} from "../../../shared/agent-ipc";
import { durableReplaceFile } from "../persistence/durable-json";

const SNAPSHOT_FILE = "agent-runtime-snapshot.json";

/* Discovery publishes several snapshots per backend inside the first second; one
   write after they settle keeps this ledger off the startup critical path. */
const WRITE_DELAY_MS = 1_000;

/** Enough of the inode to notice a reinstall, an upgrade or a different binary behind the same path. */
type ExecutableIdentity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
};

export type RuntimeSnapshotEntry = {
  backend: AgentBackendId;
  /* Also the BackendInfo `path` the renderer shows; the registry reports the
     executable there, never the PATH the probe searched. */
  executable: string;
  version: string;
  capabilities: BackendCapabilities;
  identity: ExecutableIdentity;
  savedAt: number;
};

export type ConfirmedRuntime = {
  executable: string;
  version: string;
  capabilities: BackendCapabilities;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isIdentity = (value: unknown): value is ExecutableIdentity =>
  isRecord(value) &&
  ["dev", "ino", "size", "mtimeMs"].every((key) => typeof value[key] === "number");

const isEntry = (value: unknown): value is RuntimeSnapshotEntry =>
  isRecord(value) &&
  (AGENT_BACKEND_ORDER as readonly string[]).includes(value.backend as string) &&
  typeof value.executable === "string" &&
  typeof value.version === "string" &&
  isRecord(value.capabilities) &&
  isIdentity(value.identity);

const readIdentity = async (executable: string): Promise<ExecutableIdentity | null> => {
  try {
    const metadata = await stat(executable);
    return {
      dev: metadata.dev,
      ino: metadata.ino,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    };
  } catch {
    return null;
  }
};

const sameIdentity = (left: ExecutableIdentity, right: ExecutableIdentity) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeMs === right.mtimeMs;

export class RuntimeSnapshotStore {
  private readonly filePath: string;
  private entries = new Map<AgentBackendId, RuntimeSnapshotEntry>();
  private loading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writes = Promise.resolve();

  constructor(userData: string) {
    this.filePath = join(userData, SNAPSHOT_FILE);
  }

  /* A missing or unreadable file is an ordinary first launch: the gate then waits
     for discovery exactly as it did before this ledger existed. */
  private load() {
    this.loading ??= (async () => {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
        const list = isRecord(parsed) && Array.isArray(parsed.entries) ? parsed.entries : [];
        this.entries = new Map(
          list.filter(isEntry).map((entry) => [entry.backend, entry] as const)
        );
      } catch {
        this.entries = new Map();
      }
    })();
    return this.loading;
  }

  /**
   * Provisional facts for the window: only entries whose executable is still the
   * very file this launch's predecessor confirmed. An uninstall, an upgrade or a
   * shadowed PATH entry fails the identity check and simply yields nothing.
   */
  async provisionalBackends(
    displayName: (backend: AgentBackendId) => string
  ): Promise<BackendInfo[]> {
    await this.load();
    const restored = await Promise.all(
      AGENT_BACKEND_ORDER.map(async (backend): Promise<BackendInfo[]> => {
        const entry = this.entries.get(backend);
        if (!entry) return [];
        const identity = await readIdentity(entry.executable);
        if (!identity || !sameIdentity(identity, entry.identity)) return [];
        return [{
          id: backend,
          displayName: displayName(backend),
          runtimeStatus: "installed",
          authStatus: "unknown",
          capabilities: entry.capabilities,
          version: entry.version,
          path: entry.executable,
          provisional: true,
        }];
      })
    );
    return restored.flat();
  }

  /** Records this launch's own confirmation; a failed stat leaves the previous entry alone. */
  async record(backend: AgentBackendId, runtime: ConfirmedRuntime) {
    await this.load();
    const identity = await readIdentity(runtime.executable);
    if (!identity) return;
    this.entries.set(backend, {
      backend,
      executable: runtime.executable,
      version: runtime.version,
      capabilities: runtime.capabilities,
      identity,
      savedAt: Date.now(),
    });
    this.schedule();
  }

  /* A backend this launch proved missing must not come back as provisional next
     launch: the identity check cannot catch a CLI that left the PATH but stayed on disk. */
  async forget(backend: AgentBackendId) {
    await this.load();
    if (!this.entries.delete(backend)) return;
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, WRITE_DELAY_MS);
    this.timer.unref();
  }

  flush() {
    const content = `${JSON.stringify({ entries: [...this.entries.values()] }, null, 2)}\n`;
    this.writes = this.writes.then(() =>
      durableReplaceFile(this.filePath, content).catch((cause) =>
        console.warn("[startup] agent runtime snapshot write failed", cause)
      )
    );
    return this.writes;
  }
}
