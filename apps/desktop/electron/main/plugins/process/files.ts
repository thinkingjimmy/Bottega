/**
 * [INPUT]: Depends on Node descriptor-based filesystem access and the shared canonical plugin sensitive-path policy.
 * [OUTPUT]: Provides PluginFileProxy read/write/stat/list with denied sensitive directories and symlink identity checks.
 * [POS]: Trusted plugin host RPC filesystem adapter; it uses the same foreign-sensitive table as direct Seatbelt launches.
 */
import { constants } from "node:fs";
import { open, stat, readdir, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { assertPluginPath, pluginPathScope, type PluginPathScope } from "./paths";
const BYTE_LIMIT = 4 * 1024 * 1024;
export class PluginFileProxy {
  constructor(private readonly scope: PluginPathScope = pluginPathScope()) {}
  async read(path: string) {
    const canonical = await assertPluginPath(path, this.scope);
    const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const actual = await file.stat(), current = await stat(await assertPluginPath(path, this.scope));
      if (!actual.isFile() || actual.size > BYTE_LIMIT) throw new Error("Plugin file read exceeds its byte budget");
      if (actual.dev !== current.dev || actual.ino !== current.ino) throw new Error("Plugin file identity changed");
      return await file.readFile("utf8");
    } finally { await file.close(); }
  }
  async write(path: string, content: string) {
    if (Buffer.byteLength(content) > BYTE_LIMIT) throw new Error("Plugin file write exceeds its byte budget");
    const canonical = await assertPluginPath(path, this.scope);
    const parent = await assertPluginPath(dirname(canonical), this.scope);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (await assertPluginPath(path, this.scope) !== canonical) throw new Error("Plugin file identity changed");
    const file = await open(canonical, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const actual = await file.stat(), current = await stat(await assertPluginPath(path, this.scope));
      if (!actual.isFile() || actual.dev !== current.dev || actual.ino !== current.ino) throw new Error("Plugin file identity changed");
      await file.truncate(0); await file.writeFile(content, "utf8"); await file.sync();
    } finally { await file.close(); }
    return { bytes: Buffer.byteLength(content) };
  }
  async stat(path: string) { const info = await stat(await assertPluginPath(path, this.scope)); return { directory: info.isDirectory(), bytes: info.size, modifiedAt: info.mtimeMs }; }
  async list(path: string) { return (await readdir(await assertPluginPath(path, this.scope), { withFileTypes: true })).map(item => ({ name: item.name, directory: item.isDirectory(), symlink: item.isSymbolicLink() })); }
}
