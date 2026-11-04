/**
 * [INPUT]: Main-owned frozen resolved attachment/Skill snapshots and an independent restricted job directory.
 * [OUTPUT]: Bounded copied input files and original image bytes; no original staging path is sent to the model.
 * [POS]: Original-Chat input projection; copied inputs are excluded from all source publication.
 */
import { lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ResolvedAgentInputItem } from "../../backends/contracts/types";
import { readArtifactSource } from "../../artifacts/storage/guarded-read";
export async function copyArtifactEditInputs(items: readonly ResolvedAgentInputItem[], root: string, signal: AbortSignal) {
  const output: ResolvedAgentInputItem[] = []; let bytes = 0, files = 0;
  const reserve = (size: number) => { bytes += size; if (bytes > 32 * 1024 * 1024 || ++files > 512) throw new Error("The edit input set exceeds its 32 MiB/512-file budget"); };
  const copy = async (source: string, destination: string, depth = 0): Promise<void> => {
    signal.throwIfAborted(); if (depth > 12) throw new Error("An edit input exceeds its path depth budget");
    const state = await lstat(source); if (state.isSymbolicLink()) throw new Error("Edit input links are not supported");
    if (state.isDirectory()) {
      await mkdir(destination, { recursive: true });
      for (const child of await readdir(source, { withFileTypes: true })) {
        if (!child.isFile() && !child.isDirectory()) throw new Error("An edit input contains a non-regular member");
        await copy(join(source, child.name), join(destination, child.name), depth + 1);
      }
    } else {
      if (!state.isFile()) throw new Error("An edit input is not a regular file");
      const data = await readArtifactSource(source, 8 * 1024 * 1024); reserve(data.byteLength);
      await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, data, { flag: "wx", mode: 0o400 });
    }
  };
  for (const [index, item] of items.entries()) {
    signal.throwIfAborted();
    if (item.type === "text") continue;
    if (item.type === "image") { reserve(Buffer.byteLength(item.dataUrl)); output.push({ ...item }); continue; }
    const directory = join(root, "_inputs", String(index));
    if (item.type === "skill") { await copy(dirname(item.path), directory); output.push({ type: "mention", name: "Skill: " + item.name, path: join(directory, basename(item.path)) }); }
    else { const path = join(directory, basename(item.path)); await copy(item.path, path); output.push({ type: "mention", name: item.name, path }); }
  }
  return output;
}
