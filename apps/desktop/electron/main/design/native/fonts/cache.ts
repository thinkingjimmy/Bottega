/**
 * [INPUT]: Exact packaged public font materials and a host-owned document-store cache root.
 * [OUTPUT]: Verified physical font/license paths for authorized local authoring tools, outside ASAR.
 * [POS]: Fixed asset materialization only; it never writes document source or installs system fonts.
 */
import { constants } from "node:fs";
import { mkdir, lstat, realpath, open } from "node:fs/promises";
import { join } from "node:path";
import { designDigest } from "../../documents/model";
import { fixedDesignFont, designFontCatalog } from "./catalog";
export async function materializeDesignFont(root: string, signal: AbortSignal) {
  signal.throwIfAborted(); const font = await fixedDesignFont(), base = await realpath(root), directory = join(base, "font-cache");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("The fixed font cache is not a regular directory");
  const write = async (name: string, data: Uint8Array) => {
    signal.throwIfAborted(); const path = join(directory, name);
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== data.length || designDigest(await handle.readFile()) !== designDigest(data)) throw new Error("The fixed font cache has different bytes");
      const after = await handle.stat(), current = await lstat(directory);
      if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || current.ino !== parent.ino || current.dev !== parent.dev || current.isSymbolicLink()) throw new Error("The fixed font cache changed while reading");
    } finally { await handle.close(); }
    return path;
  };
  const file = await write(font.info.file.sha256 + ".woff2", font.bytes), license = await write(font.info.license.sha256 + ".LICENSE.txt", font.license);
  signal.throwIfAborted();
  return { ...designFontCatalog(font), files: { font: file, license },
    use: "Copy both files into the selected document when this font is chosen. Preserve the license. No source or system font was changed.",
    css: '@font-face{font-family:"Noto Sans SC";src:url("fonts/NotoSansSC-VF.woff2") format("woff2");font-weight:100 900;font-style:normal}' };
}
