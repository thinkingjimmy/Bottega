/**
 * [INPUT]: Depends on Node fs/path, nanoid and shared chats/agent
 * [OUTPUT]: Provides AttachmentStore: atomic data-URL writes, reads by id, observable deletion failure, and the startup sweep of unreferenced files
 * [POS]: Attachment byte store of the chats module; bytes live outside the Chat database and only ChatsService consumes them
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { errorMessage } from "../errors";
import {
  IMAGE_DATA_URL_PATTERN,
  dataUrlByteSize,
} from "../../../shared/agent-ipc";
import type {
  ChatAttachmentMeta,
  ChatAttachmentPayload,
} from "../../../shared/chats-ipc";

export class AttachmentStore {
  constructor(readonly root: string) {}

  /** 全部写盘成功才返回 metas；任一失败回滚已写文件并抛错（无半持久化） */
  async persist(payloads: ChatAttachmentPayload[]): Promise<ChatAttachmentMeta[]> {
    if (payloads.length === 0) return [];
    await mkdir(this.root, { recursive: true });
    const metas: ChatAttachmentMeta[] = [];
    for (const payload of payloads) {
      const id = nanoid();
      const path = join(this.root, id);
      const temporary = `${path}.tmp`;
      try {
        await writeFile(temporary, payload.dataUrl, { mode: 0o600 });
        await rename(temporary, path);
      } catch (cause) {
        // 当前批次的临时文件与此前成功的最终文件一并清理，不留残留
        await rm(temporary, { force: true }).catch(() => {});
        await this.remove(metas);
        throw new Error(`附件保存失败：${errorMessage(cause)}`);
      }
      metas.push({
        id,
        filename: payload.filename,
        mediaType: payload.mediaType,
        byteSize: dataUrlByteSize(payload.dataUrl),
      });
    }
    return metas;
  }

  async remove(metas: ChatAttachmentMeta[]) {
    const results = await Promise.allSettled(
      metas.map((meta) => rm(join(this.root, meta.id), { force: true }))
    );
    return {
      failed: results.flatMap((result, index) =>
        result.status === "rejected" ? [metas[index]!.id] : []
      ),
    };
  }

  async sweep(referencedIds: ReadonlySet<string>) {
    try {
      await mkdir(this.root, { recursive: true });
      const entries = await readdir(this.root, { withFileTypes: true });
      const stale = entries.filter(
        (entry) => entry.isFile() && !referencedIds.has(entry.name)
      );
      const results = await Promise.allSettled(
        stale.map((entry) => rm(join(this.root, entry.name), { force: true }))
      );
      const failed = results.filter((result) => result.status === "rejected");
      return failed.length
        ? { warning: `${failed.length} 个未引用附件清理失败` }
        : {};
    } catch (cause) {
      return { warning: `附件清理失败：${errorMessage(cause)}` };
    }
  }

  async read(attachmentId: string): Promise<string> {
    let content: string;
    try {
      content = await readFile(join(this.root, attachmentId), "utf8");
    } catch {
      throw new Error("附件不存在或已被移除");
    }
    if (!IMAGE_DATA_URL_PATTERN.test(content)) {
      throw new Error("附件内容已损坏");
    }
    return content;
  }
}
