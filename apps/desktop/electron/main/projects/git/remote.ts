/**
 * [INPUT]: Depends on the controlled read-only Git runner and credential-free network repository URLs.
 * [OUTPUT]: Captures an optional portable origin hint without local paths, credentials or executable configuration.
 * [POS]: Project creation metadata; an unavailable origin never prevents local workspace creation.
 */
import { runGit } from "./git-runner";
export async function readProjectRemote(directory: string): Promise<string | undefined> {
  try {
    const value = (await runGit(directory, ["config", "--local", "--no-includes", "--get", "remote.origin.url"], { timeoutMs: 2000, maxBytes: 4096 })).trim();
    if (/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[^/\\\s][^\s]*$/.test(value) && !/^[A-Za-z]:/.test(value)) return value.slice(0, 2048);
    const url = new URL(value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return undefined;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.href.length <= 2048 ? url.href : undefined;
  } catch { return undefined; }
}
