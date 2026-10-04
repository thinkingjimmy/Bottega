/**
 * [INPUT]: OS process birth observations and bounded lsof listener reads.
 * [OUTPUT]: listenerIdentity and sameListener for an exact loopback port owned by a managed process group.
 * [POS]: Every inbound preview request rechecks this identity before connecting upstream.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { observeProcessBirth } from "../../custody/identity";
const exec = promisify(execFile);
export type ListenerIdentity = { pid: number; birth: string; port: number; rootPid: number; rootBirth: string };
export async function listenerIdentity(rootPid: number, rootBirth: string, port: number): Promise<ListenerIdentity | null> {
  const root = observeProcessBirth(rootPid);
  if (root.state !== "present" || root.processGroupId !== rootPid || root.birthIdentity !== rootBirth) return null;
  try {
    const { stdout } = await exec("/usr/sbin/lsof", ["-nP", "-a", "-iTCP:" + port, "-sTCP:LISTEN", "-Fpn"], { timeout: 2000, maxBuffer: 16_384 });
    let pid = 0; const owners = new Set<number>();
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      if (line.startsWith("n")) {
        if (line.slice(1) !== `127.0.0.1:${port}`) return null;
        owners.add(pid);
      }
    }
    if (owners.size !== 1) return null;
    const listenerPid = [...owners][0]!, birth = observeProcessBirth(listenerPid);
    if (birth.state !== "present" || birth.processGroupId !== rootPid) return null;
    return { pid: listenerPid, birth: birth.birthIdentity, port, rootPid, rootBirth };
  } catch { return null; }
}
export async function sameListener(expected: ListenerIdentity) {
  const current = await listenerIdentity(expected.rootPid, expected.rootBirth, expected.port);
  return !!current && current.pid === expected.pid && current.birth === expected.birth;
}
