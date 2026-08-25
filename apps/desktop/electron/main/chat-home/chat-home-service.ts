/**
 * [INPUT]: Depends on Node crypto/fs/path, shared ChatHome status, SettingsStore/ChatStore port and ChatHomeLedger
 * [OUTPUT]: Provides ChatHomeService: root chooser, ready, ledger-owned rolledBack Re-test, eight-step CreationIntent's exact-marker objection/collision rejection, re-test recovery compensation, read-only root snapshot and ownership verification
 * [POS]: The coordinator of the chat-home area; The work across the store is not done in the ledger leaf lock
 */

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
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
};

export class ChatHomeService {
  private readonly listeners = new Set<(status: ChatHomeStatus) => void>();

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

  identityForCreation(chatId: string) {
    const record = this.ledger.get(chatId);
    if (!record || record.ownership === "invalid") return undefined;
    return {
      incarnationId: record.incarnationId,
      homeDir: record.homeDir,
      intentId: record.intentId,
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
    await this.ledger.transition(
      chatId,
      ["planned", "materialized", "prepared", "rollingBack"],
      "rollingBack"
    );
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
    return this.ledger
      .validHomes()
      .filter((path) => path !== excludeWorkspace)
      .sort();
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
