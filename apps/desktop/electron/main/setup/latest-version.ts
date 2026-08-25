/**
 * [INPUT]: Depends on descriptor latestVersion Extended, 24h clock and display generation
 * [OUTPUT]: Provides LatestVersionCache and GitHub Release to read the latest stable version
 * [POS]: the information boundaries of the non-blocked version of the setup; Runtime check not waiting for the network
 */

import type { AgentBackendId } from "../../../shared/agent-ipc";

const TTL_MS = 24 * 60 * 60 * 1_000;

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
    if (!force && current?.version && current.expiresAt > now) {
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
    const request = load()
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
        expiresAt: current?.expiresAt ?? 0,
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
