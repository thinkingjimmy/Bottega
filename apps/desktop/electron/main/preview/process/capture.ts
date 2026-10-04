/**
 * [INPUT]: A birth-verified Agent process group, its frozen fence and the bundled kernel-argument reader.
 * [OUTPUT]: PreviewCaptures with expiring local restart offers and a public projection of random ID and port only.
 * [POS]: End-of-turn fallback. Private command data stays in main memory; the closed artifact schema rejects argv and cwd.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative } from "node:path";
import { realpath } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { PreviewView } from "@ai-chat/cloud-protocol/resources/preview";
import { observeProcessBirth } from "../../custody/identity";
import { listenerIdentity } from "./identity";
import type { FrozenPreviewFence } from "./fence";
import type { PreviewServerSupervisor } from "./supervisor";
const exec = promisify(execFile);
const commandSchema = z.object({ argv: z.array(z.string().max(65536).refine(s => !s.includes("\0"))).min(1).max(128), cwd: z.string().max(4096) }).strict();
type Scope = { serverId: string; chatId: string; incarnationId: string };
type Candidate = Scope & { rootPid: number; rootBirth: string; argv: string[]; cwd: string; port: number; fence: FrozenPreviewFence; expires: number };
export class PreviewCaptures {
  private readonly candidates = new Map<string, Candidate>();
  private readonly keeping = new Map<string, Promise<void>>();
  constructor(private readonly helper: string, private readonly services: PreviewServerSupervisor) {}
  private prune() { for (const [id, value] of this.candidates) if (Date.now() >= value.expires) this.candidates.delete(id); }
  async capture(input: { chatId: string; incarnationId: string; rootPid: number; rootBirth: string; fence: FrozenPreviewFence }): Promise<{ serverId: string; port: number }[]> {
    if (process.platform !== "darwin" || process.arch !== "arm64") return [];
    this.prune();
    const root = observeProcessBirth(input.rootPid);
    if (root.state !== "present" || root.birthIdentity !== input.rootBirth || root.processGroupId !== input.rootPid) return [];
    const signal = AbortSignal.timeout(6000);
    const { stdout } = await exec("/usr/sbin/lsof", ["-nP", "-a", "-g", String(input.rootPid), "-iTCP", "-sTCP:LISTEN", "-Fpn"], { signal, timeout: 1000, maxBuffer: 16384 }).catch(() => ({ stdout: "" }));
    const ports = [...new Set([...stdout.matchAll(/^n127\.0\.0\.1:(\d+)$/gm)].map(match => Number(match[1])))].slice(0, 4);
    const publicViews: { serverId: string; port: number }[] = [];
    for (const port of ports) {
      if (signal.aborted) break;
      const identity = await listenerIdentity(input.rootPid, input.rootBirth, port);
      if (!identity) continue;
      const serverId = randomUUID();
      publicViews.push({ serverId, port });
      try {
        const captured = await exec(this.helper, [String(identity.pid)], { signal, timeout: 2000, maxBuffer: 131072, env: {} });
        const command = commandSchema.parse(JSON.parse(captured.stdout));
        const cwd = relative(await realpath(input.fence.workspace), await realpath(command.cwd));
        const current = await listenerIdentity(input.rootPid, input.rootBirth, port);
        if (!isAbsolute(command.argv[0]!) || isAbsolute(cwd) || cwd === ".." || cwd.startsWith("../") ||
          !current || current.pid !== identity.pid || current.birth !== identity.birth) continue;
        if (this.candidates.size >= 64) this.candidates.delete(this.candidates.keys().next().value!);
        this.candidates.set(serverId, { ...input, serverId, port, argv: command.argv, cwd: cwd || ".", expires: Date.now() + 900000 });
      } catch { /* Exact capture is optional; the public card can ask the Agent to restart. */ }
    }
    // Never return the private candidates, command arguments, working directory or environment.
    return publicViews;
  }
  view(scope: Scope): PreviewView | null {
    this.prune(); const value = this.candidates.get(scope.serverId);
    return value && value.chatId === scope.chatId && value.incarnationId === scope.incarnationId
      ? { serverId: scope.serverId, chatId: scope.chatId, incarnationId: scope.incarnationId, sessionId: null, state: "captured", streaming: false } : null;
  }
  keep(scope: Scope): Promise<void> {
    if (!this.view(scope)) return Promise.reject(new Error("preview-capture-expired"));
    const running = this.keeping.get(scope.serverId); if (running) return running;
    const value = this.candidates.get(scope.serverId)!;
    const task = (async () => {
      // The original group is always settled by its owner. A click never adopts or signals it.
      for (let attempt = 0; attempt < 50; attempt++) {
        const root = observeProcessBirth(value.rootPid);
        if (root.state === "absent" || root.state === "present" && root.birthIdentity !== value.rootBirth) break;
        if (attempt === 49) throw new Error("preview-cleanup-pending");
        await delay(100);
      }
      await this.services.start({ ...value, mode: "dev", signal: AbortSignal.timeout(65000) });
      this.candidates.delete(value.serverId);
    })().finally(() => this.keeping.delete(scope.serverId));
    this.keeping.set(scope.serverId, task); return task;
  }
  close() { this.candidates.clear(); }
}
