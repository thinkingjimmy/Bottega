/**
 * [INPUT]: Depends on descriptor version loaders, a 24-hour cache clock, retry cooldown and bounded GitHub/npm registry requests.
 * [OUTPUT]: Provides LatestVersionCache with generation-safe results, plus the GitHub-release and npm-registry latest-version loaders.
 * [POS]: setup's non-blocking version-check boundary; callers read a cached result immediately and never wait on the network
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";

const TTL_MS = 24 * 60 * 60 * 1_000;
const RETRY_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

type Entry = {
  generation: number;
  expiresAt: number;
  version?: string;
  checking: boolean;
};

export class LatestVersionCache {
  private readonly entries = new Map<AgentBackendId, Entry>();
  private readonly flights = new Map<AgentBackendId, Promise<Entry>>();

  constructor(
    private readonly dependencies: {
      now?: () => number;
      ttlMs?: number;
    } = {}
  ) {}

  current(backend: AgentBackendId) {
    return this.entries.get(backend);
  }

  refresh(
    backend: AgentBackendId,
    load: () => Promise<string>,
    force = false
  ) {
    const now = (this.dependencies.now ?? Date.now)();
    const current = this.entries.get(backend);
    if (!force && current && !current.checking && current.expiresAt > now) {
      return Promise.resolve(current);
    }
    const active = this.flights.get(backend);
    if (active && !force) return active;
    const generation = (current?.generation ?? 0) + 1;
    this.entries.set(backend, {
      generation,
      expiresAt: current?.expiresAt ?? 0,
      version: current?.version,
      checking: true,
    });
    const request = Promise.resolve().then(load)
      .then((version): Entry => ({
        generation,
        version,
        expiresAt:
          (this.dependencies.now ?? Date.now)() +
          (this.dependencies.ttlMs ?? TTL_MS),
        checking: false,
      }))
      .catch((): Entry => ({
        generation,
        version: current?.version,
        expiresAt: (this.dependencies.now ?? Date.now)() + RETRY_MS,
        checking: false,
      }))
      .then((entry) => {
        if (this.entries.get(backend)?.generation === generation) {
          this.entries.set(backend, entry);
        }
        return this.entries.get(backend) ?? entry;
      })
      .finally(() => {
        if (this.flights.get(backend) === request) {
          this.flights.delete(backend);
        }
      });
    this.flights.set(backend, request);
    return request;
  }
}

export async function githubLatestVersion(
  repository: string,
  fetcher: typeof fetch = fetch
) {
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bottega",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub latest release 请求失败：${response.status}`);
  }
  const value = (await response.json()) as { tag_name?: unknown };
  if (typeof value.tag_name !== "string" || !value.tag_name.trim()) {
    throw new Error("GitHub latest release 缺少 tag_name");
  }
  return value.tag_name.replace(/^v/, "");
}

/* The npm registry has no 60-requests-per-hour anonymous cap, so CLIs that publish there read their latest release from it. */
export async function npmLatestVersion(
  packageName: string,
  fetcher: typeof fetch = fetch
) {
  const response = await fetcher(
    `https://registry.npmjs.org/${packageName.replace("/", "%2F")}/latest`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`npm latest 请求失败：${response.status}`);
  const value = (await response.json()) as { version?: unknown };
  if (typeof value.version !== "string" || !value.version.trim()) throw new Error("npm latest 缺少 version");
  return value.version.trim();
}
