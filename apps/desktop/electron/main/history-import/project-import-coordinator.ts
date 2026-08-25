/**
 * [INPUT]: Depends on crypto, Project/History shared Contract with Injected directory selection, scan counting, Project commit port
 * [OUTPUT]: Provides ProjectImportCoordinator: prepare instantly return tokens, counts, asynchronously, TTL test and carry the only commit input for the created determination
 * [POS]: The history-import Project onboarding state machine; Service only sort the index and no longer holds the token added
 */

import { randomUUID } from "node:crypto";
import type { HistorySourceCount } from "../../../shared/history-import-ipc";
import type { Project } from "../../../shared/projects-ipc";

const PREPARE_TTL = 10 * 60_000;

type PreparedProject = {
  canonicalRoot: string;
  name: string;
  /** 后台侦测，弹窗不等它；renderer 经 counts(token) 领取。 */
  counts: Promise<HistorySourceCount[]>;
  expiresAt: number;
};

export class ProjectImportCoordinator {
  private readonly prepared = new Map<string, PreparedProject>();

  constructor(private readonly ports: {
    select(): Promise<{ canonicalRoot: string; name: string } | null>;
    count(canonicalRoot: string): Promise<HistorySourceCount[]>;
    commit(input: { canonicalRoot: string; name: string }): Promise<{ project: Project; created: boolean }>;
  }) {}

  /** 目录选定即返回；侦测计数在后台跑，确认弹窗零等待。 */
  async prepare() {
    const selected = await this.ports.select();
    if (!selected) return null;
    this.evictExpired();
    const token = `history_project_${randomUUID().replaceAll("-", "")}`;
    const counts = this.ports.count(selected.canonicalRoot);
    counts.catch(() => {});
    this.prepared.set(token, { ...selected, counts, expiresAt: Date.now() + PREPARE_TTL });
    return { token, canonicalRoot: selected.canonicalRoot, name: selected.name, expiresAt: this.prepared.get(token)!.expiresAt };
  }

  counts(token: string) {
    return this.require(token).counts;
  }

  /** 只有 commit 成功才消费令牌；瞬态失败允许原弹窗重试（commit 端口对重复目录幂等）。 */
  async commit(token: string) {
    const value = this.require(token);
    const result = await this.ports.commit({ canonicalRoot: value.canonicalRoot, name: value.name });
    this.prepared.delete(token);
    return { result, prepared: value };
  }

  private require(token: string) {
    const value = this.prepared.get(token);
    if (!value || value.expiresAt <= Date.now()) {
      this.prepared.delete(token);
      throw new Error("Project 添加确认已失效，请重新选择目录");
    }
    return value;
  }

  private evictExpired() {
    const now = Date.now();
    for (const [token, value] of this.prepared) {
      if (value.expiresAt <= now) this.prepared.delete(token);
    }
  }
}
