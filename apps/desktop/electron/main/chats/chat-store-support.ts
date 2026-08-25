/**
 * [INPUT]: Depends on Node fs/path, chat-schema/chat-commit with ChatRecord and receives chatsRoot/readText/atomicWrite
 * [OUTPUT]: Provides ChatStore's id/Project role guard, cold start detection, single ledger reading and writing and damage isolation
 * [POS]: The statusless IO/guard support layer of the chats module; ChatStore only retains durable generation and serial state machines
 */

import { readdir, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { AppChatRole, ChatRecord } from "../../../shared/chats-ipc";
import { errorMessage } from "../errors";
import {
  ChatLedgerCorruptError,
  ChatNotFoundError,
} from "./chat-commit";
import {
  CHAT_ID_PATTERN,
  SCHEMA_VERSION,
  UnsupportedChatSchemaError,
  parseChatFile,
  serializeChatFile,
} from "./chat-schema";

type LoadedChat = { path: string; record: ChatRecord };
type CorruptChat = { path: string; cause: unknown };
type ReadText = (filePath: string) => Promise<string>;
type AtomicWrite = (filePath: string, content: string) => Promise<void>;
type IsAppProject = (projectId: string) => boolean;

export function assertChatId(chatId: string) {
  if (!CHAT_ID_PATTERN.test(chatId)) throw new Error("聊天 id 格式无效");
}

export function isAppProjectMember(
  isAppProject: IsAppProject | undefined,
  projectId: string | null
) {
  return projectId !== null && Boolean(isAppProject?.(projectId));
}

export function assertProjectRole(
  isAppProject: IsAppProject | undefined,
  projectId: string | null,
  appRole: AppChatRole | null
) {
  if (!isAppProject) return;
  const appProject = isAppProjectMember(isAppProject, projectId);
  if (appProject && appRole === null) {
    throw Object.assign(
      new Error("App Project 成员必须经 App 专用入口指定角色"),
      { status: 403 }
    );
  }
  if (!appProject && appRole !== null) {
    throw Object.assign(
      new Error("普通 Project 聊天不能携带 App 角色"),
      { status: 403 }
    );
  }
}

export async function discoverChatFiles(
  chatsRoot: string,
  readText: ReadText
) {
  const entries = await readdir(chatsRoot, { withFileTypes: true });
  const files = entries
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (!entry.isFile()) return [];
      const match = entry.name.match(/^([A-Za-z0-9_-]{1,128})\.json$/);
      return match
        ? [{ id: match[1]!, path: join(chatsRoot, entry.name) }]
        : [];
    });
  const loaded: Array<LoadedChat | CorruptChat> = [];
  for (const file of files) {
    try {
      const record = parseChatFile(JSON.parse(await readText(file.path)));
      if (record.id !== file.id) {
        throw new Error(`文件名 ${file.id} 与 record.id ${record.id} 不一致`);
      }
      loaded.push({ path: file.path, record });
    } catch (cause) {
      loaded.push({ path: file.path, cause });
    }
  }
  const future = loaded.find(
    (item): item is { path: string; cause: UnsupportedChatSchemaError } =>
      "cause" in item &&
      item.cause instanceof UnsupportedChatSchemaError &&
      item.cause.version > SCHEMA_VERSION
  );
  if (future) throw future.cause;
  return {
    records: loaded.filter((item): item is LoadedChat => "record" in item),
    corrupt: loaded.filter((item): item is CorruptChat => "cause" in item),
  };
}

export async function readChatRecord(
  path: string,
  expectedId: string,
  readText: ReadText
) {
  try {
    const record = parseChatFile(JSON.parse(await readText(path)));
    if (record.id !== expectedId) {
      throw new Error("聊天文件与请求 id 不一致");
    }
    return record;
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      throw new ChatNotFoundError("聊天账本不存在");
    }
    if (cause && typeof cause === "object" && "code" in cause) throw cause;
    throw new ChatLedgerCorruptError(`聊天账本损坏：${errorMessage(cause)}`);
  }
}

export async function persistChatRecord(
  path: string,
  record: ChatRecord,
  atomicWrite?: AtomicWrite
) {
  if (!record.homeDir) throw new Error("canonical chat 缺少 homeDir");
  const content = serializeChatFile(record);
  if (atomicWrite) {
    await atomicWrite(path, content);
    return;
  }
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { mode: 0o600 });
  await rename(temporary, path);
}

export async function isolateCorruptChatFile(
  path: string,
  cause: unknown,
  now: number
) {
  const reason = errorMessage(cause);
  const backup = `${path}.corrupt-${now}`;
  try {
    await rename(path, backup);
    return `聊天文件 ${basename(path)} 已损坏并备份到 ${backup}。原因：${reason}`;
  } catch (backupCause) {
    return `聊天文件 ${basename(path)} 无法读取，也无法备份。原因：${reason}；备份错误：${errorMessage(backupCause)}`;
  }
}
