/**
 * [INPUT]: Depends on Node crypto/fs/path, shared ChatHome status, SettingsStore/ChatStore port and ChatHomeLedger
 * [OUTPUT]: Provides ChatHomeService root selection, fork-worktree-aware ownership, canonical-record recovery, rollback compensation, deletion admission/release, and containment-correct read-only roots
 * [POS]: Chat Home ownership coordinator; cross-store SQLite continuation state remains in the Chat saga
 */

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  rename,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  CHAT_HOME_NOT_READY,
  type ChatHomeStatus,
} from "../../../shared/settings-ipc";
import type { AgentWorkspaceScope } from "../../../shared/agent-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { SettingsStore } from "../settings-store";
import { errorMessage } from "../errors";
import { ChatHomeLedger } from "./chat-home-ledger";
import type { ChatHomeRecord, RootIdentity } from "./ledger-values";

const SENTINEL = ".ai-chat-home.json";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (value: Awaited<ReturnType<typeof stat>>): RootIdentity => ({
  dev: String(value.dev),
  ino: String(value.ino),
});
const sameIdentity = (left: RootIdentity, right: RootIdentity) =>
  left.dev === right.dev && left.ino === right.ino;

class ChatHomeCollisionError extends Error {}

type CreationInput = {
  intentId: string;
  chatId: string;
  incarnationId?: string;
  submission: unknown;
  workspaceScope: AgentWorkspaceScope;
  stagingOwner?: string;
  worktree?: ChatHomeRecord["worktree"];
};

export class ChatHomeService {
  private readonly listeners = new Set<(status: ChatHomeStatus) => void>();
  private worktreeCleanup?: (record: ChatHomeRecord) => Promise<"absent" | "removed" | "recovery">;
  private worktreeAdmission?: (record: ChatHomeRecord) => Promise<"absent" | "clean" | "recovery">;

  constructor(
    private readonly settings: SettingsStore,
    private readonly chats: ChatStore,
    readonly ledger: ChatHomeLedger,
    private readonly now: () => number = Date.now
  ) {}

  async initialize() {
    const warning = await this.ledger.initialize();
    if (warning) this.chats.pushWarning(warning);
  }

  status(): ChatHomeStatus {
    const settings = this.settings.get();
    return {
      root: settings.chatHomesRoot,
      state: settings.chatHomeState,
    };
  }

  onStatus(listener: (status: ChatHomeStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  canCreateChat() {
    const settings = this.settings.get();
    return (
      settings.chatHomesRoot !== null && settings.chatHomeState === "ready"
    );
  }

  assertCanCreateChat() {
    if (!this.canCreateChat()) {
      // 冒号前是给日志的坐标，冒号后是给用户的出路——两半各自完整，
      // renderer 剥掉前半段后剩下的仍是一句能照着做的话。
      throw new Error(
        `${CHAT_HOME_NOT_READY}: 请先在 Settings 中选定 Chat Home 存放位置`
      );
    }
  }

  /* ready 与目录存在性同时成立：先确保根在盘上，再提交状态。
     断代升级后没有迁移期，选定即就绪。 */
  async chooseRoot(canonicalRoot: string) {
    await mkdir(canonicalRoot, { recursive: true, mode: 0o700 });
    await this.settings.setTrusted({
      chatHomesRoot: canonicalRoot,
      chatHomeState: "ready",
    });
    this.emit();
    return this.status();
  }

  async beginCreation(input: CreationInput) {
    this.assertCanCreateChat();
    const root = await this.verifiedRoot();
    const homeDir = join(root.canonical, input.chatId);
    const submissionHash = hash(input.submission);
    const existing = this.ledger.get(input.chatId);
    if (
      existing &&
      input.incarnationId &&
      existing.incarnationId !== input.incarnationId
    ) {
      throw new Error("CreationIntent incarnationId 与已有 ownership 冲突");
    }
    const incarnationId =
      existing?.intentId === input.intentId
        ? existing.incarnationId
        : input.incarnationId ?? randomUUID().replaceAll("-", "");
    let planned = await this.ledger.plan({
      intentId: input.intentId,
      chatId: input.chatId,
      incarnationId,
      homeDir,
      canonicalRoot: root.canonical,
      rootIdentity: root.identity,
      ownership: "planned",
      phase: "planned",
      submissionHash,
      workspaceScope: input.workspaceScope,
      ...(input.stagingOwner ? { stagingOwner: input.stagingOwner } : {}),
      ...(input.worktree ? { worktree: input.worktree } : {}),
    });
    if (planned.phase === "planned") {
      try {
        await this.materialize(planned);
      } catch (cause) {
        if (cause instanceof ChatHomeCollisionError) {
          await this.ledger.transition(input.chatId, "planned", "rolledBack", {
            ownership: "invalid",
            terminalAt: this.now(),
          });
        }
        throw cause;
      }
      planned = await this.ledger.transition(
        input.chatId,
        "planned",
        "materialized",
        { ownership: "valid" }
      );
    }
    return planned;
  }

  markPrepared(chatId: string) {
    return this.ledger.transition(
      chatId,
      ["materialized", "prepared"],
      "prepared"
    );
  }

  commitCreation(chatId: string) {
    return this.ledger.transition(
      chatId,
      ["prepared", "committed"],
      "committed",
      { ownership: "valid", terminalAt: this.now() }
    );
  }

  async committedCreationEvidence(chatId: string, intentId: string) {
    const record = this.ledger.get(chatId);
    if (
      !record ||
      record.phase !== "committed" ||
      record.ownership !== "valid" ||
      record.intentId !== intentId
    ) {
      throw new Error("Committed Chat Home evidence is unavailable");
    }
    const verified = await this.verifyRecordOwnership(record, false);
    if (!verified) throw new Error("Committed Chat Home ownership cannot be verified");
    const homeIdentity = identity(await stat(verified.homeDir));
    return {
      receipt: {
        phase: "committed" as const,
        chatId: verified.chatId,
        intentId: verified.intentId,
        incarnationId: verified.incarnationId,
        homeDir: verified.homeDir,
      },
      homeDirIdentity: {
        root: verified.rootIdentity,
        home: homeIdentity,
      },
    };
  }

  async isolateCommittedCreation(chatId: string, intentId: string, reason: string) {
    const evidence = await this.committedCreationEvidence(chatId, intentId);
    this.chats.pushWarning(
      `Committed Chat Home ${chatId} was isolated without deletion: ${reason}`
    );
    return evidence;
  }

  identityForCreation(chatId: string) {
    const record = this.ledger.get(chatId);
    if (!record || record.ownership === "invalid") return undefined;
    return {
      incarnationId: record.incarnationId,
      homeDir: record.homeDir,
      intentId: record.intentId,
      phase: record.phase,
      worktree: record.worktree,
    };
  }

  async recoverCreations(liveManualIntentIds: ReadonlySet<string>) {
    for (const record of this.ledger.list()) {
      if (
        ["committed", "rolledBack"].includes(record.phase) ||
        liveManualIntentIds.has(record.intentId)
      ) {
        continue;
      }
      const canonical = this.chats.getMetadata(record.chatId);
      if (
        canonical?.incarnationId === record.incarnationId &&
        canonical.homeDir === record.homeDir &&
        (!record.worktree ||
          (canonical.executionKind === "managed-worktree" &&
            canonical.executionDir === join(record.homeDir, record.worktree.relativePath)))
      ) {
        await this.markPrepared(record.chatId);
        await this.commitCreation(record.chatId);
        continue;
      }
      await this.rollbackCreation(record.chatId).catch((cause) => {
        this.chats.pushWarning(
          `Chat Home ${record.chatId} 补偿待重试：${errorMessage(cause)}`
        );
      });
    }
  }

  async rollbackCreation(chatId: string) {
    const current = this.ledger.get(chatId);
    if (
      !current ||
      current.phase === "rolledBack" ||
      current.phase === "committed"
    ) {
      return;
    }
    const canonical = this.chats.getMetadata(current.chatId);
    if (
      canonical?.incarnationId === current.incarnationId &&
      canonical.homeDir === current.homeDir &&
      (!current.worktree ||
        (canonical.executionKind === "managed-worktree" &&
          canonical.executionDir === join(current.homeDir, current.worktree.relativePath)))
    ) {
      await this.markPrepared(current.chatId);
      await this.commitCreation(current.chatId);
      return;
    }
    await this.ledger.transition(
      chatId,
      ["planned", "materialized", "prepared", "rollingBack"],
      "rollingBack"
    );
    if (current.worktree) {
      const cleanup = await this.worktreeCleanup?.(current);
      if (!cleanup || cleanup === "recovery") {
        throw new Error("Managed worktree requires recovery before Chat Home rollback");
      }
    }
    const moved = await this.moveOwnedHomeToTrash(current, true);
    if (!moved && await this.pathExists(current.homeDir)) {
      throw new Error("Chat Home 所有权无法验证，补偿将在稍后重试");
    }
    await this.ledger.transition(chatId, "rollingBack", "rolledBack", {
      ownership: "invalid",
      terminalAt: this.now(),
    });
  }

  readOnlyRoots(excludeWorkspace?: string) {
    const workspace = excludeWorkspace ? resolve(excludeWorkspace) : undefined;
    return this.ledger
      .validHomes()
      .filter((path) => {
        if (!workspace) return true;
        /* 自身 Home 与它的祖先都不是"另一个 Chat Home"：worktree Chat 的
           workspace 是 <home>/worktree，字符串相等判不出这层包含关系。 */
        const child = relative(resolve(path), workspace);
        return child !== "" && (child.startsWith("..") || isAbsolute(child));
      })
      .sort();
  }

  configureWorktreeCleanup(
    cleanup: (record: ChatHomeRecord) => Promise<"absent" | "removed" | "recovery">
  ) {
    this.worktreeCleanup = cleanup;
  }

  configureWorktreeAdmission(
    inspect: (record: ChatHomeRecord) => Promise<"absent" | "clean" | "recovery">
  ) {
    this.worktreeAdmission = inspect;
  }

  async assertDeletionAdmissible(
    records: readonly Readonly<{ id: string; incarnationId: string }>[]
  ) {
    for (const candidate of records) {
      const record = this.ledger.get(candidate.id);
      if (!record || record.incarnationId !== candidate.incarnationId || !record.worktree) continue;
      const result = await this.worktreeAdmission?.(record);
      if (!result || result === "recovery") {
        throw Object.assign(
          new Error(`Chat ${candidate.id} 的 managed worktree 有未提交内容或身份异常；请先 commit 或恢复后再删除`),
          { status: 409 }
        );
      }
    }
  }

  async releaseWorktreeForDeletion(candidate: Readonly<{ id: string; incarnationId: string }>) {
    const record = this.ledger.get(candidate.id);
    if (!record || record.incarnationId !== candidate.incarnationId || !record.worktree) return;
    const result = await this.worktreeCleanup?.(record);
    if (!result || result === "recovery") {
      throw new Error("Managed worktree cleanup requires recovery");
    }
  }

  async releaseHomeForDeletion(
    candidate: Readonly<{ id: string; incarnationId: string }>,
    operationId: string
  ) {
    const record = this.ledger.get(candidate.id);
    if (!record || record.incarnationId !== candidate.incarnationId) return;
    const trashRoot = join(record.canonicalRoot, ".trash");
    const suffix = createHash("sha256").update(operationId).digest("hex").slice(0, 20);
    const target = join(trashRoot, `${record.chatId}-${suffix}`);
    const [homePresent, targetPresent] = await Promise.all([
      this.pathExists(record.homeDir),
      this.pathExists(target),
    ]);
    if (homePresent && targetPresent) {
      throw new Error("Chat Home deletion found both live and trash paths");
    }
    if (homePresent) {
      const verified = await this.verifyRecordOwnership(record, false);
      if (!verified) {
        // 未获证明的目录不是产品资产；只撤销账本声明，绝不猜测删除。
        await this.ledger.removeOwnership(candidate.id);
        return;
      }
      await mkdir(trashRoot, { recursive: true, mode: 0o700 });
      await rename(record.homeDir, target);
    }
    if (homePresent || targetPresent) {
      await rm(target, { recursive: true });
    }
    await this.ledger.removeOwnership(candidate.id);
  }

  async verifyOwnership(chatId: string) {
    const record = this.ledger.get(chatId);
    return record ? this.verifyRecordOwnership(record, false) : undefined;
  }

  private async verifyRecordOwnership(
    record: ChatHomeRecord,
    allowPlanned: boolean
  ) {
    const durable = this.ledger.get(record.chatId);
    if (
      !durable ||
      durable.intentId !== record.intentId ||
      durable.incarnationId !== record.incarnationId ||
      durable.homeDir !== record.homeDir ||
      (durable.ownership !== "valid" &&
        !(allowPlanned && durable.ownership === "planned"))
    ) {
      return undefined;
    }
    try {
      const rootStat = await stat(record.canonicalRoot);
      if (!sameIdentity(identity(rootStat), record.rootIdentity)) return undefined;
      const expected = join(record.canonicalRoot, record.chatId);
      if ((await realpath(record.homeDir)) !== expected) return undefined;
      if ((await lstat(record.homeDir)).isSymbolicLink()) return undefined;
      if (!(await this.hasMatchingMarker(record))) return undefined;
      return record;
    } catch {
      return undefined;
    }
  }

  async moveOwnedHomeToTrash(
    record: ChatHomeRecord,
    allowPlanned = false
  ) {
    const verified = await this.verifyRecordOwnership(record, allowPlanned);
    if (!verified) return undefined;
    const trashRoot = join(verified.canonicalRoot, ".trash");
    await mkdir(trashRoot, { recursive: true, mode: 0o700 });
    const target = join(trashRoot, `${verified.chatId}-${this.now()}`);
    await rename(verified.homeDir, target);
    return target;
  }

  private async verifiedRoot() {
    const configured = this.settings.get().chatHomesRoot;
    if (!configured) throw new Error("Chat Home root 未配置");
    await mkdir(configured, { recursive: true, mode: 0o700 });
    const canonical = await realpath(configured);
    return { canonical, identity: identity(await stat(canonical)) };
  }

  private async materialize(record: ChatHomeRecord) {
    try {
      await mkdir(record.homeDir, { recursive: false, mode: 0o700 });
    } catch (cause) {
      if (
        (cause as NodeJS.ErrnoException).code === "EEXIST" &&
        await this.isMatchingMaterializedHome(record)
      ) {
        return;
      }
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ChatHomeCollisionError(
          `Chat Home 目录已存在且不属于 intent ${record.intentId}`
        );
      }
      throw cause;
    }
    if ((await realpath(record.homeDir)) !== record.homeDir) {
      throw new Error("Chat Home 路径不是预期 canonical 子目录");
    }
    const marker = join(record.homeDir, SENTINEL);
    try {
      await writeFile(
        marker,
        `${JSON.stringify({
          intentId: record.intentId,
          chatId: record.chatId,
          incarnationId: record.incarnationId,
        })}\n`,
        { mode: 0o600, flag: "wx" }
      );
    } catch (cause) {
      await rmdir(record.homeDir).catch(() => {});
      throw cause;
    }
  }

  private async isMatchingMaterializedHome(record: ChatHomeRecord) {
    try {
      const homeStat = await lstat(record.homeDir);
      if (homeStat.isSymbolicLink() || !homeStat.isDirectory()) return false;
      if ((await realpath(record.homeDir)) !== record.homeDir) return false;
      const entries = await readdir(record.homeDir);
      return (
        entries.length === 1 &&
        entries[0] === SENTINEL &&
        await this.hasMatchingMarker(record)
      );
    } catch {
      return false;
    }
  }

  private async hasMatchingMarker(record: ChatHomeRecord) {
    try {
      const marker = join(record.homeDir, SENTINEL);
      const markerStat = await lstat(marker);
      if (markerStat.isSymbolicLink() || !markerStat.isFile()) return false;
      const value = JSON.parse(await readFile(marker, "utf8")) as {
        intentId?: unknown;
        chatId?: unknown;
        incarnationId?: unknown;
      };
      return (
        Object.keys(value).length === 3 &&
        value.intentId === record.intentId &&
        value.chatId === record.chatId &&
        value.incarnationId === record.incarnationId
      );
    } catch {
      return false;
    }
  }

  private async pathExists(path: string) {
    try {
      await lstat(path);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw cause;
    }
  }

  private emit() {
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }
}
