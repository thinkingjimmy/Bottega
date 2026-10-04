/**
 * [INPUT]: No-follow transcript handles and the shared forward-compatible line decoder.
 * [OUTPUT]: Streams arbitrary-length transcripts, verifies stable bytes and optionally preserves an exact branch copy.
 * [POS]: Folder restoration I/O; total history size does not alter the supported export format.
 */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { syncDirectory } from "../../../persistence/durable-json";
import { TranscriptDecoder } from "../codec";

export async function readTranscript(path: string, branchDirectory?: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const temporary = branchDirectory ? join(branchDirectory, `.import-${randomUUID()}`) : null;
  const output = temporary ? await open(temporary, "wx", 0o600) : null;
  try {
    const before = await file.stat();
    if (!before.isFile()) throw new Error("LIBRARY_FILE_INVALID");
    const digest = createHash("sha256"), decoder = new TranscriptDecoder(), utf8 = new StringDecoder("utf8");
    let pending = "";
    const consume = (text: string) => {
      pending += text;
      let end;
      while ((end = pending.indexOf("\n")) >= 0) {
        if (!branchDirectory) decoder.accept(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    };
    for await (const bytes of file.createReadStream({ autoClose: false })) {
      digest.update(bytes); await output?.writeFile(bytes);
      if (!branchDirectory) consume(utf8.write(bytes));
    }
    if (!branchDirectory) { consume(utf8.end()); if (pending) decoder.accept(pending, false); }
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw new Error("LIBRARY_TRANSCRIPT_CHANGED");
    const hash = digest.digest("hex");
    if (output && temporary && branchDirectory) {
      await output.sync(); await output.close();
      await rename(temporary, join(branchDirectory, `import-${hash}.jsonl`)); await syncDirectory(branchDirectory);
    }
    return { transcript: branchDirectory ? null : decoder.finish(), hash };
  } finally { await file.close(); await output?.close().catch(() => {}); if (temporary) await rm(temporary, { force: true }); }
}
