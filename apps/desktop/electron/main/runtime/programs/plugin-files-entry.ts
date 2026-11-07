/**
 * [INPUT]: Reads one bounded JSON file operation from stdin under the plugin's main-owned Seatbelt profile.
 * [OUTPUT]: Writes one JSON file result; file bytes never cross an unfenced main-process access.
 * [POS]: Bundled-Node plugin file proxy entry; OS path checks remain active across symlink and rename races.
 */
import { constants } from "node:fs";
import { open, stat, readdir } from "node:fs/promises";
const LIMIT = 4 * 1024 * 1024;
let source = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => { source += chunk; if (Buffer.byteLength(source) > LIMIT + 32_768) process.exit(1); });
process.stdin.once("end", () => { void run().then(result => process.stdout.write(JSON.stringify(result)), cause => { process.stderr.write((cause as Error).message); process.exitCode = 1; }); });
async function run() {
  const input = JSON.parse(source) as { operation: string; path: string; content?: string };
  if (!input.path.startsWith("/") || input.path.includes("\0")) throw new Error("Invalid plugin file path");
  if (input.operation === "stat") { const info = await stat(input.path); return { directory: info.isDirectory(), bytes: info.size, modifiedAt: info.mtimeMs }; }
  if (input.operation === "list") {
    const entries = await readdir(input.path, { withFileTypes: true });
    if (entries.length > 10_000) throw new Error("Plugin directory exceeds budget");
    return entries.map(item => ({ name: item.name, directory: item.isDirectory(), symlink: item.isSymbolicLink() }));
  }
  if (input.operation !== "read" && input.operation !== "write") throw new Error("Invalid plugin file operation");
  const file = await open(input.path, input.operation === "read" ? constants.O_RDONLY : constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await file.stat();
    if (!info.isFile() || input.operation === "read" && info.size > LIMIT) throw new Error("Plugin file exceeds budget");
    if (input.operation === "read") return await file.readFile("utf8");
    if (typeof input.content !== "string" || Buffer.byteLength(input.content) > LIMIT) throw new Error("Plugin file write exceeds budget");
    await file.truncate(0); await file.writeFile(input.content, "utf8"); await file.sync();
    return { bytes: Buffer.byteLength(input.content) };
  } finally { await file.close(); }
}
