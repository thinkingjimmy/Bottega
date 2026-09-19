/**
 * [INPUT]: Depends on canonical Chat references, portable attachment maps and the shared bounded Home scanner.
 * [OUTPUT]: Copies retained Fork files into independent Chat directories, preserving exact bytes and reporting omissions.
 * [POS]: Shared ordinary-Fork byte custody; no CLI files, worktrees or local control ledgers are transported.
 */
import { lstat, readFile, readdir, mkdir, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { ChatRecord } from "../../../../shared/chats-ipc";
import { durableReplaceBytes } from "../../persistence/durable-json";
import { scanHomeFiles } from "../../cloud/sync-home/scan";
import { fileFingerprint } from "../../cloud/sync-home/incremental/identity";
import { messageArtifactFences } from "../../artifacts/service";
import { libraryChatPath, libraryDirectory, libraryHomePath } from "../paths";
import { LibraryAttachments } from "./attachments";
export async function copyLibraryAssets(root: string, sourceId: string, child: ChatRecord) {
  const attachments = new LibraryAttachments(() => root), missing: string[] = [];
  for (const message of child.messages) {
    if (message.role === "user") for (const meta of message.attachments ?? []) {
      try {
        const { dataUrl } = await attachments.read(meta.id, sourceId);
        await attachments.persist([{ filename: meta.filename, mediaType: meta.mediaType, dataUrl }], [meta.id], child.id);
      } catch (error) {
        if (!/ATTACHMENT_MISSING/.test(String(error))) throw error;
        missing.push(`attachments/${meta.id}`);
      }
    }
    for (const fence of messageArtifactFences(message, child.subagents)) {
      const source = join(libraryChatPath(root, sourceId), "artifacts", fence.id);
      let entries;
      try { entries = await readdir(source, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing.push(`artifacts/${fence.id}`); continue; }
      if (await realpath(source) !== source) throw new Error("LIBRARY_DIRECTORY_CHANGED");
      const entry = entries.find(item => item.isFile() && /^snapshot\.[a-z]+$/.test(item.name));
      if (!entry) { missing.push(`artifacts/${fence.id}`); continue; }
      const path = join(source, entry.name), stat = await lstat(path);
      if (stat.isSymbolicLink() || stat.size !== fence.bytes) throw new Error("ARTIFACT_INTEGRITY_FAILED");
      const bytes = await readFile(path);
      if (createHash("sha256").update(bytes).digest("hex") !== fence.sha256) throw new Error("ARTIFACT_INTEGRITY_FAILED");
      const target = await libraryDirectory(root, "chats", child.id, "artifacts", fence.id);
      await durableReplaceBytes(join(target, entry.name), bytes);
    }
  }
  return missing;
}
export async function copyLibraryHome(root: string, sourceId: string, targetId: string) {
  const source = libraryHomePath(root, sourceId), target = libraryHomePath(root, targetId);
  try { await lstat(source); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ["home/"]; throw error; }
  const scan = await scanHomeFiles(source, "worktree", new AbortController().signal);
  for (const file of scan.files) {
    const path = join(source, file.path), bytes = await readFile(path);
    if (fileFingerprint(await lstat(path, { bigint: true })) !== file.identity || bytes.length !== file.bytes) throw new Error("LIBRARY_HOME_CHANGED_DURING_COPY");
    const directory = dirname(join(target, file.path));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (await realpath(directory) !== directory) throw new Error("LIBRARY_DIRECTORY_CHANGED");
    await durableReplaceBytes(join(target, file.path), bytes, file.mode);
  }
  return scan.omitted.map(item => `home/${item.path}`);
}
